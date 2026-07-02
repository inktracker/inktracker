#!/usr/bin/env node
// Repair quotes whose status desynced from their conversion state — the
// approve-replay clobber fixed on fix/approve-clobbers-converted: a customer
// re-clicking the emailed approve link after the shop converted the quote
// rewrote status to "Approved" (or "Client Approved" for broker quotes)
// while converted_order_id stayed set. Invariant restored here:
// converted_order_id set ⇒ status "Converted to Order".
//
// Safety rails:
//   - DRY RUN by default; pass --apply to write.
//   - Only touches rows whose status is one of the two clobber signatures
//     ("Approved" / "Client Approved"). Anything else with a set
//     converted_order_id is REPORTED for manual review, never auto-changed.
//   - Verifies the referenced order row actually exists first (by order_id,
//     with the legacy id fallback resolveQuoteLink uses). A dangling
//     converted_order_id is a different failure (order deleted without the
//     revert path) and is only reported.
//
// Usage:
//   ./scripts/with-secrets.sh node scripts/repair-converted-quote-status.mjs
//   ./scripts/with-secrets.sh node scripts/repair-converted-quote-status.mjs --apply

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APPLY = process.argv.includes("--apply");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[repair] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
  process.exit(2);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// The clobber only ever wrote these two values (see approveQuoteEffect.js).
const CLOBBER_SIGNATURES = new Set(["Approved", "Client Approved"]);

const { data: desynced, error } = await admin
  .from("quotes")
  .select("id, quote_id, status, converted_order_id, shop_owner, customer_name")
  .not("converted_order_id", "is", null)
  .or('status.is.null,status.neq."Converted to Order"');

if (error) {
  console.error("[repair] Query failed:", error.message);
  process.exit(1);
}

if (!desynced?.length) {
  console.log("[repair] No desynced quotes found — invariant holds everywhere.");
  process.exit(0);
}

console.log(`[repair] ${desynced.length} quote(s) with converted_order_id set but status ≠ "Converted to Order":\n`);

let fixed = 0, skipped = 0, failures = 0;

for (const q of desynced) {
  const label = `${q.quote_id || q.id} (${q.customer_name || "?"}, ${q.shop_owner}) status="${q.status}" → order ${q.converted_order_id}`;

  // Verify the order this quote claims to have become actually exists.
  const { data: byOrderId } = await admin
    .from("orders").select("id, order_id").eq("order_id", q.converted_order_id).maybeSingle();
  let order = byOrderId;
  if (!order) {
    const { data: byId } = await admin
      .from("orders").select("id, order_id").eq("id", q.converted_order_id).maybeSingle();
    order = byId;
  }

  if (!order) {
    console.log(`  REVIEW  ${label} — no matching order row (dangling link); not touching`);
    skipped++;
    continue;
  }
  if (!CLOBBER_SIGNATURES.has(q.status)) {
    console.log(`  REVIEW  ${label} — status isn't a known clobber signature; not touching`);
    skipped++;
    continue;
  }

  if (!APPLY) {
    console.log(`  WOULD FIX  ${label} — restore status "Converted to Order"`);
    fixed++;
    continue;
  }

  const { error: updErr } = await admin
    .from("quotes")
    .update({ status: "Converted to Order" })
    .eq("id", q.id)
    .eq("status", q.status); // only if unchanged since we read it
  if (updErr) {
    console.log(`  FAILED  ${label} — ${updErr.message}`);
    failures++;
  } else {
    console.log(`  FIXED   ${label} — status restored to "Converted to Order"`);
    fixed++;
  }
}

console.log(
  `\n[repair] ${APPLY ? "Applied" : "Dry run"}: ${fixed} ${APPLY ? "fixed" : "would fix"}, ` +
  `${skipped} flagged for review, ${failures} failed.` +
  (APPLY ? "" : " Re-run with --apply to write."),
);
process.exit(failures ? 1 : 0);
