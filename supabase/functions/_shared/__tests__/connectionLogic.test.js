import { describe, it, expect } from "vitest";
import {
  SECRET_KEYS,
  mergeProfileSecrets,
  decideTokenRefresh,
  extractConnectionStatus,
  buildOAuthTokenFields,
  buildRefreshedTokenFields,
} from "../connectionLogic.js";

describe("mergeProfileSecrets", () => {
  it("returns null when profile is null", () => {
    expect(mergeProfileSecrets(null, { qb_access_token: "x" })).toBeNull();
  });

  it("returns the profile unchanged when no secrets row exists", () => {
    const p = { id: "p1", qb_access_token: "OLD", email: "a@b" };
    expect(mergeProfileSecrets(p, null)).toEqual(p);
  });

  it("prefers values from the secrets row (new home wins)", () => {
    const profile = { id: "p1", qb_access_token: "OLD", qb_realm_id: "R-OLD" };
    const secrets = { qb_access_token: "NEW", qb_realm_id: "R-NEW" };
    const merged = mergeProfileSecrets(profile, secrets);
    expect(merged.qb_access_token).toBe("NEW");
    expect(merged.qb_realm_id).toBe("R-NEW");
  });

  it("keeps the profile value when the secrets row has null/undefined for that key", () => {
    const profile = { id: "p1", qb_access_token: "OLD", qb_realm_id: "R-OLD" };
    const secrets = { qb_access_token: null, qb_realm_id: undefined };
    const merged = mergeProfileSecrets(profile, secrets);
    expect(merged.qb_access_token).toBe("OLD");
    expect(merged.qb_realm_id).toBe("R-OLD");
  });

  it("preserves non-secret keys from the profile only", () => {
    const profile = { id: "p1", email: "a@b", role: "shop", qb_access_token: "T" };
    const secrets = { qb_access_token: "U" };
    const merged = mergeProfileSecrets(profile, secrets);
    expect(merged.email).toBe("a@b");
    expect(merged.role).toBe("shop");
  });

  it("handles partial secrets across the entire SECRET_KEYS set without dropping data", () => {
    const profile = Object.fromEntries(SECRET_KEYS.map((k) => [k, `${k}-old`]));
    profile.id = "p1";
    const secrets = { qb_access_token: "NEW" };
    const merged = mergeProfileSecrets(profile, secrets);
    expect(merged.qb_access_token).toBe("NEW");
    for (const k of SECRET_KEYS) {
      if (k === "qb_access_token") continue;
      expect(merged[k]).toBe(`${k}-old`);
    }
  });
});

describe("decideTokenRefresh", () => {
  const NOW = new Date("2026-05-09T18:00:00.000Z").getTime();
  const FIVE_MIN = 5 * 60 * 1000;

  it("returns true when expires is missing", () => {
    expect(decideTokenRefresh(null, NOW)).toBe(true);
    expect(decideTokenRefresh(undefined, NOW)).toBe(true);
    expect(decideTokenRefresh("", NOW)).toBe(true);
  });

  it("returns true when expires is in the past", () => {
    expect(decideTokenRefresh("2026-05-09T17:00:00.000Z", NOW)).toBe(true);
  });

  it("returns true when expires is within the lead window", () => {
    // 4 minutes in the future, lead = 5 min → should refresh
    const exp = new Date(NOW + 4 * 60 * 1000).toISOString();
    expect(decideTokenRefresh(exp, NOW, FIVE_MIN)).toBe(true);
  });

  it("returns false when expires is comfortably ahead of the lead window", () => {
    // 30 minutes in the future, lead = 5 min → no refresh
    const exp = new Date(NOW + 30 * 60 * 1000).toISOString();
    expect(decideTokenRefresh(exp, NOW, FIVE_MIN)).toBe(false);
  });

  it("returns true when expiresAt is unparseable garbage", () => {
    expect(decideTokenRefresh("not-a-date", NOW)).toBe(true);
  });
});

describe("extractConnectionStatus", () => {
  it("reports connected=true with realm + expires when access token is present", () => {
    const profile = {
      qb_access_token: "T",
      qb_realm_id: "R-1",
      qb_token_expires_at: "2026-05-09T20:00:00.000Z",
    };
    expect(extractConnectionStatus(profile)).toEqual({
      connected: true,
      realmId: "R-1",
      expiresAt: "2026-05-09T20:00:00.000Z",
    });
  });

  it("reports connected=false when there's no access token", () => {
    expect(extractConnectionStatus({ qb_realm_id: "R-1" })).toEqual({
      connected: false,
      realmId: "R-1",
      expiresAt: null,
    });
  });

  it("reports connected=false when the profile is null/undefined", () => {
    expect(extractConnectionStatus(null)).toEqual({
      connected: false,
      realmId: null,
      expiresAt: null,
    });
    expect(extractConnectionStatus(undefined).connected).toBe(false);
  });

  it("treats empty string access_token as not connected", () => {
    expect(extractConnectionStatus({ qb_access_token: "" }).connected).toBe(false);
  });
});

describe("buildOAuthTokenFields", () => {
  it("produces the dual-write payload for OAuth success", () => {
    const tokens = {
      access_token: "ACC",
      refresh_token: "REF",
      expires_in: 3600,
    };
    const fields = buildOAuthTokenFields(tokens, "REALM-42", "2026-05-09T20:00:00.000Z");

    expect(fields).toEqual({
      qb_access_token: "ACC",
      qb_refresh_token: "REF",
      qb_realm_id: "REALM-42",
      qb_token_expires_at: "2026-05-09T20:00:00.000Z",
      qb_oauth_state: null,
    });
  });

  it("always clears qb_oauth_state (one-time consumption)", () => {
    const fields = buildOAuthTokenFields({ access_token: "A", refresh_token: "R" }, "R-1", "2026-05-09T20:00:00.000Z");
    expect(fields.qb_oauth_state).toBeNull();
  });
});

describe("buildRefreshedTokenFields", () => {
  const NOW = new Date("2026-05-09T18:00:00.000Z").getTime();

  it("uses the rotated refresh_token when Intuit returns one", () => {
    const fields = buildRefreshedTokenFields(
      { access_token: "ACC", refresh_token: "ROT", expires_in: 3600 },
      "OLD-REF",
      NOW,
    );
    expect(fields.qb_refresh_token).toBe("ROT");
  });

  it("preserves the previous refresh_token when Intuit doesn't rotate", () => {
    const fields = buildRefreshedTokenFields(
      { access_token: "ACC", expires_in: 3600 },  // no refresh_token in response
      "OLD-REF",
      NOW,
    );
    expect(fields.qb_refresh_token).toBe("OLD-REF");
  });

  it("computes expires_at from now + expires_in", () => {
    const fields = buildRefreshedTokenFields(
      { access_token: "ACC", expires_in: 3600 },
      "OLD-REF",
      NOW,
    );
    expect(fields.qb_token_expires_at).toBe(new Date(NOW + 3600 * 1000).toISOString());
  });

  it("does NOT include realm_id or oauth_state (refresh shouldn't touch those)", () => {
    const fields = buildRefreshedTokenFields(
      { access_token: "A", refresh_token: "R", expires_in: 60 },
      "OLD",
      NOW,
    );
    expect(fields).not.toHaveProperty("qb_realm_id");
    expect(fields).not.toHaveProperty("qb_oauth_state");
  });
});
