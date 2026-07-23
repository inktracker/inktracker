# Data durability & type-safety on the money paths

Living plan for two long-horizon investments: making data loss essentially
impossible, and putting a compiler between us and the money-math bug class.
Phases marked **✅ done** shipped in the `chore/durability-and-ts-money` branch.

---

## Track A — Data durability

### Current state (verified 2026-07-23)
- **Nightly off-platform DB backup** — `.github/workflows/db-backup.yml` +
  `scripts/backup-database.mjs`. Enumerates tables **dynamically** from
  PostgREST's OpenAPI root (no drift — new tables auto-covered), paginates,
  and **exits non-zero on any partial failure**. Last verified run:
  **38/38 tables, 118,910 rows**, off-platform GitHub artifact, 30d retention.
- **Nightly off-platform Storage backup** — `storage-backup.yml` +
  `scripts/backup-storage.mjs` (artwork + tax-exemption certs).
- **Restore procedure** proven once — `docs/disaster-recovery.md`.
- **Supabase is on the FREE tier** → no native DB backups, no PITR. The nightly
  logical export is the *only* recovery point until the Pro upgrade.

### Gaps and the plan

| Phase | Gap it closes | Status |
|-------|---------------|--------|
| **A0** | Silent-stop blindness + hollow-but-green storage backups | ✅ **done** |
| **A1** | 30d retention, single provider, plaintext at rest | planned |
| **A2** | RPO ≈ 24h (up to a day of invoices/payments lost) | needs billing decision |
| **A3** | "Backups we never test" | planned |

**A0 — ✅ done (this branch)**
- **Dead-man's-switch** on both backup workflows: a successful run pings a
  healthchecks.io monitor, so you're paged if the schedule ever silently
  *stops* (GitHub disables schedules after 60d inactivity, scheduler outages).
  A `failure()` step pings `/fail` for a same-night alert. Both no-op until the
  secret is set — see **Setup** below.
- **Hardened `backup-storage.mjs`**: now tracks skipped buckets / failed
  downloads and `process.exit(1)`s — a partial storage backup can no longer
  report success. Workflow `if-no-files-found: error` catches an empty export.

**A1 — Independent immutable archive (planned, ~half day, ~$0–5/mo)**
- Push each encrypted nightly export to **Cloudflare R2 or S3** with object
  versioning + lifecycle (daily→30d, weekly→1yr, monthly→7yr for tax records).
- **Encrypt before upload** (`age`/`gpg`, public key in the workflow, private
  key escrowed in Joe's password manager). *Design the key escrow carefully —
  a lost key turns every backup into noise, which is why A0 deliberately did
  NOT bolt on encryption without an offsite home for it.*

**A2 — Supabase Pro → PITR (billing decision, ~$25/mo)**
- Turns RPO from ~24h into minutes. This is the real recovery-point fix; the
  logical nightly then becomes the belt-and-suspenders offsite copy. Planned
  at the first paying shops.

**A3 — Quarterly restore rehearsal (planned)**
- Scheduled workflow: spin up a scratch Supabase project, replay migrations,
  load the latest backup, assert row counts match source ± tolerance, tear
  down. Record measured RPO/RTO in `disaster-recovery.md`.

**Known, accepted:** `auth.users` (password hashes/identities) is not in the
logical backup — unreachable over PostgREST. After a restore, users re-verify
by email. Documented in `disaster-recovery.md`; PITR (A2) covers it natively.

### Setup (one-time, enables the dead-man's-switch)
Create two free checks at healthchecks.io (period 1 day, grace 2h) and add
their ping URLs as repo secrets:
```
gh secret set HEALTHCHECK_DB_BACKUP_URL        # https://hc-ping.com/<uuid>
gh secret set HEALTHCHECK_STORAGE_BACKUP_URL   # https://hc-ping.com/<uuid>
```

---

## Track B — TypeScript on the money paths

### Strategy
Incremental, leaf-first, strictly enforced on a **growing** scope — never a
big-bang rewrite of the 1,446-line, 68-consumer `pricing.jsx`. Real `.ts`
files under `src/lib`/`src/types` (eslint ignores those globs; `src/utils/*.ts`
already builds, so this is proven-safe and zero import churn for extensionless
imports).

### What's enforced

- **`tsconfig.money.json`** — `strict` + `noUncheckedIndexedAccess` +
  `exactOptionalPropertyTypes`, `noEmit`, scoped to an `include` list of the
  money modules that are typed. A module joins the list the moment it's typed
  and can never regress.
- **`npm run typecheck:money`** — runs that config. Wired into the `test`
  script, so `npm test` **and CI (`test.yml`)** both enforce it. Proven to have
  teeth: reintroducing the historical string-coercion bug (`.toFixed()` on a
  possibly-string price) fails the gate.
- This is **separate** from the broad `jsconfig.json` `typecheck`, which is
  aspirational, not green, and not enforced. Don't confuse the two.

### Roadmap

| Phase | Scope | Status |
|-------|-------|--------|
| **B0** | Types file + gate + first money module (`getEffectiveCost`) | ✅ **done** |
| **B1** | `src/types/money.ts` domain vocabulary (Money as ¢ later) | ✅ **started** |
| **B2** | Extract pure calc from `pricing.jsx` into typed `.ts`, leave `.jsx` as a re-export shell so 68 consumers don't churn | next |
| **B3** | `billing.js` → `.ts`; tax module | after B2 |
| **B4** | Opt-in `checkJs` on consumers via JSDoc at import boundaries | ongoing |

**Highest-leverage next step:** B2. Strongly consider modeling `Money` as
**integer cents** during the extraction — it retires the float-rounding bug
class outright, on top of the shape-safety already in place.

### Add a module to the gate
1. Type it (real `.ts` under `src/lib`, or JSDoc + `checkJs`).
2. Add its path to `include` in `tsconfig.money.json`.
3. `npm run typecheck:money` must stay green.
