import { describe, it, expect } from "vitest";
import {
  getCardSurcharge,
  cardFeeOn,
  cardTotalWith,
  cardSurchargeNote,
  formatRate,
  DEFAULT_CARD_SURCHARGE_PCT,
  MAX_CARD_SURCHARGE_PCT,
} from "../cardSurcharge";

describe("getCardSurcharge", () => {
  it("is OFF unless the shop explicitly enabled it", () => {
    expect(getCardSurcharge(undefined)).toEqual({ enabled: false, ratePct: 0 });
    expect(getCardSurcharge({})).toEqual({ enabled: false, ratePct: 0 });
    expect(getCardSurcharge({ cardSurcharge: {} })).toEqual({ enabled: false, ratePct: 0 });
    // Truthy-but-not-true must not switch it on (a stray "false" string).
    expect(getCardSurcharge({ cardSurcharge: { enabled: "false", ratePct: 3 } }).enabled).toBe(false);
  });

  it("reads the shop's rate when enabled", () => {
    expect(getCardSurcharge({ cardSurcharge: { enabled: true, ratePct: 3 } }))
      .toEqual({ enabled: true, ratePct: 3 });
  });

  it("falls back to Intuit's rate when the number is missing or junk", () => {
    for (const ratePct of [undefined, null, "", "abc", 0, -2, NaN]) {
      expect(getCardSurcharge({ cardSurcharge: { enabled: true, ratePct } }).ratePct)
        .toBe(DEFAULT_CARD_SURCHARGE_PCT);
    }
  });

  it("clamps to the Visa/Mastercard ceiling — a typo can't publish a non-compliant rate", () => {
    expect(getCardSurcharge({ cardSurcharge: { enabled: true, ratePct: 29 } }).ratePct)
      .toBe(MAX_CARD_SURCHARGE_PCT);
    expect(MAX_CARD_SURCHARGE_PCT).toBe(4);
  });
});

describe("cardFeeOn / cardTotalWith", () => {
  it("computes to the cent", () => {
    expect(cardFeeOn(2392.75, 2.9)).toBe(69.39);
    expect(cardTotalWith(2392.75, 2.9)).toBe(2462.14);
    expect(cardFeeOn(100, 3)).toBe(3);
  });

  it("rounds half-up rather than drifting on float error", () => {
    // 1.005 * 100 in binary float is 100.49999…; naive Math.round gives 100.49.
    expect(cardFeeOn(34.5, 2.9)).toBe(1.0);
    expect(cardFeeOn(10.17, 2.9)).toBe(0.29);
  });

  it("is 0 for a non-payable total or a dead rate (never NaN on a customer page)", () => {
    for (const bad of [0, -5, null, undefined, "abc", NaN]) {
      expect(cardFeeOn(bad, 2.9)).toBe(0);
      expect(cardTotalWith(bad, 2.9)).toBe(0);
    }
    expect(cardFeeOn(100, 0)).toBe(0);
    expect(cardFeeOn(100, null)).toBe(0);
  });
});

describe("cardSurchargeNote", () => {
  it("states the rate, the fee and the card total", () => {
    const note = cardSurchargeNote({ total: 2392.75, ratePct: 2.9 });
    expect(note).toContain("2.9% processing fee");
    expect(note).toContain("$69.39");
    expect(note).toContain("$2462.14");
    expect(note).toContain("before you're charged");
  });

  it("never promises a specific fee-free method — Intuit surcharges ACH too", () => {
    const note = cardSurchargeNote({ total: 500, ratePct: 3 });
    expect(note).not.toMatch(/bank transfer|ACH|PayPal|Venmo/i);
  });

  it("renders nothing when off, unpayable, or rate-less", () => {
    expect(cardSurchargeNote({ total: 500, ratePct: 3, enabled: false })).toBe("");
    expect(cardSurchargeNote({ total: 0, ratePct: 3 })).toBe("");
    expect(cardSurchargeNote({ total: 500, ratePct: 0 })).toBe("");
  });
});

describe("formatRate", () => {
  it("drops a trailing .0 and survives junk", () => {
    expect(formatRate(2.9)).toBe("2.9");
    expect(formatRate(3)).toBe("3");
    expect(formatRate(3.0)).toBe("3");
    expect(formatRate("abc")).toBe("0");
  });
});
