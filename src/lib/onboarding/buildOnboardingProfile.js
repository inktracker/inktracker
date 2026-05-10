// Pure builders for the new-shop onboarding flow. All normalization /
// defaulting / trial-expiry math lives here so it's testable without
// dragging in React, Supabase, or the wizard's UI state.
//
// If you change behavior, update __tests__/buildOnboardingProfile.test.js
// — those tests are the canonical contract.

const TRIAL_DAYS = 14;
const TRIAL_MS   = TRIAL_DAYS * 86_400_000;

function trimStr(v) {
  return typeof v === "string" ? v.trim() : "";
}

function parseTaxRate(v) {
  // Accepts "8.25", " 8.25 ", "8.25%", numeric, etc. Returns 0 for anything
  // unparseable — matches the historical inline behavior of `parseFloat(v) || 0`.
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const cleaned = trimStr(v).replace(/%\s*$/, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Build the `profileData` object that gets sent to base44.auth.updateMe()
 * when onboarding finishes.
 *
 * Defaults:
 *   - shop_name: falls back to user.email when blank
 *   - state: uppercased
 *   - default_tax_rate: parseFloat, falls back to 0
 *   - subscription_tier: keeps user's existing value, else 'trial'
 *   - subscription_status: keeps user's existing value, else 'trialing'
 *   - trial_ends_at: keeps user's existing value, else now + 14 days
 *
 * `now` is injected so tests can pin the trial-expiry math.
 */
export function buildOnboardingProfile(input, { now = Date.now() } = {}) {
  const {
    user = {},
    shopName = "",
    logoUrl = "",
    phone = "",
    address = "",
    city = "",
    stateVal = "",
    zip = "",
    taxRate = "",
  } = input || {};

  return {
    shop_name:           trimStr(shopName) || user.email || "",
    logo_url:            logoUrl || "",
    phone:               trimStr(phone),
    address:             trimStr(address),
    city:                trimStr(city),
    state:               trimStr(stateVal).toUpperCase(),
    zip:                 trimStr(zip),
    default_tax_rate:    parseTaxRate(taxRate),
    subscription_tier:   user.subscription_tier   || "trial",
    subscription_status: user.subscription_status || "trialing",
    trial_ends_at:       user.trial_ends_at       || new Date(now + TRIAL_MS).toISOString(),
  };
}

/**
 * Build the upsert payload for the `Shop` entity. Mirrors the wizard's
 * inline shape so tests catch shape regressions (extra/missing fields
 * would silently break per-shop pricing config / quote ownership lookups).
 */
export function buildShopUpsertPayload(input) {
  const { user = {}, shopName = "", logoUrl = "" } = input || {};
  return {
    owner_email: user.email || "",
    shop_name:   trimStr(shopName) || user.email || "",
    logo_url:    logoUrl || "",
  };
}

// Exported for tests and for any future caller that needs to know the trial length.
export const ONBOARDING_TRIAL_DAYS = TRIAL_DAYS;
