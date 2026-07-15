// Feature gating + founding-member pricing.
//
// Tiers and rates (enforced atomically by the
// claim_founding_slot Postgres function — see
// supabase/migrations/20260520_founding_member_program.sql):
//
//   founding ($50/mo) — locked for the life of the subscription, for
//     the first 10 shops to claim it at Stripe checkout. Cap is
//     enforced server-side; no public counter is exposed (intentional).
//     Cap was tightened 50 → 10 on 2026-05-16.
//   standard ($99/mo) — for signups after the 10 slots fill, AND
//     for any prior founding member who canceled (the forfeit is
//     permanent — re-signups always pay standard).
//   annual ($999/yr) — flat parallel SKU. Doesn't consume a founding
//     slot; founding rate doesn't apply. Beta promo code can layer on
//     top of standard via Stripe Promotion Codes (3 months free +
//     $40/mo forever after that).
//
// Lifecycle:
//   - Signup → 14-day trial (no payment)
//   - At Stripe checkout, the billing edge function calls
//     claim_founding_slot. Its jsonb status determines which price
//     ID gets sent to Stripe. The client doesn't choose — single
//     source of truth is the SQL function.
//   - On customer.subscription.deleted webhook, billingWebhook sets
//     founding_rate_forfeited=true if the canceled sub was on the
//     founding rate. This is permanent.

const ALL_FEATURES = ["quotes", "orders", "production", "invoices", "customers", "pdf", "qb_sync", "employees", "ss_restock", "wizard", "mockups", "broker", "reports"];

const TIER_FEATURES = {
  trial: ALL_FEATURES,
  shop: ALL_FEATURES,
  expired: [],
};

export function canAccess(tier, feature) {
  const features = TIER_FEATURES[tier] || TIER_FEATURES.expired;
  return features.includes(feature);
}

/**
 * Resolve a user's *effective* billing tier — what canAccess()
 * should actually be checked against. This consolidates three pieces
 * of state that were previously checked ad-hoc in different places:
 *
 *   1. Admin bypass — admins (founder / staff) never lose access,
 *      regardless of subscription_tier or trial_ends_at. Treated as
 *      'shop' so they keep every feature.
 *   2. Trial expiry — a tier of 'trial' with a past trial_ends_at
 *      collapses to 'expired'. Without this step the literal tier
 *      string stayed 'trial' indefinitely and canAccess returned
 *      every feature (the bug Joe hit on 2026-05-12).
 *   3. Canceled subscription — a subscription_status of 'canceled'
 *      collapses to 'expired' even if subscription_tier is stale.
 *
 * @param {object|null|undefined} user  the user profile (must include
 *                                      role, subscription_tier,
 *                                      subscription_status, trial_ends_at)
 * @param {Date|number} [nowOverride]   inject a fixed "now" for tests
 * @returns {string}                    one of: 'shop' | 'trial' | 'expired'
 */
export function getEffectiveTier(user, nowOverride) {
  if (!user) return "expired";
  if (user.role === "admin") return "shop";

  if (user.subscription_status === "canceled") return "expired";

  const tier = user.subscription_tier;
  if (tier === "expired") return "expired";

  // 'incomplete' = signed up but no card/subscription yet (BILL-01). No access
  // until they complete Stripe Checkout (which flips them to shop/trialing).
  if (tier === "incomplete") return "expired";

  if (tier === "trial" && user.trial_ends_at) {
    const now = nowOverride instanceof Date
      ? nowOverride.getTime()
      : (typeof nowOverride === "number" ? nowOverride : Date.now());
    const endsAt = new Date(user.trial_ends_at).getTime();
    if (Number.isFinite(endsAt) && endsAt < now) return "expired";
  }

  return tier || "trial";
}

/**
 * A team member (manager / employee / broker) has NO real subscription of
 * their own — their profile sits at 'trial' from signup and then "expires",
 * which would wrongly lock them out even while the SHOP OWNER is paying. So a
 * team member's effective subscription must come from the owner.
 *
 * Given the member's profile and the owner's subscription fields (fetched
 * separately, RLS-permitted via profiles_select_shop_owner), return a profile
 * object with the owner's subscription fields applied. Owners pass ownerSub =
 * null and keep their own.
 *
 * Pure + unit-tested. The fetch happens in AuthContext.fetchUserWithProfile.
 *
 * @param {object} profile   the signed-in user's own profile
 * @param {object|null} ownerSub  { subscription_tier, subscription_status, trial_ends_at, past_due_since, cancel_at_period_end, subscription_ends_at } or null
 * @returns {object}         profile with effective subscription fields
 */
