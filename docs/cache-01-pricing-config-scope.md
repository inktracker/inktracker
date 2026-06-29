# CACHE-01 — pricing-config (`_pc`) bleed: structural-fix scope

Status: **scoping** (Stage 1 telemetry shipped; Stage 2 structural fix not started)
Audit item: CACHE-01 · related: project_quote_immutability (the $12.62/$14.02 bug)
Author: 2026-06-29

---

## TL;DR / recommendation

`_pc` is a single module-level mutable variable in `src/components/shared/pricing.jsx`
holding **one shop's** pricing config. ~20 reads across 11 exported functions
depend on it. On multi-shop surfaces (broker dashboard, quote editor opened for
different shops) the global can hold shop B's config while we price a quote for
shop A — "config bleed."

**The scope is much smaller than "rewrite the pricing module," because two
things already contain it:**

1. **Saved quotes are immune.** `effectiveQuoteTotals()` reads SAVED snapshot
   fields (`source:"saved"`) when `quote.total > 0` and does **not** touch
   `_pc`. The known display bug (broker $12.62 vs shop $14.02) was fixed here.
2. **Stage-1 telemetry already measures the rest.** `detectPricingConfigBleed()`
   logs to Sentry whenever we price for owner X while config is loaded for Y.

So the **only** remaining bleed is the **live-recompute path** — drafts,
`total === 0`, and pre-save conversion — which calls `calcQuoteTotals` →
`calcQuoteTotalsWithLinking` → the `_pc`-reading helpers. That is the authoring
path on multi-shop surfaces.

**Recommended fix (phased, low-blast):**
- **2a** — make the two multi-shop surfaces restore the prior config after they
  borrow another shop's (stop the *stale-global-after-navigation* case). Small,
  safe, ships first.
- **2b** — extend the existing `configOverride` seam to the live-calc entry
  points (`calcQuoteTotals(q, markup, pc)`), defaulting to the global for
  back-compat, and thread the quote-owner's config at the broker / editor call
  sites.
- **2c** *(optional, durable)* — persist a minimal rate snapshot on the quote at
  save so even the live fallback can self-source. Only worth it if 2b leaves
  residual telemetry hits.

Do **not** do a full "PricingEngine instance" rewrite (Option B below) — the bug
is concentrated on 2 surfaces and 1 code path; a module-wide API change isn't
justified by the blast radius.

---

## Background

- `pricing.jsx` exposes ~47 free functions. Pricing config is hydrated once via
  `loadShopPricingConfig(config, owner)` into module globals `_pc` / `_pcOwner`.
- Production hydration sites (6):
  | Site | When | Owner context |
  |------|------|---------------|
  | `AuthContext.jsx:96/100` | login / logout | the logged-in shop (correct) |
  | `Account.jsx:1297/2821` | after a pricing edit | own shop (correct) |
  | `OnboardingWizard.jsx:182` | onboarding save | own shop (correct) |
  | `QuoteRequest.jsx:98` | public wizard load | the wizard's shop (correct, single-shop page) |
  | `QuoteEditorModal.jsx:264` | open a quote editor | **the quote's shop — multi-shop risk** |
  | `BrokerDashboard.jsx:748` | broker views a shop | **the viewed shop — multi-shop risk, never restored** |

- The two risky sites load a *specific* shop's config into the *shared* global
  and never put it back. After viewing shop A, `_pc` stays A until the next
  hydration — so any subsequent live calc for a different shop bleeds.

## Current state (what's already done)

- **Stage 1 (shipped):** `_pcOwner` tracking + `detectPricingConfigBleed()`
  telemetry (console.error → Sentry, deduped per `loaded=>quoted` pair, skips
  broker pseudo-owners and blank quotes). No math change.
- **Snapshot invariant (pre-existing):** `effectiveQuoteTotals()` /
  `savedAfterDiscount()` read saved totals straight through for saved quotes.
  This is why display/email/payment already agree across viewers.

## Precise problem statement

Bleed can only change a number when **all** of these hold:
1. We're on the **live** path (`effectiveQuoteTotals` falls through to
   `calcQuoteTotals` — i.e. draft, `total === 0`, or pre-save convert), **and**
2. the surface is **multi-shop** (broker dashboard / editor across shops), **and**
3. `_pc` currently holds a **different** shop than the quote's owner.

Two failure modes:
- **Mode A — stale global after navigation.** View shop A → `_pc = A`; act on a
  shop-B item before B re-hydrates. Fixed by **2a** (restore-after).
- **Mode B — concurrent multi-shop authoring.** Build/convert a B quote while the
  page legitimately holds A. Fixed by **2b** (thread config to the calc).

## Blast radius (concrete)

- **`_pc` reads:** ~20, across 11 exported fns —
  `calcLinkedLinePrice, getAdminMarkup, getBrokerMarkupShare, getMinOrderQty,
  getRushTiers, getRushTurnaroundDays, getShopRushRate, getStandardTurnaroundDays,
  getTechniqueOptions, getTier, newLineItem`.
