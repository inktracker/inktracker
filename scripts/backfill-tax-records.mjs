#!/usr/bin/env node
// Backfill tax_records for existing QuickBooks invoices.
//
// The Phase-3 tax-audit records (tax_records table) are written going forward
// at invoice create/sync. This populates HISTORY: it invokes the qbSync
// `pullInvoices` action, which re-pulls every QB invoice and upserts a
// tax_record per invoice from its authoritative TxnTaxDetail.
//
// NOTE: the same thing happens when a shop clicks "QB → Refresh" in the app —
// this script is just the scriptable equivalent for an operator.
//
// Auth: pullInvoices resolves the shop's QuickBooks token from the CALLER's
// identity, so you run it per shop with that shop owner's Supabase access
// token (a logged-in user JWT — not the service_role key).
//
// Usage:
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SHOP_ACCESS_TOKEN=<the shop owner's supabase access token> \
//   node scripts/backfill-tax-records.mjs
//
// Get SHOP_ACCESS_TOKEN: in the shop's browser devtools console while signed in:
//   (await window.supabase?.auth?.getSession())?.data?.session?.access_token
// or read it from the app's localStorage auth entry.

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const TOKEN = process.env.SHOP_ACCESS_TOKEN;

function fail(msg) {
  console.error(`\n  ${msg}\n`);
  console.error("  Usage:");
  console.error("    SUPABASE_URL=https://<ref>.supabase.co \\");
  console.error("    SHOP_ACCESS_TOKEN=<shop owner's supabase access token> \\");
  console.error("    node scripts/backfill-tax-records.mjs\n");
  process.exit(1);
}

if (!URL) fail("SUPABASE_URL (or VITE_SUPABASE_URL) env var is required.");
if (!TOKEN) fail("SHOP_ACCESS_TOKEN env var is required (the shop owner's logged-in JWT).");

const endpoint = `${URL.replace(/\/$/, "")}/functions/v1/qbSync`;

console.log(`\n→ Backfilling tax_records via pullInvoices at ${endpoint}\n`);

const res = await fetch(endpoint, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${TOKEN}`,
  },
  body: JSON.stringify({ action: "pullInvoices", accessToken: TOKEN }),
});

const text = await res.text();
let data;
try { data = JSON.parse(text); } catch { data = text; }

if (!res.ok || data?.error) {
  console.error(`✗ pullInvoices failed (HTTP ${res.status}):`);
  console.error(typeof data === "string" ? data : JSON.stringify(data, null, 2));
  process.exit(1);
}

const { total = 0, imported = 0, updated = 0, taxRecords = 0, truncatedAtCap } = data || {};
console.log("✓ Done.");
console.log(`  QB invoices seen:     ${total}`);
console.log(`  invoices imported:    ${imported}`);
console.log(`  invoices updated:     ${updated}`);
console.log(`  tax_records written:  ${taxRecords}`);
if (truncatedAtCap) {
  console.log("\n  ⚠ Hit the 10K-invoice pull cap — some older invoices were not pulled.");
}
console.log("\n  The Performance → Sales Tax report now reflects these invoices.\n");
