#!/usr/bin/env node
// Wizard-styles cost-data audit.
//
// Connects to Supabase using the service-role key, fetches every shop's
// `wizard_styles[]`, and reports any row missing `garmentCost` and
// `priceMap` — i.e., rows where the public wizard would silently invoice
// $0 for the blank. Not a CI test — a hands-on tool you run:
//   (a) before going live with a new shop's wizard embed
//   (b) after any pricing or enricher deploy that might have shifted
//       the shape of saved data
//   (c) periodically as part of ops hygiene
//
// Usage:
//   SUPABASE_URL=https://qtrypzzcjebvfcihiynt.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key> \
//   node scripts/audit-wizard-styles.mjs
//
// Exits 0 if everything looks good, 1 if any shop has stale data.
// Suitable for cron / CI gates if you ever want to enforce.

import { createClient } from "@supabase/supabase-js";
import { isStyleEnriched } from "../src/lib/wizard/enrichStyle.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[audit] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
  console.error("Set both and re-run. SUPABASE_URL = https://<project>.supabase.co");
  process.exit(2);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

console.log("[audit] Fetching shop list…");

// Pull every shop row that has at least one wizard_style configured.
// Skip shops with no wizard setup — nothing to audit there.
const { data: shops, error } = await admin
  .from("shops")
  .select("id, owner_email, shop_name, wizard_styles")
  .not("wizard_styles", "is", null);

if (error) {
  console.error("[audit] Query failed:", error.message);
  process.exit(2);
}

if (!shops || shops.length === 0) {
  console.log("[audit] No shops with wizard_styles configured.");
  process.exit(0);
}

console.log(`[audit] Scanning ${shops.length} shop(s)…\n`);

let totalBad = 0;
const offenders = [];

for (const shop of shops) {
  const styles = Array.isArray(shop.wizard_styles) ? shop.wizard_styles : [];
  if (styles.length === 0) continue;

  // For each style, check whether the cost data the public wizard
  // needs is present. Uses the same predicate as the save-time
  // auto-enrich, so what passes the audit also passes the editor.
  const badStyles = styles.filter(s => !isStyleEnriched(s));
  if (badStyles.length === 0) continue;

  totalBad += badStyles.length;
  offenders.push({ shop, badStyles });
}

if (offenders.length === 0) {
  console.log(`✓ All ${shops.length} shop(s) have fully-enriched wizard_styles. No action needed.`);
  process.exit(0);
}

// Report findings — one shop per block, one line per stale row.
console.log("⚠ Shops with wizard_styles missing cost / image data:\n");
for (const { shop, badStyles } of offenders) {
  const label = shop.shop_name ? `${shop.shop_name} <${shop.owner_email}>` : shop.owner_email;
  console.log(`  ${label}`);
  for (const s of badStyles) {
    // Pinpoint which signal is missing so the shop knows what to fix.
    const reasons = [];
    if (!s.styleImage) reasons.push("no styleImage");
    if (!s.colorImages || Object.keys(s.colorImages).length === 0) reasons.push("no colorImages");
    const hasGarmentCost = Number(s.garmentCost) > 0;
    const hasPriceMap = s.priceMap && Object.keys(s.priceMap).length > 0;
    if (!hasGarmentCost && !hasPriceMap) reasons.push("no cost data");
    console.log(`    • ${s.brand || ""} ${s.styleNumber || s.name || s.id || "?"} — ${reasons.join(", ")}`);
  }
  console.log("");
}

console.log(`Summary: ${totalBad} stale row(s) across ${offenders.length} shop(s).\n`);
console.log("Fix: each shop can click 'Sync from suppliers' in Account → Wizard");
console.log("Setup (or just hit Save — auto-enrich will refetch anything missing).\n");

process.exit(1);