export function resolveTeamSubscription(profile, ownerSub) {
  if (!profile || !ownerSub) return profile;
  return {
    ...profile,
    subscription_tier:    ownerSub.subscription_tier,
    subscription_status:  ownerSub.subscription_status,
    trial_ends_at:        ownerSub.trial_ends_at,
    past_due_since:       ownerSub.past_due_since, // inherit the owner's grace clock (BILL-03)
    // Inherit the owner's pending-cancellation display state so team members see
    // the same "plan ends on X" notice the owner does (display only — the access
    // gate is unchanged; a pending cancel is still active until it isn't).
    cancel_at_period_end: ownerSub.cancel_at_period_end,
    subscription_ends_at: ownerSub.subscription_ends_at,
  };
}

export function getTierLabel(tier) {
  // 'incomplete' = card-required signup that hasn't added a payment method
  // yet (BILL-01). It's not expired — their trial never started.
  const labels = { trial: "Free Trial", shop: "Shop", expired: "Expired", incomplete: "No plan yet" };
  return labels[tier] || tier;
}

export function getTierColor(tier) {
  const colors = {
    trial: "bg-teal-100 text-teal-700",
    shop: "bg-green-100 text-green-700",
    expired: "bg-red-100 text-red-700",
    incomplete: "bg-slate-100 text-slate-600",
  };
  return colors[tier] || "bg-slate-100 text-slate-600";
}

// BILL-03: days a past_due subscription keeps full access before going
// read-only. Mirror of _shared/billingLogic.js PAST_DUE_GRACE_DAYS and the SQL
// has_active_subscription() grace window — keep all three in lockstep.
export const PAST_DUE_GRACE_DAYS = 7;

export function isReadOnly(tier, status, pastDueSince, now = Date.now()) {
  if (status === "canceled") return true;
  if (tier === "expired") return true;
  // past_due is read-only only AFTER the grace window; within grace (or with no
  // stamped start) the shop keeps full read-write access (BILL-03).
  if (status === "past_due") {
    if (!pastDueSince) return false;
    const t = new Date(pastDueSince).getTime();
    return Number.isFinite(t) && t < now - PAST_DUE_GRACE_DAYS * 86400000;
  }
  return false;
}

// ── CANONICAL READ-ONLY PREDICATE (client ↔ server, ONE rule) ───────────────
// Single source of truth for "is this user write-blocked?" — the EXACT INVERSE
// of the server gate `public.has_active_subscription()` (migration
// 20260811000000_bill03_past_due_grace.sql). Keep them in lockstep.
//
//   WRITABLE (not read-only) iff:
//     • role is admin or broker                        → always writable
//     • OR the governing subscription is NOT lapsed, where "lapsed" =
//         tier expired  OR  tier incomplete (never-subscribed)
//         OR status canceled
//         OR (trial AND trial_ends_at in the past)
//         OR (past_due AND past_due_since older than the 7-day grace)
//   READ-ONLY otherwise.
//
// Team members (manager/employee) inherit the shop OWNER's subscription — the
// owner's fields are applied to `user` upstream in AuthContext via
// resolveTeamSubscription, so this evaluates the governing sub for them too.
// Unresolved/absent user → NOT read-only, mirroring the server's fail-safe
// "NOT FOUND → allow". getEffectiveTier collapses expired/incomplete/canceled/
// expired-trial into 'expired', so isReadOnly's checks line up with the SQL.
export function computeReadOnly(user, now = Date.now()) {
  if (!user) return false;
  if (user.role === "admin" || user.role === "broker") return false;
  const tier = getEffectiveTier(user, now);
  return isReadOnly(tier, user.subscription_status, user.past_due_since, now);
}

// PLANS now represent BILLING CADENCE (monthly vs annual), not feature
// tiers — every cadence gets every feature. The displayed price on the
// monthly plan is the standard $99; the founding $50 rate is auto-
// applied at checkout for the first 10 shops via claim_founding_slot.
// Annual is a flat $999/yr — no founding discount, no slot consumed.
//
// `billing` is the param the checkout endpoint expects. The tier the
// user actually ends up with (founding/standard) is decided server-side.
const SHARED_FEATURES = [
  "Quotes & orders",
  "Production tracking",
  "Invoices & customers",
  "QuickBooks sync",
  "Unlimited employees",
  "S&S & AS Colour restock",
  "Embeddable quote wizard",
  "Artwork proofs",
  "Broker portal",
  "Full performance reports",
  "PDF export",
];

export const PLANS = [
  {
    billing: "monthly",
    name: "Monthly",
    price: 99,
    period: "/mo",
    features: SHARED_FEATURES,
  },
  {
    billing: "annual",
    name: "Annual",
    price: 999,
    period: "/yr",
    savingsNote: "Save $189 vs monthly",
    features: SHARED_FEATURES,
  },
];
