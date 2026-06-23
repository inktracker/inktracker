#!/usr/bin/env node
// One-shop wizard-styles resync — the headless equivalent of the shop owner
// clicking "Sync from suppliers" / Save in Account → Wizard Setup.
//
// Reuses the app's OWN enrichment code (src/lib/wizard/enrichStyle.js) and the
// exact same merge WizardConfigEditor.handleSave does — `{ ...style, ...data }`
// — so it can't drift from the in-app behavior and preserves every shop
// customization (display name override, category, markup, enabled flag). Only
// styles failing isStyleEnriched() are refetched; everything else is untouched.
//
// Usage:
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<service-role> \
//   node scripts/resync-shop-wizard.mjs <owner_email>
//
// Pair with: node scripts/audit-wizard-styles.mjs  (verify clean after).

import { createClient } from "@supabase/supabase-js";
import { fetchEnrichedStyle, isStyleEnriched } from "../src/lib/wizard/enrichStyle.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ownerEmail = process.argv[2];

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[resync] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
  process.exit(2);
}
if (!ownerEmail) {
  console.error("[resync] Usage: node scripts/resync-shop-wizard.mjs <owner_email>");
  process.exit(2);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: shops, error } = await admin
  .from("shops")
  .select("id, owner_email, shop_name, wizard_styles")
  .ilike("owner_email", ownerEmail);

if (error) { console.error("[resync] query failed:", error.message); process.exit(2); }
if (!shops?.length) { console.error(`[resync] no shop for ${ownerEmail}`); process.exit(1); }

const shop = shops[0];
const styles = Array.isArray(shop.wizard_styles) ? shop.wizard_styles : [];
console.log(`[resync] ${shop.shop_name || shop.owner_email} — ${styles.length} style(s)`);

const missing = styles.filter((s) => s.styleNumber && !isStyleEnriched(s));
if (missing.length === 0) {
  console.log("[resync] nothing stale — already fully enriched. No write.");
  process.exit(0);
}
console.log(`[resync] stale: ${missing.map((s) => `${s.brand || ""} ${s.styleNumber}`.trim()).join(", ")}`);

// Same fetch + merge as WizardConfigEditor.handleSave.
const fetched = await Promise.all(
  missing.map(async (s) => ({ id: s.id, style: s, data: await fetchEnrichedStyle(s.styleNumber, s.brand, admin) })),
);

for (const f of fetched) {
  const ok = f.data && isStyleEnriched({ ...f.style, ...f.data });
  const gc = f.data?.garmentCost;
  const pm = f.data?.priceMap ? Object.keys(f.data.priceMap).length : 0;
  console.log(`  • ${f.style.brand || ""} ${f.style.styleNumber}: ${ok ? "ENRICHED" : "STILL INCOMPLETE"} (garmentCost=${gc ?? 0}, priceMap colors=${pm})`);
}

const finalStyles = styles.map((s) => {
  const hit = fetched.find((h) => h.id === s.id);
  return hit?.data ? { ...s, ...hit.data } : s;
});

// Only write if at least one stale style actually gained cost data — never
// overwrite good data with a failed lookup.
const anyImproved = fetched.some((f) => f.data && isStyleEnriched({ ...f.style, ...f.data }));
if (!anyImproved) {
  console.error("[resync] no style could be enriched (supplier returned no cost data) — NOT writing.");
  process.exit(1);
}

const { error: updErr } = await admin
  .from("shops")
  .update({ wizard_styles: finalStyles })
  .eq("id", shop.id)
  .eq("owner_email", shop.owner_email);

if (updErr) { console.error("[resync] write failed:", updErr.message); process.exit(2); }
console.log(`[resync] wrote ${finalStyles.length} style(s) back to ${shop.owner_email}. Done.`);
