#!/usr/bin/env node
// Hard-purges rows soft-deleted longer than the retention window (T5).
// Runs weekly via .github/workflows/purge-soft-deleted.yml on the service
// role (the ONLY hard-delete path — clients are blocked by RLS).
//
//   node scripts/purge-soft-deleted.mjs            # dry run (default)
//   node scripts/purge-soft-deleted.mjs --apply    # actually delete
//
// Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY; PURGE_WINDOW_DAYS (default 30).
//
// Safety rails:
//   • dry-run by default; --apply required to touch anything
//   • children purge before parents (invoices/orders/quotes → customers)
//   • a customer still referenced by any LIVE row is NEVER purged — that
//     would manufacture the dangling links the integrity alarm exists for.
//     It's reported and retried next week (after the referencing rows age
//     out or are restored).

import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const APPLY = process.argv.includes("--apply");
const WINDOW_DAYS = Number(process.env.PURGE_WINDOW_DAYS || 30);
const cutoff = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

const sb = createClient(URL, KEY, { auth: { persistSession: false } });
console.log(`[purge] ${APPLY ? "APPLY" : "dry run"} — window ${WINDOW_DAYS}d, cutoff ${cutoff}`);

async function candidates(table) {
  const { data, error } = await sb.from(table)
    .select("id, deleted_at")
    .not("deleted_at", "is", null)
    .lt("deleted_at", cutoff)
    .limit(5000);
  if (error) throw new Error(`${table} scan: ${error.message}`);
  return data ?? [];
}

async function purgeIds(table, ids) {
  if (!APPLY || ids.length === 0) return;
  // chunked so a big backlog can't blow a single statement
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await sb.from(table).delete().in("id", ids.slice(i, i + 200));
    if (error) throw new Error(`${table} purge: ${error.message}`);
  }
}

let failed = false;

// Children first.
for (const table of ["invoices", "orders", "quotes"]) {
  try {
    const rows = await candidates(table);
    console.log(`[purge] ${table}: ${rows.length} row(s) past window${APPLY ? "" : " (would purge)"}`);
    await purgeIds(table, rows.map((r) => r.id));
  } catch (e) {
    console.error(`[purge] ${table} FAILED: ${e.message}`);
    failed = true;
  }
}

// Customers last, with the live-reference guard.
try {
  const rows = await candidates("customers");
  const purgeable = [];
  for (const c of rows) {
    let referenced = false;
    for (const table of ["quotes", "orders", "invoices"]) {
      const { count, error } = await sb.from(table)
        .select("id", { count: "exact", head: true })
        .eq("customer_id", c.id)
        .is("deleted_at", null);
      if (error) throw new Error(`${table} ref-check: ${error.message}`);
      if ((count ?? 0) > 0) { referenced = true; break; }
    }
    if (referenced) {
      console.log(`[purge] customers: ${c.id} SKIPPED — still referenced by live rows (would create dangling links)`);
    } else {
      purgeable.push(c.id);
    }
  }
  console.log(`[purge] customers: ${purgeable.length}/${rows.length} purgeable${APPLY ? "" : " (would purge)"}`);
  await purgeIds("customers", purgeable);
} catch (e) {
  console.error(`[purge] customers FAILED: ${e.message}`);
  failed = true;
}

if (failed) process.exit(1);
console.log(`[purge] done (${APPLY ? "applied" : "dry run"})`);
