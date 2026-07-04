# InkTracker — Disaster Recovery Runbook

What to do when data is lost or corrupted. Backups are only as good as a
tested restore — this is that procedure. Last reviewed 2026-06-28.

## What we have today (Free tier)

- **CORRECTION (2026-07-03): Supabase-managed DB backups DO NOT EXIST on
  this project.** The earlier claim here inferred them from
  `walg_enabled: true`, but the Management API's backups endpoint returns
  `"backups": []` — WAL-G is platform infrastructure, not a restorable
  customer backup. Free tier includes no database backups; they start
  with the Pro upgrade (planned at 5 paying shops).
- **Nightly DB data export** (`.github/workflows/db-backup.yml`, 04:00 UTC)
  — every public table as JSONL in a GitHub artifact (30-day retention).
  Until the Pro upgrade this is the ONLY database recovery point. Schema
  restores from `supabase/migrations/`; auth.users identities are not
  covered (users re-verify by email after a restore). See "DB restore
  from the JSONL export" below.
- **Nightly Storage backup** of the `artwork` + `tax-certificates` buckets to a
  GitHub artifact (`.github/workflows/storage-backup.yml`) — Storage isn't
  covered by any DB backup. See "Storage backups" below.
- **Recovery point (RPO):** up to ~24 hours (DB export + Storage, both nightly).
  A restore rolls back to the most recent export — anything since is lost.
- **Recovery time (RTO) target: ~4 hours** — from declaring an incident to a
  verified-restored app: DB restore (Supabase, ~30–60 min) + Storage re-upload
  from the artifact + redeploy frontend/functions + the post-restore
  verification below. Target until the restore drill is run (see OPS-03 drill).
- **No point-in-time recovery yet** — see "When to enable PITR" below.

## Detection layers (so you find out FAST)

These run before you'd ever need a restore:
- **Nightly data-integrity check** (qbReconcile cron) — emails the
  operator if any quote/order/invoice loses its customer link. This is
  what would have caught the beloved's orphan incident in 24h instead of
  9 months.
- **Nightly QB reconciliation** — catches missed payment webhooks + drift.
- **QB error digest** — alerts on a spike of QuickBooks errors.
- **Uptime monitor** (OPS-04) — `.github/workflows/uptime.yml` hits the prod
  frontend + `/api/health` hourly; a non-200 fails the job → GitHub emails
  admins. Runs on GitHub's infra so it still fires when Vercel/Supabase are
  down. For 1–5 min granularity, also point a free UptimeRobot/healthchecks
  monitor at `https://www.inktracker.app/api/health`.
- **Reconcile dead-man's-switch** (OPS-05) — the reconcile cron pings
  healthchecks.io on success; the monitor pages if no ping arrives in ~26h, so
  a silently-stopped cron is caught (set `HEALTHCHECK_RECONCILE_URL`).
- **Sentry** — runtime error capture (frontend; edge instrumentation is a
  follow-up — needs an edge SENTRY_DSN).

## Storage backups (OPS-02)

Supabase's daily backup is **Postgres only** — Storage is not included, so a
clean DB restore would still leave every artwork/cert reference dangling and
lose tax-compliance documents.

