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

// Retry transient storage errors before declaring a real failure.
//
// 2026-08-20: a single object returned "Bad Gateway" (a 502 from Supabase's
// edge, gone on the next request) and failed the ENTIRE nightly backup —
// 134 objects downloaded fine, one blip, whole run red. The fail-loud
// contract below is correct and stays; what was missing is the distinction
// between "the object is gone" and "the network hiccupped."
//
// Deliberately does NOT retry not-found: a missing object is a real finding,
// not a blip, and retrying it just delays the alarm.
const RETRIES = 3;
const isTransient = (msg = "") =>
  /bad gateway|gateway timeout|service unavailable|timeout|timed out|socket|network|ECONN|EAI_AGAIN|fetch failed|502|503|504/i.test(msg);

async function withRetry(label, fn) {
  let lastMsg = "";
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    const { data, error } = await fn();
    if (!error) return { data, error: null };
    lastMsg = error.message || String(error);
    if (!isTransient(lastMsg) || attempt === RETRIES) {
      return { data: null, error: { message: lastMsg } };
    }
    const waitMs = 500 * 2 ** (attempt - 1); // 0.5s, 1s
    console.warn(`[backup] ${label}: ${lastMsg} — retry ${attempt}/${RETRIES - 1} in ${waitMs}ms`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
  return { data: null, error: { message: lastMsg } };
}

// Storage list is one level at a time; recurse into "folders" (entries with no
// id / no metadata are folders).
async function listAll(bucket, prefix = "") {
  const out = [];
  let offset = 0;
  for (;;) {
    // Same retry as download: a transient 502 on a LIST call is worse — it
    // skips an entire bucket, not one object.
    const { data, error } = await withRetry(`list ${bucket}/${prefix}`, () =>
      sb.storage.from(bucket).list(prefix, { limit: 1000, offset })
    );
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
let failed = 0; // any skipped bucket or failed download — a partial backup MUST NOT look green
for (const bucket of BUCKETS) {
  let paths;
  try {
    paths = await listAll(bucket);
  } catch (e) {
    console.error(`[backup] bucket "${bucket}" skipped: ${e.message}`);
    failed++;
    continue;
  }
  let n = 0;
  for (const path of paths) {
    // Supabase marks empty folders with a zero-byte placeholder row that isn't
    // a real, downloadable object (download() returns "not found"). Skip these
    // so they don't register as a backup failure.
    const base = path.split("/").pop();
    if (base === ".emptyFolderPlaceholder" || base === ".keep") continue;
    const { data, error } = await withRetry(`download ${bucket}/${path}`, () =>
      sb.storage.from(bucket).download(path)
    );
    if (error) {
      console.error(`[backup] download failed ${bucket}/${path}: ${error.message}`);
      failed++;
      continue;
    }
    const dest = join(OUT, bucket, path);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, Buffer.from(await data.arrayBuffer()));
    n++;
  }
  console.log(`[backup] ${bucket}: ${n} object(s)`);
  grandTotal += n;
}
console.log(`[backup] done — ${grandTotal} object(s) under ./${OUT}/`);
if (failed > 0) {
  // Same guarantee as backup-database.mjs: a partial backup that reports
  // success is how you discover at restore time that the artwork / tax cert
  // you needed was never captured. Fail loudly so the dead-man's-switch fires.
  console.error(`[backup] ${failed} object(s)/bucket(s) FAILED — failing the job.`);
  process.exit(1);
}
