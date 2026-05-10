import { describe, it, expect } from "vitest";
import {
  buildOnboardingProfile,
  buildShopUpsertPayload,
  ONBOARDING_TRIAL_DAYS,
} from "../buildOnboardingProfile";

const NOW = new Date("2026-05-10T12:00:00.000Z").getTime();
const NEW_USER = {
  id: "u-1",
  email: "owner@example.com",
};

describe("buildOnboardingProfile — normalization", () => {
  it("trims string fields", () => {
    const p = buildOnboardingProfile(
      {
        user: NEW_USER,
        shopName: "  Cool Prints  ",
        phone: "  555-1212  ",
        address: "  1 Main St  ",
        city: "  Austin  ",
        stateVal: "  tx  ",
        zip: "  78701  ",
      },
      { now: NOW },
    );
    expect(p.shop_name).toBe("Cool Prints");
    expect(p.phone).toBe("555-1212");
    expect(p.address).toBe("1 Main St");
    expect(p.city).toBe("Austin");
    expect(p.zip).toBe("78701");
  });

  it("uppercases state code", () => {
    const p = buildOnboardingProfile(
      { user: NEW_USER, stateVal: " ca " },
      { now: NOW },
    );
    expect(p.state).toBe("CA");
  });

  it("parseFloats the tax rate", () => {
    const p = buildOnboardingProfile(
      { user: NEW_USER, taxRate: "8.25" },
      { now: NOW },
    );
    expect(p.default_tax_rate).toBe(8.25);
  });

  it("strips a trailing % from the tax rate", () => {
    const p = buildOnboardingProfile(
      { user: NEW_USER, taxRate: "8.25%" },
      { now: NOW },
    );
    expect(p.default_tax_rate).toBe(8.25);
  });

  it("accepts numeric tax_rate inputs as-is", () => {
    const p = buildOnboardingProfile(
      { user: NEW_USER, taxRate: 6.25 },
      { now: NOW },
    );
    expect(p.default_tax_rate).toBe(6.25);
  });

  it("falls back to 0 for unparseable tax rate", () => {
    expect(
      buildOnboardingProfile({ user: NEW_USER, taxRate: "" }, { now: NOW }).default_tax_rate
    ).toBe(0);
    expect(
      buildOnboardingProfile({ user: NEW_USER, taxRate: "abc" }, { now: NOW }).default_tax_rate
    ).toBe(0);
    expect(
      buildOnboardingProfile({ user: NEW_USER, taxRate: null }, { now: NOW }).default_tax_rate
    ).toBe(0);
  });
});

describe("buildOnboardingProfile — defaults", () => {
  it("falls back to user.email when shop_name is blank", () => {
    const p = buildOnboardingProfile(
      { user: NEW_USER, shopName: "" },
      { now: NOW },
    );
    expect(p.shop_name).toBe("owner@example.com");
  });

  it("uses 'trial' / 'trialing' when the user has no subscription set", () => {
    const p = buildOnboardingProfile({ user: NEW_USER }, { now: NOW });
    expect(p.subscription_tier).toBe("trial");
    expect(p.subscription_status).toBe("trialing");
  });

  it("preserves existing subscription tier/status (don't downgrade re-onboarders)", () => {
    const existing = {
      ...NEW_USER,
      subscription_tier: "shop",
      subscription_status: "active",
    };
    const p = buildOnboardingProfile({ user: existing }, { now: NOW });
    expect(p.subscription_tier).toBe("shop");
    expect(p.subscription_status).toBe("active");
  });

  it("sets trial_ends_at to exactly NOW + 14 days when missing", () => {
    const p = buildOnboardingProfile({ user: NEW_USER }, { now: NOW });
    const expected = new Date(NOW + ONBOARDING_TRIAL_DAYS * 86_400_000).toISOString();
    expect(p.trial_ends_at).toBe(expected);
  });

  it("preserves an existing trial_ends_at instead of resetting it", () => {
    const existing = {
      ...NEW_USER,
      trial_ends_at: "2026-06-01T00:00:00.000Z",
    };
    const p = buildOnboardingProfile({ user: existing }, { now: NOW });
    expect(p.trial_ends_at).toBe("2026-06-01T00:00:00.000Z");
  });

  it("emits empty strings (not undefined) for blank optional fields", () => {
    const p = buildOnboardingProfile({ user: NEW_USER }, { now: NOW });
    expect(p.logo_url).toBe("");
    expect(p.phone).toBe("");
    expect(p.address).toBe("");
    expect(p.city).toBe("");
    expect(p.zip).toBe("");
    expect(p.state).toBe("");
  });
});

