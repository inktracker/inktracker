import { describe, it, expect } from "vitest";
import {
  BILLING_OWNER_ROLES,
  BILLING_OWNER_ACTIONS,
  isBillingOwnerAction,
  isBillingOwner,
  resolveBillingChoice,
  priceTierForMonthlyClaim,
  computeTrialMeta,
  trialPeriodDaysForCheckout,
  buildSubscriptionMetadata,
  deriveStripeAccountStatus,
  shouldCreateStripeCustomer,
  stripeCustomerCreationFields,
  resolveShopOwnerKey,
  isCustomerStaleError,
  isCustomerDeleted,
} from "../billingLogic.js";

// ── Role gate ─────────────────────────────────────────────────────────
//
// Anyone reading these tests should treat them as the contract:
// changing the allowed roles or the gated actions WITHOUT updating
// the test set indicates a security-relevant change worth scrutiny.

describe("BILLING_OWNER_ROLES", () => {
  it("contains exactly admin + shop", () => {
    expect(BILLING_OWNER_ROLES.slice().sort()).toEqual(["admin", "shop"]);
  });

  it("is frozen so no caller can mutate it at runtime", () => {
    expect(Object.isFrozen(BILLING_OWNER_ROLES)).toBe(true);
  });

  it("does NOT include manager — managers have shop access without billing", () => {
    expect(BILLING_OWNER_ROLES).not.toContain("manager");
  });

  it("does NOT include broker, employee, or user", () => {
    expect(BILLING_OWNER_ROLES).not.toContain("broker");
    expect(BILLING_OWNER_ROLES).not.toContain("employee");
    expect(BILLING_OWNER_ROLES).not.toContain("user");
  });
});

describe("BILLING_OWNER_ACTIONS", () => {
  it("includes the five known billing/payouts actions", () => {
    expect(isBillingOwnerAction("checkout")).toBe(true);
    expect(isBillingOwnerAction("portal")).toBe(true);
    expect(isBillingOwnerAction("connectStripe")).toBe(true);
    expect(isBillingOwnerAction("getStripeAccountStatus")).toBe(true);
    expect(isBillingOwnerAction("openStripeDashboard")).toBe(true);
  });

  it("does NOT gate getSubscription — managers/employees need to read trial state for UI", () => {
    expect(isBillingOwnerAction("getSubscription")).toBe(false);
  });

  it("does NOT gate activateTrial — only callable when role=user anyway, separate gate", () => {
    expect(isBillingOwnerAction("activateTrial")).toBe(false);
  });

  it("does NOT gate unknown actions — handler returns 'Unknown action' rather than 403", () => {
    expect(isBillingOwnerAction("hax")).toBe(false);
    expect(isBillingOwnerAction("")).toBe(false);
    expect(isBillingOwnerAction(undefined)).toBe(false);
  });
});

describe("isBillingOwner", () => {
  it("admin and shop pass", () => {
    expect(isBillingOwner({ role: "admin" })).toBe(true);
    expect(isBillingOwner({ role: "shop" })).toBe(true);
  });

  it("manager / broker / employee / user / unknown fail", () => {
    expect(isBillingOwner({ role: "manager" })).toBe(false);
    expect(isBillingOwner({ role: "broker" })).toBe(false);
    expect(isBillingOwner({ role: "employee" })).toBe(false);
    expect(isBillingOwner({ role: "user" })).toBe(false);
    expect(isBillingOwner({ role: "owner" })).toBe(false); // not a real role
  });

  it("null/undefined profile fails closed", () => {
    expect(isBillingOwner(null)).toBe(false);
    expect(isBillingOwner(undefined)).toBe(false);
    expect(isBillingOwner({})).toBe(false);
  });
});

// ── resolveBillingChoice ─────────────────────────────────────────────

describe("resolveBillingChoice", () => {
  it("returns 'annual' only on exact body.billing === 'annual'", () => {
    expect(resolveBillingChoice({ billing: "annual" })).toBe("annual");
  });

  it("defaults to 'monthly' for any other input", () => {
    expect(resolveBillingChoice({ billing: "monthly" })).toBe("monthly");
    expect(resolveBillingChoice({ billing: "yearly" })).toBe("monthly"); // typo defends
    expect(resolveBillingChoice({ billing: "ANNUAL" })).toBe("monthly"); // case-sensitive on purpose
    expect(resolveBillingChoice({ billing: undefined })).toBe("monthly");
    expect(resolveBillingChoice({})).toBe("monthly");
    expect(resolveBillingChoice(null)).toBe("monthly");
    expect(resolveBillingChoice(undefined)).toBe("monthly");
  });
});

// ── priceTierForMonthlyClaim ─────────────────────────────────────────

