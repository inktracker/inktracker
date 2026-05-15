// Pure logic extracted from billing/index.ts so the security-critical
// pricing + role-gating decisions can be unit-tested without dragging
// in Deno / Stripe / Supabase clients.
//
// Anything that takes external state in (profile, RPC result, body)
// and returns a derived decision (priceTier, blockedResponse, trial
// meta) lives here. The Deno handler in billing/index.ts is a thin
// shell that wires these together with the actual SDK calls.

// ── Roles allowed to invoke billing-owner actions ────────────────────
//
// CLAUDE.md: managers have "full shop access, no billing/admin".
// Brokers + employees never touch billing/payouts. Admins (founder /
// staff) bypass everything.
//
// Frozen so callers can't mutate the allowlist at runtime — tested.
export const BILLING_OWNER_ROLES = Object.freeze(["admin", "shop"]);

// Action set that requires a billing-owner role. Listed explicitly so
// adding a new action doesn't silently inherit "open to anyone" gate
// status — adding to billing/index.ts without adding here is a bug.
export const BILLING_OWNER_ACTIONS = Object.freeze(new Set([
  "checkout",
  "portal",
  "connectStripe",
  "getStripeAccountStatus",
  "openStripeDashboard",
]));

export function isBillingOwnerAction(action) {
  return BILLING_OWNER_ACTIONS.has(action);
}

export function isBillingOwner(profile) {
  if (!profile) return false;
  return BILLING_OWNER_ROLES.includes(profile.role);
}

// ── Checkout choice + price resolution ───────────────────────────────

// Body sends `billing: "annual"` or anything else (defaults to monthly).
// Centralised here so tests pin the default behavior — frontend or
// future caller can't accidentally introduce a third value.
export function resolveBillingChoice(body) {
  return body?.billing === "annual" ? "annual" : "monthly";
}

// Map a claim_founding_slot RPC response status → priceTier decision.
// Mirrors the contract in src/lib/billing/foundingMember.js but lives
// here in the edge function's _shared so the server has its own
// independent copy (prevents accidental drift when a contributor only
// edits the front-end mirror).
export function priceTierForMonthlyClaim(claimStatus) {
  if (claimStatus === "claimed" || claimStatus === "already_member") {
    return { tier: "founding", reason: claimStatus, isError: false };
  }
  if (claimStatus === "cap_reached" || claimStatus === "forfeited") {
    return { tier: "standard", reason: claimStatus, isError: false };
  }
  return { tier: null, reason: `unexpected:${claimStatus}`, isError: true };
}

// ── Trial meta ──────────────────────────────────────────────────────

// Pure read of the profile's trial state. Does NOT collapse expired
// trials into "expired" tier — that's the frontend's job (see
// getEffectiveTier in src/lib/billing.js). This just returns the raw
// numbers so the UI can decide what to show.
export function computeTrialMeta(profile, now = Date.now()) {
  if (!profile) {
    return {
      tier: "trial",
      status: "trialing",
      trialEndsAt: null,
      trialDaysLeft: 0,
      trialExpired: false,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    };
  }
  const trialEnd = profile.trial_ends_at ? new Date(profile.trial_ends_at).getTime() : null;
  const trialDaysLeft = trialEnd
    ? Math.max(0, Math.ceil((trialEnd - now) / 86400000))
    : 0;
  const trialExpired = trialEnd ? now > trialEnd : false;
  return {
    tier: profile.subscription_tier || "trial",
    status: profile.subscription_status || "trialing",
    trialEndsAt: profile.trial_ends_at ?? null,
    trialDaysLeft,
    trialExpired,
    stripeCustomerId: profile.stripe_customer_id ?? null,
    stripeSubscriptionId: profile.stripe_subscription_id ?? null,
  };
}

// ── Stripe checkout payload builders ────────────────────────────────

