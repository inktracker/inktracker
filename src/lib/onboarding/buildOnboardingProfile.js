// Pure builders for the new-shop onboarding flow. All normalization /
// defaulting / trial-expiry math lives here so it's testable without
// dragging in React, Supabase, or the wizard's UI state.
//
// If you change behavior, update __tests__/buildOnboardingProfile.test.js
// — those tests are the canonical contract.

import { buildInitialPricingConfig } from "./shopPricingDefaults";

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
    website = "",
    taxRate = "",
    heardAbout = "",
  } = input || {};

  // Optional "How did you hear about us?" — merged into signup_source so the
  // silent first-touch capture (written by handle_new_user at INSERT, read
  // back off `user`) is preserved, not clobbered. Omitted entirely when
  // skipped: an absent key means the profile update doesn't touch the column.
  const selfReported = trimStr(heardAbout).slice(0, 200);
  const signupSource = selfReported
    ? { ...(user.signup_source && typeof user.signup_source === "object" ? user.signup_source : {}), self_reported: selfReported }
    : null;

  // NOTE: subscription_tier / subscription_status / trial_ends_at are NOT set
  // here. They're governance columns owned by the server — `handle_new_user`
  // sets them at signup and `activate_trial` backfills them. Writing them from
  // the client (this payload goes through the authenticated `updateMe`) is both
  // redundant and a downgrade risk, and is now rejected by the
  // guard_profiles_privileged_columns trigger. Onboarding only writes brand /
  // contact fields.
  return {
    shop_name:           trimStr(shopName) || user.email || "",
    logo_url:            logoUrl || "",
    phone:               trimStr(phone),
    address:             trimStr(address),
    city:                trimStr(city),
    state:               trimStr(stateVal).toUpperCase(),
    zip:                 trimStr(zip),
    website:             trimStr(website) || null,
    default_tax_rate:    parseTaxRate(taxRate),
    ...(signupSource ? { signup_source: signupSource } : {}),
  };
}

/**
 * Build the upsert payload for the `Shop` entity. Mirrors the wizard's
 * inline shape so tests catch shape regressions (extra/missing fields
 * would silently break per-shop pricing config / quote ownership lookups).
 *
 * Writes a COMPLETE `pricing_config` — all tier tables, all rates,
 * all extras — so the new shop's quote modal has real numbers from
 * minute one. The previous behavior wrote a minimal
 * `{ embroidery: { enabled: true } }` payload that left _pc.embroidery
 * with no pricing tables; the dropdown silently dropped Embroidery as
 * an option even though the toggle was on. Same shape Account →
 * Pricing → Save writes, so onboarding and save can't drift.
 *
 * Source-of-truth defaults live in ./shopPricingDefaults — one place
 * to bump rates, one place to add future toggles.
 */
export function buildShopUpsertPayload(input) {
  const { user = {}, shopName = "", logoUrl = "", offersEmbroidery = false, offersScreenPrint = true, timezone = "" } = input || {};
  const base = {
    owner_email: user.email || "",
    shop_name:   trimStr(shopName) || user.email || "",
    logo_url:    logoUrl || "",
  };
  // Only set timezone when the user picked one. Empty string means
  // "use browser default at runtime" — keep the column null so the
  // shopTimezone helpers fall through to BROWSER_TZ instead of forcing
  // a specific zone.
  const tz = trimStr(timezone);
  if (tz) base.timezone = tz;
  // Always seed the full pricing config. The onboarding step is a
  // shop's introduction to the pricing engine; writing zeros for
  // every tier was the historical default behavior but bit operators
  // who flipped offersEmbroidery and then couldn't see embroidery
  // anywhere. Now: every new shop starts with sensible numbers, and
  // any toggles set during onboarding (currently just embroidery)
  // are honored on top.
  base.pricing_config = buildInitialPricingConfig({ offersEmbroidery, offersScreenPrint });
  return base;
}

// Exported for tests and for any future caller that needs to know the trial length.
export const ONBOARDING_TRIAL_DAYS = TRIAL_DAYS;