describe("priceTierForMonthlyClaim", () => {
  it("claimed → founding (new $50/mo founder)", () => {
    expect(priceTierForMonthlyClaim("claimed"))
      .toEqual({ tier: "founding", reason: "claimed", isError: false });
  });

  it("already_member → founding (idempotent re-call)", () => {
    expect(priceTierForMonthlyClaim("already_member"))
      .toEqual({ tier: "founding", reason: "already_member", isError: false });
  });

  it("cap_reached → standard ($99/mo, post-50)", () => {
    expect(priceTierForMonthlyClaim("cap_reached"))
      .toEqual({ tier: "standard", reason: "cap_reached", isError: false });
  });

  it("forfeited → standard (prior-canceler, no second bite at $50)", () => {
    expect(priceTierForMonthlyClaim("forfeited"))
      .toEqual({ tier: "standard", reason: "forfeited", isError: false });
  });

  it("any other status → error (refuse to proceed silently)", () => {
    const r = priceTierForMonthlyClaim("no_profile");
    expect(r.isError).toBe(true);
    expect(r.tier).toBe(null);
    expect(r.reason).toMatch(/unexpected/);
  });

  it("undefined / null status → error", () => {
    expect(priceTierForMonthlyClaim(undefined).isError).toBe(true);
    expect(priceTierForMonthlyClaim(null).isError).toBe(true);
  });
});

// ── computeTrialMeta ─────────────────────────────────────────────────

describe("computeTrialMeta", () => {
  const NOW = new Date("2026-05-14T00:00:00Z").getTime();
  const daysFromNow = (n) => new Date(NOW + n * 86400000).toISOString();

  it("returns 14-ish days when trial ends in 14 days", () => {
    const out = computeTrialMeta(
      { trial_ends_at: daysFromNow(14), subscription_tier: "trial", subscription_status: "trialing" },
      NOW,
    );
    expect(out.trialDaysLeft).toBe(14);
    expect(out.trialExpired).toBe(false);
  });

  it("returns 0 days + expired=true when trial ends in the past", () => {
    const out = computeTrialMeta(
      { trial_ends_at: daysFromNow(-2), subscription_tier: "trial" },
      NOW,
    );
    expect(out.trialDaysLeft).toBe(0);
    expect(out.trialExpired).toBe(true);
  });

  it("returns expired=false when there's no trial_ends_at on the profile", () => {
    const out = computeTrialMeta({ subscription_tier: "shop" }, NOW);
    expect(out.trialEndsAt).toBe(null);
    expect(out.trialExpired).toBe(false);
    expect(out.trialDaysLeft).toBe(0);
  });

  it("does NOT collapse trial → expired in the returned tier (frontend's job)", () => {
    const out = computeTrialMeta(
      { trial_ends_at: daysFromNow(-30), subscription_tier: "trial" },
      NOW,
    );
    // tier stays "trial" even though trial expired — this matches the
    // server contract; getEffectiveTier on the client does the collapse.
    expect(out.tier).toBe("trial");
  });

  it("uses default tier='trial' status='trialing' when profile fields are missing", () => {
    const out = computeTrialMeta({}, NOW);
    expect(out.tier).toBe("trial");
    expect(out.status).toBe("trialing");
  });

  it("passes Stripe IDs through when present", () => {
    const out = computeTrialMeta({
      stripe_customer_id: "cus_X",
      stripe_subscription_id: "sub_X",
    }, NOW);
    expect(out.stripeCustomerId).toBe("cus_X");
    expect(out.stripeSubscriptionId).toBe("sub_X");
  });

  it("returns sane defaults on null profile (don't crash if loadProfile failed)", () => {
    const out = computeTrialMeta(null, NOW);
    expect(out.tier).toBe("trial");
    expect(out.trialDaysLeft).toBe(0);
    expect(out.trialExpired).toBe(false);
    expect(out.stripeCustomerId).toBe(null);
  });
});

// ── trialPeriodDaysForCheckout ───────────────────────────────────────

