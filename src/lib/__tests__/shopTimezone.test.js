import { describe, it, expect, beforeEach } from "vitest";
import {
  loadShopTimezone,
  getShopTimezone,
  todayInShopTz,
  nowInShopTz,
  SHOP_TIMEZONE_OPTIONS,
  _resetForTests,
} from "../shopTimezone";

beforeEach(() => {
  _resetForTests();
});

describe("loadShopTimezone / getShopTimezone", () => {
  it("falls back to browser tz when no shop tz set", () => {
    // Don't assert the exact value (varies by CI) — just that it's a non-empty string.
    const tz = getShopTimezone();
    expect(typeof tz).toBe("string");
    expect(tz.length).toBeGreaterThan(0);
  });

  it("returns the shop tz once loaded", () => {
    loadShopTimezone("America/New_York");
    expect(getShopTimezone()).toBe("America/New_York");
  });

  it("trims whitespace from a saved tz value", () => {
    loadShopTimezone("  America/Chicago  ");
    expect(getShopTimezone()).toBe("America/Chicago");
  });

  it("falls back when given null / empty / whitespace / non-string", () => {
    loadShopTimezone("America/Denver");
    loadShopTimezone(null);
    expect(getShopTimezone()).not.toBe("America/Denver");

    loadShopTimezone("America/Denver");
    loadShopTimezone("");
    expect(getShopTimezone()).not.toBe("America/Denver");

    loadShopTimezone("America/Denver");
    loadShopTimezone("   ");
    expect(getShopTimezone()).not.toBe("America/Denver");

    loadShopTimezone("America/Denver");
    loadShopTimezone(42);
    expect(getShopTimezone()).not.toBe("America/Denver");
  });
});

describe("todayInShopTz — date math", () => {
  it("returns a YYYY-MM-DD formatted string", () => {
    const s = todayInShopTz();
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("respects the configured timezone — UTC noon is the same day everywhere west of London", () => {
    // 2026-05-12 12:00 UTC = May 12 in New York (08:00 EDT), London (13:00 BST),
    // and Sydney (22:00 AEST). All same-day. Use this as a sanity baseline.
    const noonUtc = new Date("2026-05-12T12:00:00Z");

    loadShopTimezone("America/New_York");
    expect(todayInShopTz(noonUtc)).toBe("2026-05-12");

    loadShopTimezone("Europe/London");
    expect(todayInShopTz(noonUtc)).toBe("2026-05-12");
  });

  it("dates roll over at the shop's midnight, not the browser's", () => {
    // 2026-05-12 02:00 UTC = May 11 in New York (22:00 EDT prev day) but May 12 in London.
    const earlyMorningUtc = new Date("2026-05-12T02:00:00Z");

    loadShopTimezone("America/New_York");
    expect(todayInShopTz(earlyMorningUtc)).toBe("2026-05-11");

    loadShopTimezone("Europe/London");
    expect(todayInShopTz(earlyMorningUtc)).toBe("2026-05-12");
  });
});

describe("nowInShopTz", () => {
  it("returns { year, month } with month 0-indexed", () => {
    const r = nowInShopTz();
    expect(typeof r.year).toBe("number");
    expect(typeof r.month).toBe("number");
    expect(r.month).toBeGreaterThanOrEqual(0);
    expect(r.month).toBeLessThanOrEqual(11);
  });

  it("month index reflects the shop's tz, not the browser's", () => {
    // 2026-06-01 02:00 UTC = May 31 in New York. Different month!
    const monthBoundary = new Date("2026-06-01T02:00:00Z");

    loadShopTimezone("America/New_York");
    expect(nowInShopTz(monthBoundary)).toEqual({ year: 2026, month: 4 }); // May (0-indexed)

    loadShopTimezone("Europe/London");
    expect(nowInShopTz(monthBoundary)).toEqual({ year: 2026, month: 5 }); // June
  });
});

describe("SHOP_TIMEZONE_OPTIONS", () => {
  it("starts with the 'browser default' empty-value option", () => {
    expect(SHOP_TIMEZONE_OPTIONS[0]).toEqual({ value: "", label: expect.any(String) });
  });

  it("includes the most common US timezones", () => {
    const values = SHOP_TIMEZONE_OPTIONS.map((o) => o.value);
    expect(values).toContain("America/New_York");
    expect(values).toContain("America/Chicago");
    expect(values).toContain("America/Denver");
    expect(values).toContain("America/Los_Angeles");
  });

  it("includes Arizona (no-DST Mountain) as a distinct option", () => {
    const values = SHOP_TIMEZONE_OPTIONS.map((o) => o.value);
    expect(values).toContain("America/Phoenix");
  });
});