- **Backup:** `.github/workflows/storage-backup.yml` runs `scripts/backup-storage.mjs`
  nightly (04:30 UTC), downloading every object in `artwork` + `tax-certificates`
  into a GitHub artifact (`storage-backup-<run_id>`, 30-day retention). Needs
  repo secrets `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
- **Restore:** download the most recent `storage-backup` artifact from the
  Actions run, then re-upload per bucket preserving paths, e.g.
  `supabase storage cp --recursive ./artwork "ss:///artwork"` (or the dashboard
  / a small upload script using the service role). Paths must match exactly —
  `tax-certificates` objects live under `<shop_owner>/<uuid>` (SEC-01).
- **Caveat:** the artifact is a recovery point, not a high-durability store
  (capped retention/size). It complements, not replaces, enabling Supabase
  PITR + a proper offsite once paying.

## Offsite mirror (T2 — inert until the bucket exists)

GitHub artifacts are capped, expire in 30 days, and sit in the same blast
radius as the repo — one compromised GitHub account loses code AND backups.
Both nightly workflows therefore run `scripts/offsite-mirror.mjs`, which
uploads the full export to an S3-compatible bucket under a date-stamped,
never-overwritten prefix and verifies every object with a HEAD request.
Until the `BACKUP_S3_*` secrets exist it no-ops with a loud warning; once
they exist, an upload failure FAILS the backup job (a silent offsite
failure is worse than none).

**Bucket requirements (Joe, one-time):**
- Provider: Cloudflare R2, Backblaze B2, or AWS S3 — anything S3-compatible.
- **In a SEPARATE account** from the Supabase project and ideally from the
  GitHub org — the whole point is surviving a compromise of the primary
  accounts. Separate email, separate password manager entry, MFA on.
- **Object versioning ON** and a **retention / object-lock (compliance
  mode) policy** of ≥30 days, so ransomware or a fat-fingered
  delete-everything cannot erase history even WITH the credentials.
- Credentials: a write-only (PutObject/HeadObject) key if the provider
  supports it — the nightly job never needs to read or delete.
- Then: `gh secret set BACKUP_S3_ENDPOINT / BACKUP_S3_BUCKET /
  BACKUP_S3_ACCESS_KEY_ID / BACKUP_S3_SECRET_ACCESS_KEY / BACKUP_S3_REGION`
  and the next nightly run starts mirroring automatically.

## Restore drill (OPS-03 — AUTOMATED, weekly)

**As of 2026-07-03 the core recovery chain is drilled automatically.**
`.github/workflows/restore-drill.yml` runs every Monday and on any PR that
touches `supabase/migrations/**` or the backup/restore scripts. It:

1. Replays the **entire** migration chain (baseline → every file) onto an
   empty Postgres 16 service container — proving the schema rebuilds from
   source. `20260430000000_baseline_schema.sql` is the generated origin
   (the pre-migration tables never had a migration until now);
   `20260831000000_out_of_band_capture.sql` holds the dashboard-created
   functions/policies/indexes that were never committed. Both are
   idempotent no-ops against the live DB.
2. Restores the committed fixture export through
   `scripts/restore-database.mjs` — **the same script a real restore uses**
   (direct-Postgres mode in the drill; PostgREST mode against a real
   project), including re-establishing `auth.users` identities from
   `auth_users.jsonl`.
3. Asserts: every baseline table exists, every fixture table matches its
   row counts (hard floors defend against fixture truncation), and
   `data_integrity_violations()` is all-zero — the same oracle the nightly
   prod cron runs.

A broken migration, an un-loadable export, or an integrity violation fails
the workflow loudly. Measured RTO signal (2026-07-03): the DB portion —
full schema replay + fixture restore + verification — completes in
**~2 seconds of database work (1–2 min CI wall clock with runner setup)**.
The ~4h full-incident RTO target above is therefore dominated by the human
steps (scratch project provisioning, Storage re-upload, secrets, redeploy),
not the DB restore.

The ANNUAL full-stack drill (scratch Supabase project + Storage re-upload +
preview frontend + QB resolution) is still worth one run before onboarding
past 10 shops — the automated drill covers the DB chain, not Storage or
edge-function wiring:

1. Create a scratch Supabase project; apply `supabase/migrations/` to it.
2. Restore the latest DB backup via `node scripts/restore-database.mjs
   <backup-dir>` with the scratch project's URL + service key.
3. Download the latest `storage-backup` artifact and re-upload both buckets.
4. Set the function secrets the app needs (QB, Stripe, Resend, suppliers).
5. Point a preview frontend at the scratch project; sign in.
6. Verify: `SELECT * FROM data_integrity_violations();` is all-zero, a shop's
   quotes/orders render, a cert's signed URL opens, and QuickBooks resolves.
7. Record the wall-clock time as the measured full-incident RTO.

## Restore procedure (daily backup)

1. **Stop the bleeding.** If corruption is ongoing (a bad migration, a
   runaway script), pause it first. Put the app in a safe state if needed
   (Vercel: roll back the deployment; `vercel rollback`).
2. **Assess scope.** Is it one table / a few rows (targeted fix) or
   broad corruption (full restore)? For a few rows, prefer a manual
   data fix over a full restore — a full restore loses ALL data since the
   last backup, for every shop.
3. **Targeted fix (preferred when possible):** use the Management API SQL
   runner (or dashboard SQL editor) to repair the affected rows directly.
   This is how the beloved's/Choo Choo's invoices were relinked — no full
   restore needed.
4. **Full restore (last resort) — DB restore from the JSONL export.**
   There is NO dashboard restore on the free tier (backups list is empty —
   see the correction at the top). The path is:
   a. Download the newest good `db-backup-<run_id>` artifact from
      GitHub → Actions → "DB backup" (confirm it PREDATES the corruption).
   b. Recreate schema: fresh project or wiped schema, then
      `supabase db push` replays every migration.
   c. Re-insert data per table from the JSONL, service-role key, in
      insert-safe order (profiles/shops first, then customers, quotes,
      orders, invoices, the rest — no hard FKs, see DB-03). A loop of
      `supabase-js .insert()` in 500-row chunks is fine at current scale.
   d. auth identities ARE in the export as `auth_users.jsonl` (T4,
      2026-07-03): id, email, timestamps, app/user metadata, identity
      providers — no password hashes or secrets. Re-link procedure:
        • Restoring into a scratch/drill Postgres: `restore-database.mjs`
          inserts them into auth.users directly (id preserved, so
          profiles.auth_id FKs resolve).
        • Restoring into a REAL Supabase project: the auth schema can't be
          written over PostgREST. For each row in auth_users.jsonl call the
          Admin API `auth.admin.createUser({ id, email, email_confirm:
          true, app_metadata, user_metadata })` with the service role —
          preserving the original `id` is what keeps profiles.auth_id
          valid. Password-based users then use "Forgot password" to set a
          new one (hashes are deliberately not backed up); OAuth users
          just sign in again.
        • If ids were NOT preserved (worst case), users re-register with
          the SAME email and profiles rejoin by email on first login
          (adminAction orphan-claim guard notes apply).
   e. Storage: re-upload from the storage-backup artifact (below).
5. **Post-restore verify:** run `SELECT * FROM data_integrity_violations();`
   (must be all zeros), spot-check a few shops' quotes/orders, and confirm
   the QB token table still resolves (managers/owners can reach QuickBooks).

## Edge functions / app code

Code is NOT in the database — it's in Git + Vercel. To recover app state:
`git` history is the source of truth; redeploy with `npx vercel --prod`
and `npx supabase functions deploy <name>` for edge functions. Migrations
live in `supabase/migrations/` (committed).

## When to enable PITR (the upgrade trigger)

**Enable PITR the day you take your first paying customer.** Rationale
(decided 2026-06-14): on the free-tester phase, daily backups are
adequate — worst case is "restore yesterday." Once shops depend on
InkTracker for daily revenue operations, losing up to 24h of their quotes/
orders/invoices becomes a real liability, and PITR drops RPO from ~24h to
minutes.

Cost: requires Supabase **Pro ($25/mo)** + the **PITR add-on**
(7-day $100/mo / 14-day $200 / 28-day $400). 7-day is the standard SMB
choice = **$125/mo total**.

Steps (dashboard, billing action — needs a payment method):
1. Supabase Dashboard → Organization → Billing → upgrade to **Pro**.
2. Project → Settings → Add-ons → **Point-in-Time Recovery** → 7 days.
3. Tell Claude — it'll verify via the Management API and restore the
   stronger backup wording on the public /security page (currently
   honestly says PITR is "on our roadmap").

After PITR is on, restore gains a "recover to a specific timestamp"
option in Database → Backups, in addition to the daily snapshots.
