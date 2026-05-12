import { describe, it, expect } from "vitest";
import { getEffectiveTier, canAccess } from "../billing";

// Fixed reference time so trial-expiry tests are deterministic.
const NOW = new Date("2026-05-12T07:00:00.000Z");
const NOW_MS = NOW.getTime();
const ONE_HOUR = 60 * 60 * 1000;

describe("getEffectiveTier — admin bypass", () => {
  it("treats admin role as 'shop' regardless of subscription_tier", () => {
    expect(getEffectiveTier({ role: "admin", subscription_tier: "trial" })).toBe("shop");
    expect(getEffectiveTier({ role: "admin", subscription_tier: "expired" })).toBe("shop");
    expect(getEffectiveTier({ role: "admin", subscription_tier: undefined })).toBe("shop");
    expect(getEffectiveTier({ role: "admin", subscription_status: "canceled" })).toBe("shop");
  });

  it("ignores an expired trial when role is admin (founder bypass)", () => {
    expect(
      getEffectiveTier(
        {
          role: "admin",
          subscription_tier: "trial",
          trial_ends_at: new Date(NOW_MS - ONE_HOUR).toISOString(),
        },
        NOW,
      ),
    ).toBe("shop");
  });
});

describe("getEffectiveTier — trial expiry collapses to 'expired'", () => {
  it("returns 'trial' when trial_ends_at is in the future", () => {
    const user = {
      role: "shop",
      subscription_tier: "trial",
      trial_ends_at: new Date(NOW_MS + 24 * ONE_HOUR).toISOString(),
    };
    expect(getEffectiveTier(user, NOW)).toBe("trial");
  });

  it("returns 'expired' when trial_ends_at has passed — the bug Joe hit", () => {
    // Without this, canAccess kept returning every feature even though
    // the banner said the trial had expired. Effective tier must
    // collapse to 'expired' so the gating actually works.
    const user = {
      role: "shop",
      subscription_tier: "trial",
      trial_ends_at: new Date(NOW_MS - ONE_HOUR).toISOString(),
    };
    expect(getEffectiveTier(user, NOW)).toBe("expired");
  });

  it("returns 'trial' when trial_ends_at is null/undefined (trial without an end date)", () => {
    expect(getEffectiveTier({ role: "shop", subscription_tier: "trial" }, NOW)).toBe("trial");
    expect(getEffectiveTier({ role: "shop", subscription_tier: "trial", trial_ends_at: null }, NOW)).toBe("trial");
  });

  it("handles an invalid trial_ends_at by NOT marking expired (conservative)", () => {
    // Garbage date string — Number.isFinite check prevents NaN
    // from accidentally marking the user expired.
    expect(
      getEffectiveTier(
        { role: "shop", subscription_tier: "trial", trial_ends_at: "not-a-date" },
        NOW,
      ),
    ).toBe("trial");
  });
});

describe("getEffectiveTier — canceled subscription collapses to 'expired'", () => {
  it("returns 'expired' when subscription_status is 'canceled'", () => {
    expect(
      getEffectiveTier({ role: "shop", subscription_tier: "shop", subscription_status: "canceled" }),
    ).toBe("expired");
  });

  it("returns 'expired' when subscription_tier is literally 'expired'", () => {
    expect(getEffectiveTier({ role: "shop", subscription_tier: "expired" })).toBe("expired");
  });
});

describe("getEffectiveTier — paid 'shop' tier", () => {
  it("returns 'shop' for an active paid subscription", () => {
    expect(
      getEffectiveTier({ role: "shop", subscription_tier: "shop", subscription_status: "active" }),
    ).toBe("shop");
  });

  it("returns 'shop' even with a stale trial_ends_at if tier is already 'shop'", () => {
    // After trial converts to paid, trial_ends_at may still be set in
    // the DB — should not pull a paid user back to expired.
    expect(
      getEffectiveTier(
        {
          role: "shop",
          subscription_tier: "shop",
          subscription_status: "active",
          trial_ends_at: new Date(NOW_MS - ONE_HOUR).toISOString(),
        },
        NOW,
      ),
    ).toBe("shop");
  });
});

describe("getEffectiveTier — defensive edge cases", () => {
  it("returns 'expired' for a null user — refuses to grant access on missing identity", () => {
    expect(getEffectiveTier(null)).toBe("expired");
    expect(getEffectiveTier(undefined)).toBe("expired");
  });

  it("defaults to 'trial' when subscription_tier is missing and role isn't admin", () => {
    expect(getEffectiveTier({ role: "shop" })).toBe("trial");
  });

  it("accepts a number-typed nowOverride (ms since epoch) — interop with Date.now()", () => {
    const user = {
      role: "shop",
      subscription_tier: "trial",
      trial_ends_at: new Date(NOW_MS - ONE_HOUR).toISOString(),
    };
    expect(getEffectiveTier(user, NOW_MS)).toBe("expired");
  });
});

describe("canAccess + getEffectiveTier composition — the full gating contract", () => {
  it("admin keeps every feature even with an expired trial", () => {
    const user = {
      role: "admin",
      subscription_tier: "trial",
      trial_ends_at: new Date(NOW_MS - ONE_HOUR).toISOString(),
    };
    const tier = getEffectiveTier(user, NOW);
    for (const f of ["quotes", "orders", "qb_sync", "reports"]) {
      expect(canAccess(tier, f), `admin should keep ${f}`).toBe(true);
    }
  });

  it("non-admin with expired trial loses every feature", () => {
    const user = {
      role: "shop",
      subscription_tier: "trial",
      trial_ends_at: new Date(NOW_MS - ONE_HOUR).toISOString(),
    };
    const tier = getEffectiveTier(user, NOW);
    for (const f of ["quotes", "orders", "qb_sync", "reports"]) {
      expect(canAccess(tier, f), `expired user should lose ${f}`).toBe(false);
    }
  });

  it("non-admin with active trial keeps every feature", () => {
    const user = {
      role: "shop",
      subscription_tier: "trial",
      trial_ends_at: new Date(NOW_MS + 24 * ONE_HOUR).toISOString(),
    };
    const tier = getEffectiveTier(user, NOW);
    for (const f of ["quotes", "orders", "qb_sync", "reports"]) {
      expect(canAccess(tier, f), `active trial should keep ${f}`).toBe(true);
    }
  });
});