describe("trialPeriodDaysForCheckout", () => {
  const NOW = new Date("2026-05-14T00:00:00Z").getTime();
  const daysFromNow = (n) => new Date(NOW + n * 86400000).toISOString();

  it("returns full 14 when trial_ends_at is exactly 14 days from now", () => {
    expect(trialPeriodDaysForCheckout(
      { subscription_tier: "trial", trial_ends_at: daysFromNow(14) },
      NOW,
    )).toBe(14);
  });

  it("returns REMAINING days when partway through the in-app trial (no doubling)", () => {
    // The fix for the doubling bug: 4 days left in-app should produce
    // 4 days in Stripe, not 14. Otherwise users get ~24 free days
    // instead of the 14 we promised on the landing page.
    expect(trialPeriodDaysForCheckout(
      { subscription_tier: "trial", trial_ends_at: daysFromNow(4) },
      NOW,
    )).toBe(4);
  });

  it("returns 1 (minimum Stripe accepts) when only a few hours remain", () => {
    expect(trialPeriodDaysForCheckout(
      { subscription_tier: "trial", trial_ends_at: new Date(NOW + 3 * 3600 * 1000).toISOString() },
      NOW,
    )).toBe(1);
  });

  it("caps at 14 days even if trial_ends_at is weirdly far in the future", () => {
    expect(trialPeriodDaysForCheckout(
      { subscription_tier: "trial", trial_ends_at: daysFromNow(60) },
      NOW,
    )).toBe(14);
  });

  it("returns undefined when the trial has already expired (charge today)", () => {
    expect(trialPeriodDaysForCheckout(
      { subscription_tier: "trial", trial_ends_at: daysFromNow(-2) },
      NOW,
    )).toBe(undefined);
  });

  it("returns undefined at the exact moment of expiry", () => {
    expect(trialPeriodDaysForCheckout(
      { subscription_tier: "trial", trial_ends_at: new Date(NOW).toISOString() },
      NOW,
    )).toBe(undefined);
  });

  it("falls back to 14 when trial_ends_at is missing (existing trial users)", () => {
    expect(trialPeriodDaysForCheckout(
      { subscription_tier: "trial" },
      NOW,
    )).toBe(14);
  });

  it("falls back to 14 when trial_ends_at is malformed", () => {
    expect(trialPeriodDaysForCheckout(
      { subscription_tier: "trial", trial_ends_at: "not a date" },
      NOW,
    )).toBe(14);
  });

  it("returns undefined for active shop tier (no trial extension on resub)", () => {
    expect(trialPeriodDaysForCheckout({ subscription_tier: "shop" }, NOW)).toBe(undefined);
  });

  it("returns undefined for null profile (no trial offered if we don't know who they are)", () => {
    expect(trialPeriodDaysForCheckout(null, NOW)).toBe(undefined);
  });
});

// ── buildSubscriptionMetadata ────────────────────────────────────────

describe("buildSubscriptionMetadata", () => {
  it("emits is_founding='true' (string) only for the founding tier", () => {
    const m = buildSubscriptionMetadata({
      profile: { id: "prof-1" },
      priceTier: "founding",
      billingChoice: "monthly",
    });
    expect(m.is_founding).toBe("true"); // string, not boolean
  });

  it("emits is_founding='false' (string) for standard/annual", () => {
    expect(
      buildSubscriptionMetadata({ profile: { id: "p" }, priceTier: "standard", billingChoice: "monthly" }).is_founding,
    ).toBe("false");
    expect(
      buildSubscriptionMetadata({ profile: { id: "p" }, priceTier: "annual", billingChoice: "annual" }).is_founding,
    ).toBe("false");
  });

  it("carries profile_id, tier, and billing in the metadata bag", () => {
    expect(buildSubscriptionMetadata({
      profile: { id: "prof-42" },
      priceTier: "standard",
      billingChoice: "annual",
    })).toEqual({
      profile_id: "prof-42",
      tier: "standard",
      billing: "annual",
      is_founding: "false",
    });
  });
});

// ── deriveStripeAccountStatus ────────────────────────────────────────

describe("deriveStripeAccountStatus", () => {
  it("active when charges_enabled", () => {
    expect(deriveStripeAccountStatus({ charges_enabled: true })).toBe("active");
    // charges_enabled wins over details_submitted
    expect(deriveStripeAccountStatus({ charges_enabled: true, details_submitted: false })).toBe("active");
  });

  it("restricted when details_submitted but not charges_enabled", () => {
    expect(deriveStripeAccountStatus({ charges_enabled: false, details_submitted: true })).toBe("restricted");
  });

  it("pending when neither flag is set", () => {
    expect(deriveStripeAccountStatus({})).toBe("pending");
    expect(deriveStripeAccountStatus({ charges_enabled: false })).toBe("pending");
  });

  it("pending when account is null (defensive)", () => {
    expect(deriveStripeAccountStatus(null)).toBe("pending");
    expect(deriveStripeAccountStatus(undefined)).toBe("pending");
  });
});

// ── shouldCreateStripeCustomer ───────────────────────────────────────

describe("shouldCreateStripeCustomer", () => {
  it("true when no cached customer ID", () => {
    expect(shouldCreateStripeCustomer({})).toBe(true);
    expect(shouldCreateStripeCustomer({ stripe_customer_id: "" })).toBe(true);
    expect(shouldCreateStripeCustomer({ stripe_customer_id: null })).toBe(true);
  });

  it("false when a customer ID is already on the profile", () => {
    expect(shouldCreateStripeCustomer({ stripe_customer_id: "cus_X" })).toBe(false);
  });

  it("true on null profile (defensive)", () => {
    expect(shouldCreateStripeCustomer(null)).toBe(true);
  });
});

