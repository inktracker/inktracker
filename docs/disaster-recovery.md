# InkTracker — Disaster Recovery Runbook

What to do when data is lost or corrupted. Backups are only as good as a
tested restore — this is that procedure. Last reviewed 2026-06-28.

## What we have today (Free tier)

- **Daily physical backups** of the Postgres database, managed by
  Supabase (WAL-G enabled). Verified via the Management API:
  `pitr_enabled: false`, `walg_enabled: true`, region `us-west-2`.
- **Nightly Storage backup** of the `artwork` + `tax-certificates` buckets to a
  GitHub artifact (`.github/workflows/storage-backup.yml`) — Supabase's daily
  backup does NOT cover Storage. See "Storage backups" below.
- **Recovery point (RPO):** up to ~24 hours (DB daily backup; Storage nightly).
  A restore rolls back to the most recent backup — anything since is lost.
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

## Restore drill (OPS-03 — run once, then annually)

The procedure below is written but UNTESTED until this drill is done. Run it
into a throwaway Supabase project to validate the chain and confirm the ~4h RTO:

1. Create a scratch Supabase project; apply `supabase/migrations/` to it.
2. Restore the latest DB backup (or load a dump) into it.
3. Download the latest `storage-backup` artifact and re-upload both buckets.
4. Set the function secrets the app needs (QB, Stripe, Resend, suppliers).
5. Point a preview frontend at the scratch project; sign in.
6. Verify: `SELECT * FROM data_integrity_violations();` is all-zero, a shop's
   quotes/orders render, a cert's signed URL opens, and QuickBooks resolves.
7. Record the wall-clock time as the measured RTO; update the target above.

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
4. **Full restore (last resort):** Supabase Dashboard → Database →
   Backups → choose the most recent good daily backup → Restore. This
   overwrites the current database. CONFIRM the backup predates the
   corruption. All shops lose data created since that backup — notify
   testers/customers.
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
