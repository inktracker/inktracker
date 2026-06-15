# InkTracker — Disaster Recovery Runbook

What to do when data is lost or corrupted. Backups are only as good as a
tested restore — this is that procedure. Last reviewed 2026-06-14.

## What we have today (Free tier)

- **Daily physical backups** of the Postgres database, managed by
  Supabase (WAL-G enabled). Verified via the Management API:
  `pitr_enabled: false`, `walg_enabled: true`, region `us-west-2`.
- **Recovery point (RPO):** up to ~24 hours. A restore rolls back to the
  most recent daily backup — anything done since that backup is lost.
- **No point-in-time recovery yet** — see "When to enable PITR" below.

## Detection layers (so you find out FAST)

These run before you'd ever need a restore:
- **Nightly data-integrity check** (qbReconcile cron) — emails the
  operator if any quote/order/invoice loses its customer link. This is
  what would have caught the beloved's orphan incident in 24h instead of
  9 months.
- **Nightly QB reconciliation** — catches missed payment webhooks + drift.
- **QB error digest** — alerts on a spike of QuickBooks errors.
- **Sentry** — runtime error capture.

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
