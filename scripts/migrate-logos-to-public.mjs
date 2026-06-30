// Migrate existing shop/broker LOGOS out of the (soon-private) artwork bucket
// into the public `public` bucket, and repoint profiles.logo_url. New uploads
// already go to the public bucket (src/lib/uploadFile.js uploadLogo); this moves
// the rows uploaded before that change so logos don't break when the artwork
// bucket is flipped private (M-1, stage 3).
//
// SAFE: dry-run by default. Re-run with --commit to apply. Idempotent — rows
// whose logo_url already points at the public bucket are skipped. Only touches
// profiles.logo_url whose URL is an /object/public/artwork/ link; customer
// artwork / broker credential files (legitimately in the artwork bucket) are
// never touched.
//
// Usage:
//   ./scripts/with-secrets.sh node scripts/migrate-logos-to-public.mjs           # dry run
//   ./scripts/with-secrets.sh node scripts/migrate-logos-to-public.mjs --commit  # apply

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const COMMIT = process.argv.includes("--commit");

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("[logos] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
  console.error("Run via: ./scripts/with-secrets.sh node scripts/migrate-logos-to-public.mjs [--commit]");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const ARTWORK_RE = /\/storage\/v1\/object\/public\/artwork\/([^?]+)/;

function artworkPathFromUrl(url) {
  const m = String(url || "").match(ARTWORK_RE);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

async function main() {
  console.log(`[logos] ${COMMIT ? "COMMIT" : "DRY RUN"} — migrating profile logos artwork → public\n`);

  const { data: profiles, error } = await admin
    .from("profiles")
    .select("id, email, logo_url")
    .not("logo_url", "is", null);
  if (error) { console.error("[logos] profiles fetch failed:", error.message); process.exit(1); }

  const targets = (profiles || []).filter((p) => artworkPathFromUrl(p.logo_url));
  console.log(`[logos] ${profiles?.length ?? 0} profiles with a logo; ${targets.length} still in the artwork bucket.\n`);

  let migrated = 0, failed = 0;
  for (const p of targets) {
    const srcPath = artworkPathFromUrl(p.logo_url);
    const ext = (srcPath.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "png";
    const destPath = `logos/${p.id}_${Date.now()}.${ext}`;
    const label = `${p.email || p.id} (${srcPath} → ${destPath})`;

    if (!COMMIT) { console.log(`  would migrate: ${label}`); migrated++; continue; }

    try {
      const { data: blob, error: dlErr } = await admin.storage.from("artwork").download(srcPath);
      if (dlErr || !blob) throw new Error(`download failed: ${dlErr?.message || "no data"}`);
      const { error: upErr } = await admin.storage.from("public")
        .upload(destPath, blob, { upsert: false, cacheControl: "31536000", contentType: blob.type || undefined });
      if (upErr) throw new Error(`upload failed: ${upErr.message}`);
      const { data: pub } = admin.storage.from("public").getPublicUrl(destPath);
      const { error: updErr } = await admin.from("profiles").update({ logo_url: pub.publicUrl }).eq("id", p.id);
      if (updErr) throw new Error(`profile update failed: ${updErr.message}`);
      console.log(`  ✓ migrated: ${label}`);
      migrated++;
    } catch (e) {
      console.error(`  ✗ FAILED: ${label} — ${e.message}`);
      failed++;
    }
  }

  console.log(`\n[logos] done. ${COMMIT ? "migrated" : "would migrate"}: ${migrated}; failed: ${failed}.`);
  if (!COMMIT && migrated > 0) console.log("[logos] re-run with --commit to apply.");
  if (failed > 0) process.exit(1);
}

main();
