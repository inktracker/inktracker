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
for (const bucket of BUCKETS) {
  let paths;
  try {
    paths = await listAll(bucket);
  } catch (e) {
    console.error(`[backup] bucket "${bucket}" skipped: ${e.message}`);
    continue;
  }
  let n = 0;
  for (const path of paths) {
    const { data, error } = await sb.storage.from(bucket).download(path);
    if (error) { console.error(`[backup] download failed ${bucket}/${path}: ${error.message}`); continue; }
    const dest = join(OUT, bucket, path);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, Buffer.from(await data.arrayBuffer()));
    n++;
  }
  console.log(`[backup] ${bucket}: ${n} object(s)`);
  grandTotal += n;
}
console.log(`[backup] done — ${grandTotal} object(s) under ./${OUT}/`);
