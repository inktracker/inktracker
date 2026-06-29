#!/usr/bin/env node
// Wizard-styles resync.
//
// Server-side equivalent of Account → Wizard Setup → "Sync from suppliers".
// Walks every shop's `wizard_styles[]`, refetches any row that fails
// `isStyleEnriched`, and writes the enriched row back in place. Preserves
// per-row overrides (the editable fields the shop can tweak in the UI:
// `category`, `categoryLabel`, `decorationCount`, etc.) — only the
// supplier-sourced fields are overwritten.
//
// Usage (service-role key + URL come from the macOS Keychain via the wrapper):
//   ./scripts/with-secrets.sh node scripts/resync-wizard-styles.mjs [--shop owner@email] [--dry]
//
// Exits 0 on success, 1 if any row couldn't be enriched (e.g. supplier
// has no record for that style).

import { createClient } from "@supabase/supabase-js";
import { fetchEnrichedStyle, isStyleEnriched } from "../src/lib/wizard/enrichStyle.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[resync] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
  process.exit(2);
}

const args = process.argv.slice(2);
const shopFilter = args.includes("--shop") ? args[args.indexOf("--shop") + 1] : null;
const dryRun = args.includes("--dry");

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: shops, error } = await admin
  .from("shops")
  .select("id, owner_email, shop_name, wizard_styles")
  .not("wizard_styles", "is", null);

if (error) {
  console.error("[resync] Query failed:", error.message);
  process.exit(2);
}

const targets = shopFilter
  ? shops.filter(s => s.owner_email === shopFilter)
  : shops;

if (targets.length === 0) {
  console.log("[resync] No matching shops.");
  process.exit(0);
}

let totalFixed = 0;
let totalFailed = 0;

for (const shop of targets) {
  const styles = Array.isArray(shop.wizard_styles) ? shop.wizard_styles : [];
  const stale = styles
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => !isStyleEnriched(s));

  if (stale.length === 0) continue;

  const label = shop.shop_name ? `${shop.shop_name} <${shop.owner_email}>` : shop.owner_email;
  console.log(`\n${label} — ${stale.length} stale row(s)`);

  const next = [...styles];

  for (const { s, i } of stale) {
    const styleNum = s.styleNumber || s.style_number || "";
    const brand = s.brand || "";
    process.stdout.write(`  • ${brand} ${styleNum} … `);
    // AS Colour API has bursty rate limits — pace one request per second
    // to avoid the partial-failure pattern we saw on the first run.
    await new Promise(r => setTimeout(r, 1000));
    const enriched = await fetchEnrichedStyle(styleNum, brand, admin);
    if (!enriched) {
      console.log("FAILED (supplier returned no match)");
      totalFailed++;
      continue;
    }
    // Preserve shop-side overrides; only overwrite supplier-sourced fields.
    next[i] = {
      ...s,
      ...enriched,
      // Keep the row's original id, category, label, decorationCount, etc.
      id: s.id || enriched.id,
      category: s.category ?? enriched.category,
      categoryLabel: s.categoryLabel ?? enriched.categoryLabel,
      decorationCount: s.decorationCount ?? enriched.decorationCount,
    };
    const colors = Object.keys(enriched.priceMap || {}).length;
    console.log(`OK — priceMap has ${colors} color(s), garmentCost=${enriched.garmentCost}`);
    totalFixed++;
  }

  if (!dryRun) {
    const { error: upErr } = await admin
      .from("shops")
      .update({ wizard_styles: next })
      .eq("id", shop.id);
    if (upErr) {
      console.log(`  ! write-back failed: ${upErr.message}`);
      totalFailed++;
    } else {
      console.log(`  ✓ wrote ${stale.length} row(s) back to shop`);
    }
  }
}

console.log(`\nSummary: ${totalFixed} fixed, ${totalFailed} failed${dryRun ? " (DRY RUN — no writes)" : ""}.`);
process.exit(totalFailed > 0 ? 1 : 0);