- **Seam already exists:** `getEnabledTechniques`, `getTechniqueOptions`,
  `getTechniqueRates` take a `configOverride` param (`configOverride ?? _pc`).
  2b extends exactly this pattern.
- **Money-path entry points (currently global-only):**
  `calcQuoteTotals` → `calcQuoteTotalsWithLinking` (1054/987), and the QB payload
  `buildQBInvoicePayload` (1164). These are the functions to parameterize.
- **Call sites to thread config at:** broker dashboard quote build/convert, and
  `QuoteEditorModal` live recompute. (Saved-quote read sites need no change —
  they don't recompute.)

## Options considered

### Option A — parameterize (thread config explicitly) ✅ recommended (scoped)
Add an optional `pc` param to the live-calc entry points, default `_pc`; pass the
quote-owner config at multi-shop call sites.
- **Pro:** extends the existing `configOverride` seam; back-compat (default =
  global, untouched call sites keep working); pure & testable; no bleed when
  threaded.
- **Con:** any call site that *should* thread but doesn't silently falls back to
  the global (telemetry catches this). Must enumerate the broker/editor calls.
- **Blast:** small — ~3 entry-point signatures + ~2 surfaces, not 47 functions.

### Option B — PricingEngine instance (factory bound to a config)
`createPricingEngine(config)` returns all methods bound; components get it via
React context scoped to the shop being viewed.
- **Pro:** structurally impossible to bleed; cleanest end-state.
- **Con:** rewrites the module's public API; every call site across the app
  changes; highest effort and risk. **Not justified** by a 2-surface bug.

### Option C — persist rate snapshot on the quote
Store the minimal pricing inputs (tiers, markup, rush) on the quote at save;
live fallback reads them instead of `_pc`.
- **Pro:** aligns with the immutability invariant; a quote becomes
  self-pricing; durable even off its origin surface.
- **Con:** doesn't help authoring a *brand-new* quote (nothing saved yet — the
  exact Mode-B case); adds a column + backfill/compute-on-read decision; two
  sources of truth during transition.
- **Verdict:** fold in **only if** 2b leaves residual telemetry hits on the
  pre-save-convert path.

## Recommended plan (phased)

**Phase 2a — restore-after on multi-shop surfaces** *(small, ship first)*
- In `BrokerDashboard` and `QuoteEditorModal`, after borrowing a shop's config
  for render/price, restore the viewer's own config (or `null`). Or wrap
  borrow→compute→restore in a helper (`withShopConfig(cfg, owner, fn)`).
- Kills Mode A outright. Zero math change for single-shop users.

**Phase 2b — parameterize the live calc** *(structural)*
- `calcQuoteTotals(q, markup, pc = _pc)` and
  `calcQuoteTotalsWithLinking(q, markup, pc = _pc)`; thread `pc` down to the 11
  readers (or pass a resolved rate bundle). Default keeps every current caller
  identical.
- Thread the quote-owner config at broker/editor authoring calls.
- Watch `detectPricingConfigBleed` Sentry volume drop to ~0.

**Phase 2c — persist snapshot** *(optional, gated on 2b residual)*
- Add `quotes.pricing_snapshot jsonb`; stamp at save; live fallback prefers it.
- Migration-first; compute-on-read for legacy rows.

## Test strategy (the gap that hid this)

- **Unit:** extend `pricingDeepPaths.test.js` — same quote priced under config A
  vs B must differ; with 2b threaded, the threaded `pc` wins regardless of the
  global. Add a `calcQuoteTotals(q, markup, pcB)` assertion while `_pc = A`.
- **Regression guard:** a test that fails if a money-path entry point reads the
  global when an explicit `pc` is passed (mirror the `managerWriteGate` /
  `shopColumnGuard` lint-test pattern).
- **Surface test:** broker builds a live (unsaved) quote for shop B while A is
  loaded → totals match B. (Today: no coverage — why this shipped.)
- All changes ride the existing **3 wizard gates** (`npm run predeploy`) per
  CLAUDE.md, since they touch `pricing.jsx`.

## Risk & rollout

- **Risk:** the money path. Mitigated by the default-param back-compat (no
  behavior change unless a caller opts in) and the wizard gates + the new
  diff-config unit test.
- **Rollout:** 2a → observe Sentry → 2b → observe Sentry → decide on 2c.
  Each phase is independently shippable and reversible.
- **Single-shop users (the vast majority):** unaffected at every phase — the
  global path is preserved as the default.

## Decision points for Joe

1. **Approve A-scoped over B (engine rewrite)?** (Recommended: yes — blast
   radius doesn't justify B.)
2. **Is 2a + 2b enough, or do you want the durable 2c snapshot now?**
   (Recommended: ship 2a+2b, let telemetry decide 2c.)
3. **Effort:** 2a ≈ half a day; 2b ≈ 1–2 days incl. tests; 2c ≈ +1 day + a
   migration. All behind the wizard gates.
