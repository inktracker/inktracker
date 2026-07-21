# Fable 5 — Harden InkTracker's data durability (prove we can never silently lose user data)

You are hardening backup/restore for a multi-tenant print-shop SaaS (React + Vite frontend, Supabase Postgres + Storage + Deno edge functions, Vercel). The goal is not "add more backups" — it's to make data loss **detectable, recoverable, and provably restorable**, and to shrink the blast radius of a destructive mistake. Work autonomously through the tiers below; this is a long-horizon job — see each task to completion and verify it.

## GROUND RULES (do not violate)
- Branch `feat/data-durability`. Keep `npm test` green. Commit per task. **Do NOT deploy** and **do NOT merge to main** — Joe reviews.
- **Do NOT weaken any RLS policy** or the `has_active_subscription()` write-gate. Durability work must not open a tenant-isolation hole.
- **Do NOT** print, commit, or hardcode any secret. Read secrets only from env / GitHub Actions secrets.
- **Do NOT modify `scripts/setup-ci-secrets.sh`** — it is intentionally configured to pull the service-role key from the macOS Keychain and must stay as-is.
- Anything requiring Joe's Supabase account, billing, or key rotation goes in the "HANDOFF TO JOE" section of your report — do not attempt it.

## WHERE THINGS STAND (read these first)
- `docs/disaster-recovery.md` — the current DR runbook (honest; read it fully).
- `scripts/backup-database.mjs` + `.github/workflows/db-backup.yml` — nightly JSONL export of every public table → GitHub artifact, 30-day retention. **This is the only DB recovery point** (Free tier has no managed backups).
- `scripts/backup-storage.mjs` + `.github/workflows/storage-backup.yml` — nightly `artwork` + `tax-certificates` bucket export → GitHub artifact.
- `data_integrity_violations()` — existing SQL function used by the orphan-detection cron; reuse it as a restore-validation oracle.
- `supabase/migrations/` — 136 migrations; schema is meant to rebuild from these. Note: there are **4 invalid `CREATE POLICY IF NOT EXISTS`** statements (Postgres has no such syntax) — so the schema does NOT currently replay cleanly. Only 6 migrations use foreign keys.
- Known gaps: no point-in-time recovery, `auth.users` not backed up, restore never tested, backups live only in GitHub artifacts, no soft-delete on critical tables.

---

## T1 — Prove the backup actually restores (highest value; fully in your control)
Build a **CI restore drill** that runs the whole recovery chain automatically, so an un-restorable backup can never sit undetected.

Add `.github/workflows/restore-drill.yml` (scheduled weekly + on any PR touching `supabase/migrations/**`, `scripts/backup-*.mjs`, or the backup workflows) that, using a **GitHub Actions `postgres` service container (NO local Docker required)**:
1. Applies every file in `supabase/migrations/` to a fresh empty Postgres, in order. **Fix the 4 invalid `CREATE POLICY IF NOT EXISTS` statements** (and anything else that blocks a clean replay) so the schema builds from zero. This simultaneously closes the schema-reproducibility gap.
2. Loads a backup export (use a small committed fixture export, or the latest artifact if available) via the same code path a real restore would use, honoring FK/dependency ordering.
3. Asserts success: every expected table exists and is populated to the fixture's row counts, and `SELECT * FROM data_integrity_violations();` returns **zero rows**.
4. Fails the job loudly on any mismatch.

Acceptance: the workflow passes on a fresh Postgres from migrations alone; deliberately breaking a migration or truncating the fixture makes it fail. Record the wall-clock time as a measured RTO signal and update the target in `docs/disaster-recovery.md`.

## T2 — Get backups off GitHub artifacts into immutable offsite storage
GitHub artifacts are capped/short-retention and sit next to the repo. Add an **offsite mirror** to an S3-compatible object store (works with Cloudflare R2 / Backblaze B2 / AWS S3).
- Extend `scripts/backup-database.mjs` and `scripts/backup-storage.mjs` to also upload each nightly backup to a bucket configured via env (`BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`, `BACKUP_S3_REGION`). Use versioned object keys (date-stamped, never overwrite).
- If the offsite vars are **unset**, no-op with a clear warning (don't break existing runs before Joe adds creds). If they are **set** and the upload fails, **fail the job** — a silent offsite failure is worse than none.
- Document in the runbook that the bucket must have **object versioning + a retention/object-lock policy** so ransomware or an accidental delete cannot erase history, and that its credentials must live in a **separate account** from the Supabase project.

Acceptance: with fake S3 env pointed at a local mock (or MinIO service container), a backup run uploads a versioned object and the workflow verifies it exists; with no env, the run still succeeds with a warning.

## T3 — Alert when a backup silently fails
A backup you don't know stopped is the classic killer.
- Have each backup script write a small **manifest** (per-table row counts for the DB export; object count + total bytes for storage) and compare against the previous run. Fail/alert if a previously-non-empty table or bucket comes back empty or drastically smaller.
- Add a success ping to a dead-man's-switch monitor (`HEALTHCHECK_BACKUP_URL`, healthchecks.io style) mirroring the existing reconcile cron, so a cron that silently stops paging Joe within ~26h.
- Wire failures to the existing operator-alert path used by the notification-failure alert (commit #577) where practical.

Acceptance: an induced empty export fails the job and would alert; a healthy run pings the monitor.

## T4 — Cover auth identities
A DB restore today leaves `auth.users` behind (users must re-verify by email; stale-email owners could lose access to their own data).
- Add a service-role export of the recoverable `auth.users` fields (id, email, created_at, app/user metadata, identities) into the DB backup set.
- Document the post-restore re-link/re-invite procedure in the runbook.
- Do not export password hashes or anything that widens attack surface beyond what's needed to re-establish identities.

## T5 — Shrink the blast radius of a destructive mistake (soft-delete safety net)
With no PITR, an accidental delete is unrecoverable between nightly exports. Add a reversible safety net on the highest-value tables: `quotes`, `orders`, `invoices`, `customers`.
- Add a nullable `deleted_at timestamptz` column via migration; switch the app's destructive delete paths to set `deleted_at` (soft delete) instead of hard `DELETE`; filter it out of normal reads (including RLS-compatible views/queries — **do not change the tenancy predicate**).
- Add a scheduled hard-purge of rows soft-deleted longer than a documented window (e.g. 30 days).
- Keep every existing test green; add tests that a soft-deleted row is hidden from reads but still present for recovery.
- If this task is larger than a safe single change, split it per-table and land each with its own passing tests. Correctness over speed — never ship a version that could hide live data.

---

## HANDOFF TO JOE (do not attempt — list these in your report)
1. **Upgrade Supabase to Pro and enable the PITR add-on now** — ~10 shops' live data currently sits behind a ~24h RPO with no managed backups. This is the single biggest durability win and only Joe can do it in the dashboard/billing.
2. **Create the offsite bucket** (R2/B2/S3) in a separate account with versioning + object-lock, and set the `BACKUP_S3_*` repo secrets so T2's mirror activates.
3. **Rotate the Supabase service-role key** (still outstanding) and confirm it's only ever read from the Keychain/secrets, never pasted — it's the skeleton key that could wipe everything.

## FINAL REPORT
Provide: files/workflows added or changed; the measured restore-drill RTO; proof T1 passes on a fresh Postgres (paste the assertion output); confirmation `npm test` is green and no RLS predicate was altered; the per-table manifest row counts; and the HANDOFF list above with anything you discovered that Joe must do.
