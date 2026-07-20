#!/usr/bin/env node
// QB-invoice duplicate scan.
//
// Finds invoices rows that share the same (shop_owner, qb_invoice_id) —
// the "one QB invoice represented by two InkTracker rows" class the
// 2026-07-18 tester note surfaced (complete-before-first-pull window,
// fixed forward in PR #653). Migration 20260913000000 adds a partial
// unique index to make this a DB invariant, but it SKIPS itself with a
// warning while any duplicates exist — run this scan, repair what it
// finds, then re-apply the migration (or run the CREATE UNIQUE INDEX
// from it by hand).
//
// Read-only: this script never mutates rows. Repair is a human call —
// typically the pulled `Q-...` row (order_id NULL) merges into the
// order-born `INV-...` row, but paid flags and QB links must be eyeballed.
//
// Usage:
//   ./scripts/with-secrets.sh node scripts/scan-qb-invoice-dups.mjs
//
// Exits 0 when clean, 1 when duplicates exist, 2 on config error.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[scan] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
  process.exit(2);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

console.log("[scan] Fetching invoices with a qb_invoice_id…");

const PAGE = 1000;
let rows = [];
for (let from = 0; ; from += PAGE) {
  const { data, error } = await admin
    .from("invoices")
    .select("id, shop_owner, invoice_id, qb_invoice_id, order_id, paid, total, date, created_at")
    .not("qb_invoice_id", "is", null)
    .order("created_at", { ascending: true })
    .range(from, from + PAGE - 1);
  if (error) {
    console.error("[scan] fetch failed:", error.message);
    process.exit(2);
  }
  rows = rows.concat(data ?? []);
  if (!data || data.length < PAGE) break;
}

console.log(`[scan] ${rows.length} QB-linked invoice rows.`);

const byKey = new Map();
for (const r of rows) {
  const key = `${r.shop_owner}::${r.qb_invoice_id}`;
  if (!byKey.has(key)) byKey.set(key, []);
  byKey.get(key).push(r);
}

const dups = [...byKey.entries()].filter(([, group]) => group.length > 1);

if (dups.length === 0) {
  console.log("[scan] ✓ Clean — no (shop_owner, qb_invoice_id) duplicates.");
  console.log("[scan] Safe to apply migration 20260913000000 (the index will create).");
  process.exit(0);
}

console.log(`[scan] ✗ ${dups.length} duplicate group(s):\n`);
for (const [key, group] of dups) {
  const [shop, qbId] = key.split("::");
  console.log(`  shop=${shop}  qb_invoice_id=${qbId}`);
  for (const r of group) {
    console.log(
      `    id=${r.id}  invoice_id=${r.invoice_id}  order_id=${r.order_id ?? "—"}  paid=${r.paid}  total=${r.total}  date=${r.date}`
    );
  }
  console.log("");
}
console.log("[scan] Repair guidance: usually the pulled row (Q-..., order_id NULL)");
console.log("[scan] merges into the order-born row (INV-..., order_id set) — but");
console.log("[scan] check paid flags first. After repair, re-run this scan, then");
console.log("[scan] apply/re-run migration 20260913000000.");
process.exit(1);
