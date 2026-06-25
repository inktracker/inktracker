#!/usr/bin/env node
// Remove specific styles from one shop's wizard_styles[] (by style number).
// Scoped + verified: matches by styleNumber, reports exactly what it removes,
// and refuses to write if a requested style isn't found (so a typo can't
// silently no-op or remove the wrong thing).
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//   node scripts/remove-wizard-styles.mjs <owner_email> <styleNumber...>

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const [ownerEmail, ...targetsRaw] = process.argv.slice(2);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[remove] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
  process.exit(2);
}
if (!ownerEmail || targetsRaw.length === 0) {
  console.error("[remove] Usage: node scripts/remove-wizard-styles.mjs <owner_email> <styleNumber...>");
  process.exit(2);
}

const targets = new Set(targetsRaw.map((t) => t.trim().toUpperCase()));
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: shops, error } = await admin
  .from("shops")
  .select("id, owner_email, shop_name, wizard_styles")
  .ilike("owner_email", ownerEmail);

if (error) { console.error("[remove] query failed:", error.message); process.exit(2); }
if (!shops?.length) { console.error(`[remove] no shop for ${ownerEmail}`); process.exit(1); }

const shop = shops[0];
const styles = Array.isArray(shop.wizard_styles) ? shop.wizard_styles : [];
const key = (s) => (s.styleNumber || "").trim().toUpperCase();

const toRemove = styles.filter((s) => targets.has(key(s)));
const remaining = styles.filter((s) => !targets.has(key(s)));
const foundNumbers = new Set(toRemove.map(key));
const notFound = [...targets].filter((t) => !foundNumbers.has(t));

console.log(`[remove] ${shop.shop_name || shop.owner_email}: ${styles.length} style(s)`);
console.log(`[remove] removing: ${toRemove.map((s) => `${s.brand || ""} ${s.styleNumber}`.trim()).join(", ") || "(none)"}`);
if (notFound.length) {
  console.error(`[remove] NOT FOUND in this shop: ${notFound.join(", ")} — aborting, no write.`);
  process.exit(1);
}

const { error: updErr } = await admin
  .from("shops")
  .update({ wizard_styles: remaining })
  .eq("id", shop.id)
  .eq("owner_email", shop.owner_email);

if (updErr) { console.error("[remove] write failed:", updErr.message); process.exit(2); }
console.log(`[remove] done. ${styles.length} → ${remaining.length} style(s).`);
