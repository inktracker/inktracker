# Road to 1000 shops

A scaling engineer's punch-list to take InkTracker from "ready for 50 shops" to
"ready for 1000." Written 2026-07-23 after a hands-on audit. The headline: the
**architecture is right and the scariest subsystems are already hardened** — the
work ahead is measurement, a few known choke points, certification, and team.

Legend — **[me]** = engineering I can do · **[Joe]** = business/decision/hiring ·
**[blocked]** = waiting on a dependency.

---

## Already scale-ready (audited, not assumed)
Don't re-do these — they're done well:
- **Multi-tenant isolation** — RLS on all 38 tables, InitPlan-optimized, and an
  E2E test proving shop A can't read shop B. The thing most startups get wrong.
- **QuickBooks resilience** — `qbFetchWithRetry` has exponential backoff **and a
  dedicated 429 path** (respects Intuit's `Retry-After`, caps to the function
  budget, throws a tagged rate-limit error). Plus token-refresh **locking**
  (kills the double-refresh race) and **idempotency** (row locks + TTL) that
  prevents duplicate invoices under concurrency. This is exactly the scale
  hardening a pro looks for — it's here.
- **Load-test harness** — parameterized k6 with a prod safety guard and SLO
  thresholds. Just needs bigger profiles + a safe target to run against.
- **Backups + dead-man's switches, secret/dependency scanning, deploy gates.**

## The real gates to 1000 (in dependency order)

### Phase 0 — Measurement prep (now, unblocked)  **[me]**
You don't guess at scale, you measure. Before hardening anything, build the
ability to find the *actual* bottleneck.
- ✅ This roadmap.
- ✅ `loadtest/scale-1000.js` — a 1000-shop peak-concurrency profile on the
  existing harness (documented assumptions, prod-guarded). Ready to run the
  moment a safe target exists.

### Phase 1 — Staging + first real measurement (needs Pro)  **[blocked → me]**
The #1 *engineering* gap: there is no staging. Migrations and edge-function
deploys go straight to prod (I applied RLS migrations directly to prod during
the audit). At 1000 shops a bad migration = 1000 shops down, no undo.
- **[Joe]** Supabase **Pro** (in progress) unlocks **database branching**.
- **[me]** Wire branching → a preview DB per PR (migrations run there first),
  paired with Vercel preview deploys. Add a migration-test CI job.
- **[me]** Run `scale-1000.js` against a staging branch → **find the true
  bottleneck** (likely the Supavisor connection pool or one hot query — not
  guessed, measured). Everything in Phase 3 gets prioritized by this result.

### Phase 2 — QuickBooks certification (business gate)  **[Joe]**
The QB *code* is ready; the *cap* is not. Unpublished Intuit apps have a
production connection limit — you cannot legally serve 1000 shops on it.
- **[Joe]** Complete Intuit's **App Store / production certification** to lift
  the connection cap. This is the single hardest external gate and it has lead
  time — start it early. (See `project_inktracker_qb_cert_deferral`.)

### Phase 3 — Close the measured bottleneck + known choke points  **[me]**
Prioritized by Phase 1's measurement. Known candidates:
- **Shared-credential choke points.** Shops without their own S&S account fall
  back to a single shared `SS_API_KEY`; email runs on a shared Resend key. At
  scale these are single points of contention (one busy tenant degrades all) and
  deliverability/reputation risk. → per-tenant credentials or per-tenant rate
  limits on the shared path; a real email-sending strategy (dedicated domain,
  warmup, per-tenant throttles).
- **Per-tenant rate limiting.** Today limits are per-IP. Add per-**shop** quotas
  so one tenant can't starve the pool (noisy-neighbor).
- **Connection-pool config** (Supavisor) — size and mode tuned to the measured
  concurrency.
- **SLO observability.** Move from "is it up" to p95/p99 per endpoint with
  alerting on degradation (Sentry perf is already wired; turn it on).

### Phase 4 — The human layer  **[Joe]**
Not a code problem, but the most honest blocker. One person cannot support,
on-call, and incident-respond for 1000 shops.
- **[Joe]** A second engineer (also fixes bus-factor-1 on QB/tax internals).
- **[me]** Support/admin tooling to debug a *specific* shop fast; incident
  runbooks so incidents don't all route through one head.

---

## The honest bottom line
The expensive-to-fix part — architecture, data isolation, QB resilience — is
already right. Nothing here is a rewrite. The path is: **get staging → measure →
close the specific bottleneck → clear the shared choke points → certify QB →
hire.** Do those and 1000 is a capacity question with a known answer, not a leap
of faith.
