import { describe, it, expect } from "vitest";
import { captureAttribution, getStoredAttribution, describeSignupSource } from "../attribution";

function memStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    _map: m,
  };
}

const NOW = () => "2026-08-31T18:00:00.000Z";

describe("captureAttribution", () => {
  it("captures utm params, external referrer, and landing path", () => {
    const storage = memStorage();
    captureAttribution({
      storage,
      href: "https://inktracker.app/pricing?utm_source=facebook&utm_campaign=aug-groups",
      referrer: "https://www.facebook.com/groups/screenprinting/",
      now: NOW,
    });
    const stored = getStoredAttribution({ storage });
    expect(stored).toEqual({
      landing: "/pricing",
      captured_at: "2026-08-31T18:00:00.000Z",
      utm_source: "facebook",
      utm_campaign: "aug-groups",
      referrer: "https://www.facebook.com/groups/screenprinting/",
    });
  });

  it("first touch wins — a later visit never overwrites", () => {
    const storage = memStorage();
    captureAttribution({ storage, href: "https://inktracker.app/?utm_source=reddit", referrer: "", now: NOW });
    captureAttribution({ storage, href: "https://inktracker.app/?utm_source=google", referrer: "", now: NOW });
    expect(getStoredAttribution({ storage }).utm_source).toBe("reddit");
  });

  it("ignores same-origin referrers (internal navigation is not a source)", () => {
    const storage = memStorage();
    captureAttribution({
      storage,
      href: "https://inktracker.app/tools/pricing-calculator",
      referrer: "https://inktracker.app/",
      now: NOW,
    });
    expect(getStoredAttribution({ storage }).referrer).toBeUndefined();
  });

  it("a bare direct visit still records landing + timestamp", () => {
    const storage = memStorage();
    captureAttribution({ storage, href: "https://inktracker.app/", referrer: "", now: NOW });
    expect(getStoredAttribution({ storage })).toEqual({ landing: "/", captured_at: NOW() });
  });

  it("never throws without storage (private mode)", () => {
    expect(() => captureAttribution({ storage: null, href: "https://x.app/", referrer: "" })).not.toThrow();
    expect(getStoredAttribution({ storage: null })).toBeNull();
  });

  it("returns null for corrupted storage", () => {
    const storage = memStorage({ it_first_touch: "{not json" });
    expect(getStoredAttribution({ storage })).toBeNull();
  });
});

describe("describeSignupSource", () => {
  it("self-reported beats browser data, both shown", () => {
    expect(
      describeSignupSource({ self_reported: "Facebook group", utm_source: "reddit", landing: "/" })
    ).toBe('"Facebook group" · utm: reddit');
  });

  it("utm beats referrer; referrer collapses to hostname", () => {
    expect(describeSignupSource({ referrer: "https://www.reddit.com/r/SCREENPRINTING/comments/abc" }))
      .toBe("via www.reddit.com");
  });

  it("empty-but-present capture reads as direct; absent reads as blank", () => {
    expect(describeSignupSource({ landing: "/", captured_at: "x" })).toBe("direct");
    expect(describeSignupSource(null)).toBe("");
    expect(describeSignupSource({})).toBe("");
  });
});