// trial_period_days field on subscription_data. Returns the number of
// in-app trial days remaining, capped at 14, so Stripe's first charge
// lands exactly when the in-app trial would have ended — no fresh
// 14-day window on top of the app's 14-day window.
//
// Returns undefined if:
//   - profile isn't on the trial tier (paid resubs go to immediate charge)
//   - the trial has already expired (charge today)
//   - profile is null (defensive — no trial offered if we don't know who they are)
//
// Returns 14 if profile is on trial but missing trial_ends_at (defensive
// fallback that matches the old behavior so existing trial users don't
// get worse treatment if the column ever becomes null somehow).
//
// Stripe rejects trial_period_days < 1, so we Math.max it before
// returning. The smallest meaningful trial is 1 day.
export function trialPeriodDaysForCheckout(profile, now = Date.now()) {
  if (profile?.subscription_tier !== "trial") return undefined;
  if (!profile?.trial_ends_at) return 14;
  const endsAt = new Date(profile.trial_ends_at).getTime();
  if (!Number.isFinite(endsAt)) return 14; // malformed timestamp, fall back
  const remainingMs = endsAt - now;
  if (remainingMs <= 0) return undefined; // trial expired, charge today
  const days = Math.ceil(remainingMs / 86400000);
  return Math.max(1, Math.min(days, 14));
}

// Subscription metadata we attach to every Stripe checkout. The
// is_founding flag is the one the billingWebhook reads on cancel to
// write founding_rate_forfeited back to the profile — must be a
// string (Stripe metadata is string-typed).
export function buildSubscriptionMetadata({ profile, priceTier, billingChoice }) {
  return {
    profile_id: profile.id,
    tier: priceTier,
    billing: billingChoice,
    is_founding: priceTier === "founding" ? "true" : "false",
  };
}

// ── Stripe Connect account status ───────────────────────────────────

// Derives status from the live Stripe account.* booleans. Only three
// possible values; defined here so the UI doesn't end up with a stale
// fourth case if Stripe adds a new flag later.
export function deriveStripeAccountStatus(account) {
  if (!account) return "pending";
  if (account.charges_enabled) return "active";
  if (account.details_submitted) return "restricted";
  return "pending";
}

// ── Misc helpers ────────────────────────────────────────────────────

// Stripe customer should be created when the profile has no cached id.
// Trivial helper, but typed as a contract so we can't accidentally
// double-create a customer for a profile that already has one (which
// would orphan the old customer and lose payment history).
export function shouldCreateStripeCustomer(profile) {
  return !profile?.stripe_customer_id;
}

// Resolve the email + name we hand to stripe.customers.create. Falls
// through several profile fields so a partially-populated profile
// still gets a usable customer record.
export function stripeCustomerCreationFields(user, profile) {
  return {
    email: user?.email || profile?.email || "",
    name: profile?.shop_name || profile?.full_name || "",
    metadata: {
      profile_id: profile?.id || "",
      auth_id: user?.id || "",
    },
  };
}

// ── Cached Stripe customer staleness checks ─────────────────────────
//
// profile.stripe_customer_id can go stale in two ways:
//   1. Stripe key flipped between TEST and LIVE mode after the customer
//      was created (the cus_ ID only exists in one mode)
//   2. Someone manually deleted the customer in Stripe Dashboard
//
// Either way, blindly handing the stale ID to stripe.checkout.sessions
// .create breaks the entire checkout flow for the user. The durable
// fix is to verify the customer exists before reusing it, and if not,
// fall through to creating a new one.
//
// These two predicates capture the "should I treat this as stale?"
// decision so the edge function's API-calling code stays straight-
// forward and the logic stays unit-testable.

export function isCustomerStaleError(err) {
  if (!err) return false;
  // Stripe v14 errors have err.code === "resource_missing" for
  // not-found objects, with err.type === "StripeInvalidRequestError".
  if (err.code === "resource_missing") return true;
  // String-match fallback in case the SDK version doesn't populate
  // .code consistently. The error message always contains either
  // "No such customer" or "a similar object exists in live mode".
  const msg = String(err.message || "");
  if (/No such customer/i.test(msg)) return true;
  if (/test mode key was used/i.test(msg)) return true;
  if (/similar object exists in (live|test) mode/i.test(msg)) return true;
  return false;
}

export function isCustomerDeleted(customer) {
  // Stripe returns deleted customers with a `deleted: true` flag
  // rather than throwing. Without this check we'd happily try to use
  // a tombstoned customer ID and fail downstream.
  return Boolean(customer?.deleted);
}

// Resolve the shop_owner key the Connect actions filter `shops` by.
// Falls through profile.shop_owner → profile.email → user.email so a
// freshly-created profile (where shop_owner hasn't been set yet on the
// shop bootstrap row) still resolves correctly.
export function resolveShopOwnerKey(profile, user) {
  return profile?.shop_owner || profile?.email || user?.email || null;
}