describe("buildOnboardingProfile — full happy path", () => {
  it("produces the expected payload for a complete signup", () => {
    const p = buildOnboardingProfile(
      {
        user: NEW_USER,
        shopName: "Biota Mfg",
        logoUrl: "https://cdn.example.com/logo.png",
        phone: "555-0100",
        address: "100 Print Way",
        city: "Austin",
        stateVal: "TX",
        zip: "78701",
        taxRate: "8.25",
      },
      { now: NOW },
    );
    expect(p).toEqual({
      shop_name: "Biota Mfg",
      logo_url: "https://cdn.example.com/logo.png",
      phone: "555-0100",
      address: "100 Print Way",
      city: "Austin",
      state: "TX",
      zip: "78701",
      default_tax_rate: 8.25,
      subscription_tier: "trial",
      subscription_status: "trialing",
      trial_ends_at: new Date(NOW + 14 * 86_400_000).toISOString(),
    });
  });
});

describe("buildOnboardingProfile — robustness", () => {
  it("treats whitespace-only shop_name the same as blank (falls back to email)", () => {
    const p = buildOnboardingProfile(
      { user: NEW_USER, shopName: "   \t\n   " },
      { now: NOW },
    );
    expect(p.shop_name).toBe("owner@example.com");
  });

  it("preserves existing trial_ends_at even when it's in the past (don't reset paid users)", () => {
    const existing = {
      ...NEW_USER,
      trial_ends_at: "2026-01-01T00:00:00.000Z", // already past
    };
    const p = buildOnboardingProfile({ user: existing }, { now: NOW });
    expect(p.trial_ends_at).toBe("2026-01-01T00:00:00.000Z");
  });

  it("survives a user object with no email (shop_name becomes empty string)", () => {
    const p = buildOnboardingProfile({ user: { id: "u-9" } }, { now: NOW });
    expect(p.shop_name).toBe("");
    expect(typeof p.shop_name).toBe("string");
  });

  it("survives a missing user (no crash, sane defaults)", () => {
    const p = buildOnboardingProfile({}, { now: NOW });
    expect(p.shop_name).toBe("");
    expect(p.subscription_tier).toBe("trial");
    expect(p.subscription_status).toBe("trialing");
  });

  it("survives a fully-undefined input (no crash)", () => {
    const p = buildOnboardingProfile(undefined, { now: NOW });
    expect(p.subscription_tier).toBe("trial");
    expect(p.trial_ends_at).toBe(new Date(NOW + 14 * 86_400_000).toISOString());
  });

  it("does not strip leading 0s from a US zip code", () => {
    const p = buildOnboardingProfile(
      { user: NEW_USER, zip: "  02134  " },
      { now: NOW },
    );
    expect(p.zip).toBe("02134");
  });

  it("does not auto-extract a 'name' from the user's email local-part", () => {
    // We deliberately don't fake a personal greeting from the email, since the
    // user hasn't told us their name yet. shop_name should be the full email
    // (used as a placeholder for them to overwrite), never a synthetic name.
    const p = buildOnboardingProfile({ user: NEW_USER }, { now: NOW });
    expect(p.shop_name).toBe("owner@example.com");
    expect(p.shop_name).not.toMatch(/^Owner$/);
  });
});

describe("buildShopUpsertPayload", () => {
  it("uses shop_name when present", () => {
    expect(
      buildShopUpsertPayload({
        user: NEW_USER,
        shopName: "Biota Mfg",
        logoUrl: "https://cdn.example.com/logo.png",
      })
    ).toEqual({
      owner_email: "owner@example.com",
      shop_name: "Biota Mfg",
      logo_url: "https://cdn.example.com/logo.png",
    });
  });

  it("falls back to user.email when shop_name is blank", () => {
    const p = buildShopUpsertPayload({ user: NEW_USER, shopName: "" });
    expect(p.shop_name).toBe("owner@example.com");
    expect(p.logo_url).toBe("");
  });

  it("emits empty strings (not undefined) for missing fields", () => {
    const p = buildShopUpsertPayload({ user: NEW_USER });
    expect(p.logo_url).toBe("");
    expect(typeof p.shop_name).toBe("string");
  });
});
