#!/usr/bin/env node
// One-off diff between two quotes. Reads via Supabase service role so it
// bypasses RLS. Run from the inktracker repo root:
//
//   SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi... node scripts/diff-quotes.mjs Q-2026-EQGT Q-2026-3T0I
//
// Get the service role key from Supabase dashboard → Settings → API → "service_role".
// (Treat it like a password — never commit it.)

import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var.");
  console.error("Set them inline:");
  console.error("  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/diff-quotes.mjs <quote_id_a> <quote_id_b>");
  process.exit(1);
}

const [, , idA, idB] = process.argv;
if (!idA || !idB) {
  console.error("Usage: node scripts/diff-quotes.mjs <quote_id_a> <quote_id_b>");
  process.exit(1);
}

const supa = createClient(URL, KEY);

async function fetchQuote(quoteId) {
  const { data, error } = await supa.from("quotes").select("*").eq("quote_id", quoteId).maybeSingle();
  if (error) throw new Error(`${quoteId}: ${error.message}`);
  if (!data) throw new Error(`${quoteId}: not found`);
  return data;
}

// Stable JSON for comparison — sorts keys recursively.
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((acc, k) => { acc[k] = stable(value[k]); return acc; }, {});
  }
  return value;
}

function diffShallow(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const diffs = [];
  for (const k of keys) {
    const va = JSON.stringify(stable(a[k]));
    const vb = JSON.stringify(stable(b[k]));
    if (va !== vb) diffs.push({ field: k, a: a[k], b: b[k] });
  }
  return diffs;
}

function shorten(v, max = 200) {
  if (v == null) return String(v);
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return s.length > max ? s.slice(0, max) + "…" : s;
}

const [a, b] = await Promise.all([fetchQuote(idA), fetchQuote(idB)]);

console.log(`\nComparing ${idA}  ↔  ${idB}\n`);
console.log(`Created: ${a.created_at || a.created_date}  vs  ${b.created_at || b.created_date}`);
console.log(`Status:  ${a.status}  vs  ${b.status}\n`);

const diffs = diffShallow(a, b);

// Drop expected-different fields so the signal is clean.
const expectedDifferent = new Set([
  "id", "quote_id", "status", "date", "created_at", "created_date",
  "sent_to", "sent_date", "qb_invoice_id", "qb_payment_link", "qb_total",
  "qb_tax_amount", "qb_subtotal", "qb_synced_at", "source_email_id",
]);

const surprising = diffs.filter((d) => !expectedDifferent.has(d.field));
const expected = diffs.filter((d) => expectedDifferent.has(d.field));

if (surprising.length === 0) {
  console.log("✅ No unexpected differences. The two quotes have identical inputs.");
  console.log("   If totals still differ on screen, the cause is the live pricing config (_pc),");
  console.log("   not stored data on the quotes themselves.\n");
} else {
  console.log("🔍 UNEXPECTED differences (these explain the total mismatch):\n");
  for (const d of surprising) {
    console.log(`  • ${d.field}`);
    console.log(`      A (${idA}): ${shorten(d.a)}`);
    console.log(`      B (${idB}): ${shorten(d.b)}`);
    console.log("");
  }
}

if (expected.length > 0) {
  console.log("(Expected differences — ID, status, dates, QB sync state, etc. — omitted from above.)\n");
}

// Also dump line_item totals computed naively for both, to spot stored-total drift.
function naiveQty(li) {
  return Object.values(li.sizes || {}).reduce((s, v) => s + (parseInt(v, 10) || 0), 0);
}
function naiveLineCost(li) {
  return parseFloat(li.garmentCost || 0) * naiveQty(li);
}

console.log("Line item summary:");
for (const [label, q] of [[idA, a], [idB, b]]) {
  const items = q.line_items || [];
  const qty = items.reduce((s, li) => s + naiveQty(li), 0);
  const garmentTotal = items.reduce((s, li) => s + naiveLineCost(li), 0);
  console.log(`  ${label}: ${items.length} items, ${qty} pcs, raw garment cost ≈ $${garmentTotal.toFixed(2)}`);
  console.log(`           stored: subtotal=${q.subtotal} tax=${q.tax} total=${q.total} tax_rate=${q.tax_rate} discount=${q.discount} rush_rate=${q.rush_rate}`);
}
console.log("");
