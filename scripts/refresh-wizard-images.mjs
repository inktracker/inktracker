#!/usr/bin/env node
// Wizard-styles image refresh.
//
// Supplier CDNs rotate image URLs when a product photo is re-uploaded
// (BigCommerce bakes an upload timestamp into the path), so the image
// URLs harvested into saved `wizard_styles[]` rows rot over time and the
// public wizard renders broken-image icons. `resync-wizard-styles.mjs`
// won't catch this: a row with a dead styleImage still passes
// `isStyleEnriched` (it checks presence, not liveness).
//
// This script health-checks every saved styleImage / colorImages URL,
// refetches ONLY the rows that have dead URLs, and patches ONLY the
// image fields — pricing, overrides, and every other saved field are
// left untouched. A dead color entry with no fresh replacement is
// dropped (the wizard falls back to the base image for that swatch).
//
// Usage:
//   ./scripts/with-secrets.sh node scripts/refresh-wizard-images.mjs [--shop owner@email] [--dry]
//
// Exits 0 on success, 1 if any dead URL couldn't be replaced.

import { createClient } from "@supabase/supabase-js";
import { pickAndNormalize } from "../src/lib/wizard/enrichStyle.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[refresh-images] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
  process.exit(2);
}

const args = process.argv.slice(2);
const shopFilter = args.includes("--shop") ? args[args.indexOf("--shop") + 1] : null;
const dryRun = args.includes("--dry");

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Liveness check. Follows redirects (S&S 301s www→cdn — that's alive) and
// uses a browser UA so CDN bot filters don't produce false "dead" reads.
// Network errors count as alive: better to keep a possibly-fine URL than
// to churn saved data because of a flaky connection.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const livenessCache = new Map();
async function isUrlAlive(url) {
  if (livenessCache.has(url)) return livenessCache.get(url);
  let alive = true;
  try {
    let res = await fetch(url, { method: "HEAD", redirect: "follow", headers: { "User-Agent": UA } });
    // Some CDNs reject HEAD outright — confirm with GET before declaring dead.
    if (!res.ok) {
      res = await fetch(url, { method: "GET", redirect: "follow", headers: { "User-Agent": UA } });
      alive = res.ok;
      if (res.body) await res.body.cancel();
    }
  } catch {
    alive = true;
  }
  livenessCache.set(url, alive);
  return alive;
}

async function fetchFreshStyle(styleNumber, brandHint, shopOwner) {
  const styleNum = String(styleNumber || "").trim().toUpperCase();
  if (!styleNum) return null;
  const [ssRes, acRes] = await Promise.allSettled([
    admin.functions.invoke("ssLookupStyle", { body: { styleNumber: styleNum, shopOwner } }),
    admin.functions.invoke("acLookupStyle", { body: { styleCode: styleNum, shopOwner } }),
  ]);
  const ssData = ssRes.status === "fulfilled" ? ssRes.value?.data : null;
  const acData = acRes.status === "fulfilled" ? acRes.value?.data : null;
  return pickAndNormalize(ssData, acData, { brandHint, styleNumber: styleNum });
}

const { data: shops, error } = await admin
  .from("shops")
  .select("id, owner_email, shop_name, wizard_styles")
  .not("wizard_styles", "is", null);

if (error) {
  console.error("[refresh-images] Query failed:", error.message);
  process.exit(2);
}

const targets = shopFilter ? shops.filter((s) => s.owner_email === shopFilter) : shops;
if (targets.length === 0) {
  console.log("[refresh-images] No matching shops.");
  process.exit(0);
}

let totalPatched = 0;
let totalUnfixable = 0;

for (const shop of targets) {
  const styles = Array.isArray(shop.wizard_styles) ? shop.wizard_styles : [];
  let shopChanged = false;
  const nextStyles = [];

  for (const row of styles) {
    const deadColors = [];
    for (const [color, url] of Object.entries(row.colorImages || {})) {
      if (url && !(await isUrlAlive(url))) deadColors.push(color);
    }
    const styleImageDead = Boolean(row.styleImage) && !(await isUrlAlive(row.styleImage));

    if (!styleImageDead && deadColors.length === 0) {
      nextStyles.push(row);
      continue;
    }

    const label = `${shop.owner_email} ${row.styleNumber || row.id}`;
    console.log(
      `[refresh-images] ${label}: ${styleImageDead ? "styleImage DEAD; " : ""}${
        deadColors.length ? `dead colors: ${deadColors.join(", ")}` : ""
      }`
    );

    const fresh = await fetchFreshStyle(row.styleNumber, row.brand, shop.owner_email);
    const patched = { ...row };
    let rowFullyFixed = true;

    if (styleImageDead) {
      const candidate = fresh?.styleImage;
      if (candidate && (await isUrlAlive(candidate))) {
        patched.styleImage = candidate;
        console.log(`  styleImage -> ${candidate}`);
      } else {
        rowFullyFixed = false;
        console.log(`  styleImage: NO live replacement from supplier`);
      }
    }

    for (const color of deadColors) {
      const candidate = fresh?.colorImages?.[color];
      if (candidate && candidate !== row.colorImages[color] && (await isUrlAlive(candidate))) {
        patched.colorImages = { ...patched.colorImages, [color]: candidate };
        console.log(`  color ${color} -> ${candidate}`);
      } else {
        // No fresh URL for this color (renamed or discontinued) — drop the
        // dead entry so the swatch falls back to the base image instead of
        // a broken-image icon.
        const { [color]: _dropped, ...rest } = patched.colorImages || {};
        patched.colorImages = rest;
        console.log(`  color ${color}: dropped (no live replacement)`);
      }
    }

    if (!rowFullyFixed) totalUnfixable++;
    shopChanged = true;
    totalPatched++;
    nextStyles.push(patched);
  }

  if (shopChanged && !dryRun) {
    const { error: upErr } = await admin
      .from("shops")
      .update({ wizard_styles: nextStyles })
      .eq("id", shop.id);
    if (upErr) {
      console.error(`[refresh-images] WRITE FAILED for ${shop.owner_email}:`, upErr.message);
      process.exit(1);
    }
    console.log(`[refresh-images] ${shop.owner_email}: wrote ${nextStyles.length} styles.`);
  } else if (shopChanged) {
    console.log(`[refresh-images] ${shop.owner_email}: DRY RUN — no write.`);
  }
}

console.log(
  `[refresh-images] done. rows patched: ${totalPatched}, rows with unfixable styleImage: ${totalUnfixable}${
    dryRun ? " (dry run)" : ""
  }`
);
process.exit(totalUnfixable > 0 ? 1 : 0);
