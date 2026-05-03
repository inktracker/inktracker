// Feature gating based on subscription tier
// Single tier: shop ($49/mo). Trial gets full access for 14 days.

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
