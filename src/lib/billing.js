// Feature gating + founding-member pricing.
//
// Tiers and rates (enforced atomically by the
// claim_founding_slot Postgres function — see
// supabase/migrations/20260520_founding_member_program.sql):
//
//   founding ($50/mo) — locked for the life of the subscription, for
//     the first 50 shops to claim it at Stripe checkout. Cap is
//     enforced server-side; no public counter is exposed (intentional).
//   standard ($99/mo) — for signups after the 50 slots fill, AND
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

const ALL_FEATURES = ["quotes", "orders", "production", "invoices", "customers", "pdf", "qb_sync", "employees", "ss_restock", "wizard", "shopify", "mockups", "broker", "reports"];

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

  if (tier === "trial" && user.trial_ends_at) {
    const now = nowOverride instanceof Date
      ? nowOverride.getTime()
      : (typeof nowOverride === "number" ? nowOverride : Date.now());
    const endsAt = new Date(user.trial_ends_at).getTime();
    if (Number.isFinite(endsAt) && endsAt < now) return "expired";
  }

  return tier || "trial";
}

export function getTierLabel(tier) {
  const labels = { trial: "Free Trial", shop: "Shop", expired: "Expired" };
  return labels[tier] || tier;
}

export function getTierColor(tier) {
  const colors = {
    trial: "bg-indigo-100 text-indigo-700",
    shop: "bg-violet-100 text-violet-700",
    expired: "bg-red-100 text-red-700",
  };
  return colors[tier] || "bg-slate-100 text-slate-600";
}

export function isReadOnly(tier, status) {
  if (status === "canceled" || status === "past_due") return true;
  if (tier === "expired") return true;
  return false;
}

// PLANS now represent BILLING CADENCE (monthly vs annual), not feature
// tiers — every cadence gets every feature. The displayed price on the
// monthly plan is the standard $99; the founding $50 rate is auto-
// applied at checkout for the first 50 shops via claim_founding_slot.
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
  "Shopify inventory sync",
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
    foundingPrice: 50,
    foundingNote: "$50/mo locked for life — first 50 shops",
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