// ── stripeCustomerCreationFields ─────────────────────────────────────

describe("stripeCustomerCreationFields", () => {
  it("prefers user.email over profile.email", () => {
    const out = stripeCustomerCreationFields(
      { id: "u-1", email: "user@example.com" },
      { id: "p-1", email: "profile@example.com", shop_name: "Acme" },
    );
    expect(out.email).toBe("user@example.com");
  });

  it("falls back to profile.email when user.email is missing", () => {
    const out = stripeCustomerCreationFields(
      { id: "u-1" },
      { id: "p-1", email: "profile@example.com" },
    );
    expect(out.email).toBe("profile@example.com");
  });

  it("prefers shop_name → full_name → empty string", () => {
    expect(
      stripeCustomerCreationFields({ email: "x" }, { shop_name: "ShopName", full_name: "Joe" }).name,
    ).toBe("ShopName");
    expect(
      stripeCustomerCreationFields({ email: "x" }, { full_name: "Joe" }).name,
    ).toBe("Joe");
    expect(
      stripeCustomerCreationFields({ email: "x" }, {}).name,
    ).toBe("");
  });

  it("attaches profile_id + auth_id metadata so we can map a Stripe customer back to a profile later", () => {
    const out = stripeCustomerCreationFields(
      { id: "u-1", email: "x" },
      { id: "p-1", email: "x" },
    );
    expect(out.metadata).toEqual({ profile_id: "p-1", auth_id: "u-1" });
  });

  it("survives null inputs without crashing", () => {
    const out = stripeCustomerCreationFields(null, null);
    expect(out.email).toBe("");
    expect(out.name).toBe("");
    expect(out.metadata.profile_id).toBe("");
  });
});

// ── resolveShopOwnerKey ──────────────────────────────────────────────

describe("isCustomerStaleError", () => {
  it("recognises Stripe's resource_missing code", () => {
    expect(isCustomerStaleError({ code: "resource_missing" })).toBe(true);
  });

  it("recognises the 'No such customer' message", () => {
    expect(isCustomerStaleError({ message: "No such customer: 'cus_X'" })).toBe(true);
  });

  it("recognises the live/test-mode flip message we hit on launch day", () => {
    // This is the actual error string Joe saw after the STRIPE_KEY
    // ordering fix when his cached customer was test-mode but the
    // function had flipped to live mode.
    expect(isCustomerStaleError({
      message: "No such customer: 'cus_X'; a similar object exists in live mode, but a test mode key was used to make this request.",
    })).toBe(true);
  });

  it("recognises the reverse direction (similar object exists in test mode)", () => {
    expect(isCustomerStaleError({
      message: "a similar object exists in test mode, but a live mode key was used",
    })).toBe(true);
  });

  it("does NOT match generic Stripe errors — only stale-customer ones", () => {
    expect(isCustomerStaleError({ code: "card_declined" })).toBe(false);
    expect(isCustomerStaleError({ message: "Your card was declined." })).toBe(false);
    expect(isCustomerStaleError({ message: "Insufficient funds" })).toBe(false);
  });

  it("returns false on null/undefined", () => {
    expect(isCustomerStaleError(null)).toBe(false);
    expect(isCustomerStaleError(undefined)).toBe(false);
  });
});

describe("isCustomerDeleted", () => {
  it("true when deleted flag is set", () => {
    expect(isCustomerDeleted({ deleted: true, id: "cus_X" })).toBe(true);
  });

  it("false when customer is active (no deleted flag)", () => {
    expect(isCustomerDeleted({ id: "cus_X" })).toBe(false);
    expect(isCustomerDeleted({ deleted: false, id: "cus_X" })).toBe(false);
  });

  it("false on null/undefined (defensive — caller decides)", () => {
    expect(isCustomerDeleted(null)).toBe(false);
    expect(isCustomerDeleted(undefined)).toBe(false);
  });
});

describe("resolveShopOwnerKey", () => {
  it("prefers profile.shop_owner (the broker case — broker's profile points at the shop they work for)", () => {
    expect(resolveShopOwnerKey(
      { shop_owner: "shop@example.com", email: "broker@example.com" },
      { email: "broker@example.com" },
    )).toBe("shop@example.com");
  });

  it("falls back to profile.email when shop_owner is missing", () => {
    expect(resolveShopOwnerKey({ email: "shop@example.com" }, { email: "user@example.com" }))
      .toBe("shop@example.com");
  });

  it("falls back to user.email when profile email is also missing", () => {
    expect(resolveShopOwnerKey({}, { email: "user@example.com" }))
      .toBe("user@example.com");
  });

  it("returns null when nothing is resolvable (caller short-circuits)", () => {
    expect(resolveShopOwnerKey({}, {})).toBe(null);
    expect(resolveShopOwnerKey(null, null)).toBe(null);
  });
});
