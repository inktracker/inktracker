// Feature gating based on subscription tier.
// Single tier: shop. Trial gets full access for 14 days.
//
// TODO (founding member program — separate PR):
// The landing page is live with "Founding member pricing — $99/mo,
// first 100 shops" framing. Internal enforcement is NOT yet wired up.
// What's needed:
//
//   1. Subscription model fields (Stripe metadata + profile_secrets):
//      - is_founding_member: boolean       — set true at signup if the
//        live founding count is < 100 at the moment the checkout session
//        is created.
//      - founding_rate_active: boolean     — true while the founding-rate
//        subscription is continuous. Flipped to false (permanently) by
//        the cancellation hook below.
//
//   2. Founding count tracking:
//      - A counter (e.g. shops.is_founding_member aggregate or a
//        dedicated `founding_members` table) capped at 100.
//      - Expose the current count via a public-readable view or a
//        cheap edge function so the landing page can render
//        "Founding spots remaining: X of 100" once we want that UI.
//
//   3. Checkout-time logic (supabase/functions/billing/index.ts):
//      - If founding_count < 100 AND user has no prior
//        founding_rate_active=false record, quote the $99 price ID and
//        set is_founding_member=true + founding_rate_active=true on
//        the subscription.
//      - Otherwise (founding cap reached OR prior founding cancellation),
//        quote the $149 standard price ID.
//
//   4. Cancellation hook (supabase/functions/billingWebhook/index.ts,
//      customer.subscription.deleted):
//      - If subscription was founding (is_founding_member=true), set
//        founding_rate_active=false on the profile. This is permanent
//        and prevents the user from re-acquiring the $99 rate on re-signup.
//
//   5. Re-signup logic:
//      - If the user previously canceled and founding_rate_active is now
//        false, the checkout flow MUST quote $149 — never $99 — even if
//        spots are still available for new users.

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

export const PLANS = [
  {
    tier: "shop",
    name: "InkTracker",
    price: 99,
    features: [
      "Quotes & orders",
      "Production tracking",
      "Invoices & customers",
      "QuickBooks sync",
      "Unlimited employees",
      "S&S & AS Colour restock",
      "Embeddable quote wizard",
      "Shopify inventory sync",
      "Mockup designer",
      "Broker portal",
      "Full performance reports",
      "PDF export",
    ],
    notIncluded: [],
  },
];
