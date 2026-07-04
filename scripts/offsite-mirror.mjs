#!/usr/bin/env node
// Offsite backup mirror (T2). GitHub artifacts are capped, short-retention,
// and live next to the repo — one compromised GitHub account loses code AND
// backups. This uploads each nightly export to an S3-compatible bucket
// (Cloudflare R2 / Backblaze B2 / AWS S3) under a date-stamped, never-
// overwritten prefix, then verifies the upload with a HEAD per object.
//
//   node scripts/offsite-mirror.mjs <dir> <kind>     e.g.  db-backup db
//
// Env (repo secrets): BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET,
//   BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY, BACKUP_S3_REGION
//
// Behavior contract (from the durability brief):
//   • env unset → NO-OP with a loud warning (don't break nightly runs
//     before Joe provisions the bucket)
//   • env set and an upload fails → EXIT 1 (a silent offsite failure is
//     worse than no offsite at all)
//
// The bucket itself must have object versioning + a retention/object-lock
// policy, and its credentials must live in a SEPARATE account from the
// Supabase project — see docs/disaster-recovery.md ("Offsite mirror").

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const dir = process.argv[2];
const kind = process.argv[3] || "backup";
if (!dir) {
  console.error("usage: offsite-mirror.mjs <dir> <kind>");
  process.exit(2);
}

const { BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY } = process.env;
if (!BACKUP_S3_ENDPOINT || !BACKUP_S3_BUCKET || !BACKUP_S3_ACCESS_KEY_ID || !BACKUP_S3_SECRET_ACCESS_KEY) {
  console.warn("⚠️  [offsite] BACKUP_S3_* secrets not configured — SKIPPING the offsite mirror.");
  console.warn("⚠️  [offsite] Backups currently exist ONLY as GitHub artifacts (30-day cap, same blast radius as the repo).");
  console.warn("⚠️  [offsite] Provision the bucket + secrets per docs/disaster-recovery.md to activate this step.");
  process.exit(0);
}

const { S3Client, PutObjectCommand, HeadObjectCommand } = await import("@aws-sdk/client-s3");
const s3 = new S3Client({
  endpoint: BACKUP_S3_ENDPOINT,
  region: process.env.BACKUP_S3_REGION || "auto",
  credentials: { accessKeyId: BACKUP_S3_ACCESS_KEY_ID, secretAccessKey: BACKUP_S3_SECRET_ACCESS_KEY },
  forcePathStyle: true, // R2/B2/MinIO-friendly
});

// Date-stamped prefix (+ run id when present) — objects are never
// overwritten across runs, so history survives even without bucket
// versioning (versioning + object-lock still required as the ransomware/
// fat-finger backstop).
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const prefix = `${kind}/${stamp}-run${process.env.GITHUB_RUN_ID || "local"}`;

async function* walk(d) {
  for (const entry of await readdir(d, { withFileTypes: true })) {
    const p = join(d, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else yield p;
  }
}

let count = 0;
let bytes = 0;
for await (const file of walk(dir)) {
  const key = `${prefix}/${relative(dir, file)}`;
  const body = await readFile(file);
  await s3.send(new PutObjectCommand({ Bucket: BACKUP_S3_BUCKET, Key: key, Body: body }));
  // Verify it's really there — an upload we didn't verify is a hope, not a backup.
  const head = await s3.send(new HeadObjectCommand({ Bucket: BACKUP_S3_BUCKET, Key: key }));
  const size = (await stat(file)).size;
  if (Number(head.ContentLength) !== size) {
    console.error(`[offsite] size mismatch for ${key}: local ${size}, remote ${head.ContentLength}`);
    process.exit(1);
  }
  count++;
  bytes += size;
}

if (count === 0) {
  console.error(`[offsite] nothing to upload from ${dir} — refusing to call that success.`);
  process.exit(1);
}
console.log(`[offsite] mirrored ${count} object(s), ${bytes} bytes → s3://${BACKUP_S3_BUCKET}/${prefix}/ (verified by HEAD)`);
