#!/usr/bin/env node
// Storage backup (audit OPS-02). Supabase's daily DB backup does NOT cover
// Storage, so a "successful" DB restore would leave every artwork/cert
// reference dangling and lose tax-compliance documents. This downloads every
// object from the private/owned buckets so the nightly GitHub Action can
// archive them off the platform (as a build artifact).
//
// Env: SUPABASE_URL (or VITE_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY.
// Local use: ./scripts/with-secrets.sh node scripts/backup-storage.mjs
// Writes to ./storage-backup/<bucket>/<path>. Prints a per-bucket count.

import { createClient } from "@supabase/supabase-js";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const BUCKETS = ["artwork", "tax-certificates"];
const OUT = "storage-backup";
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

// Storage list is one level at a time; recurse into "folders" (entries with no
// id / no metadata are folders).
async function listAll(bucket, prefix = "") {
  const out = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await sb.storage.from(bucket).list(prefix, { limit: 1000, offset });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id == null && entry.metadata == null) {
        out.push(...(await listAll(bucket, path))); // folder → recurse
      } else {
        out.push(path);
      }
    }
    if (data.length < 1000) break;
    offset += data.length;
  }
  return out;
}

let grandTotal = 0;
// T3: a skipped bucket or failed download must FAIL the job — a silently
// partial backup is how you find out at restore time that the one file you
// needed isn't in it.
let hardFailures = 0;
const bucketStats = {};
for (const bucket of BUCKETS) {
  let paths;
  try {
    paths = await listAll(bucket);
  } catch (e) {
    console.error(`[backup] bucket "${bucket}" list FAILED: ${e.message}`);
    hardFailures++;
    continue;
  }
  let n = 0;
  let bytes = 0;
  for (const path of paths) {
    const { data, error } = await sb.storage.from(bucket).download(path);
    if (error) {
      console.error(`[backup] download failed ${bucket}/${path}: ${error.message}`);
      hardFailures++;
      continue;
    }
    const buf = Buffer.from(await data.arrayBuffer());
    const dest = join(OUT, bucket, path);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, buf);
    n++;
    bytes += buf.length;
  }
  bucketStats[bucket] = { count: n, bytes };
  console.log(`[backup] ${bucket}: ${n} object(s), ${bytes} bytes`);
  grandTotal += n;
}
console.log(`[backup] done — ${grandTotal} object(s) under ./${OUT}/`);

// ── Manifest + previous-run comparison (T3) ─────────────────────────
{
  const { buildStorageManifest, compareManifests } = await import("./lib/backupManifest.mjs");
  const { readFile } = await import("node:fs/promises");
  const manifest = { generated_at: new Date().toISOString(), ...buildStorageManifest(bucketStats) };
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));

  let prev = null;
  if (process.env.PREV_MANIFEST) {
    try { prev = JSON.parse(await readFile(process.env.PREV_MANIFEST, "utf8")); }
    catch { console.warn(`[backup] previous manifest unreadable — compare skipped`); }
  }
  const cmp = compareManifests(prev, manifest);
  if (cmp.note) console.log(`[backup] compare: ${cmp.note}`);
  if (!cmp.ok) {
    for (const p of cmp.problems) console.error(`[backup] MANIFEST ALARM: ${p}`);
    // Breadcrumb for the qbReconcile operator-alert sweep (best-effort;
    // the exit 1 is the primary signal).
    try {
      await sb.from("qb_event_log").insert({
        shop_owner: "__system__",
        action: "backup_failure",
        direction: "outbound",
        status: "error",
        response_body: { kind: "storage", problems: cmp.problems },
      });
    } catch { /* best-effort */ }
    process.exit(1);
  }
}

if (hardFailures > 0) {
  console.error(`[backup] ${hardFailures} hard failure(s) — failing the job (partial backups must not look green).`);
  process.exit(1);
}
