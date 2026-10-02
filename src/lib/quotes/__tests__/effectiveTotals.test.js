import { describe, it, expect } from "vitest";
import { savedAfterDiscount, savedRushTotal, effectiveQuoteTotals } from "../effectiveTotals";

// The customer-facing totals contract: a SAVED quote's own numbers are the
// commitment (email/PDF/payment all reference them) and must win over any live
// recompute; only a draft/blank (total 0 or missing) falls back to live.

describe("savedAfterDiscount — discounted subtotal from SAVED fields only", () => {
  it("total − tax − setup − additional_charges", () => {
    expect(savedAfterDiscount({ total: 100, tax: 8, setup_total: 12 })).toBe(80);
  });
  it("subtracts additional charges too", () => {
    const q = { total: 115, tax: 0, setup_total: 0, additional_charges: [{ amount: 15 }] };
    expect(savedAfterDiscount(q)).toBe(100);
  });
  it("missing fields default to 0", () => {
    expect(savedAfterDiscount({ total: 50 })).toBe(50);
    expect(savedAfterDiscount({})).toBe(0);
    expect(savedAfterDiscount(null)).toBe(0);
  });
  it("tolerates Postgres numeric strings", () => {
    expect(savedAfterDiscount({ total: "100", tax: "8", setup_total: "12" })).toBe(80);
  });
});

describe("savedRushTotal — sum of immutable per-line _rushFee stamps", () => {
  it("sums _rushFee across lines", () => {
    expect(savedRushTotal({ line_items: [{ _rushFee: 10 }, { _rushFee: 5.5 }, {}] })).toBe(15.5);
  });
  it("0 when no rush / no lines / junk", () => {
    expect(savedRushTotal({ line_items: [{}, {}] })).toBe(0);
    expect(savedRushTotal({ line_items: [] })).toBe(0);
    expect(savedRushTotal({})).toBe(0);
    expect(savedRushTotal(null)).toBe(0);
    expect(savedRushTotal({ line_items: "nope" })).toBe(0);
  });
  it("tolerates string stamps", () => {
    expect(savedRushTotal({ line_items: [{ _rushFee: "10" }, { _rushFee: "2.5" }] })).toBe(12.5);
  });
});

describe("effectiveQuoteTotals — saved wins, live is the fallback", () => {
  const savedQuote = {
    total: 189.57, tax: 14.47, subtotal: 175.1, setup_total: 0,
    line_items: [{ _rushFee: 0 }],
  };

  it("uses SAVED totals (source 'saved') when total > 0", () => {
    const r = effectiveQuoteTotals(savedQuote);
    expect(r.source).toBe("saved");
    expect(r.total).toBe(189.57);
    expect(r.tax).toBe(14.47);
    expect(r.subtotal).toBe(175.1);
    expect(r.sub).toBe(175.1);
    // afterDisc derived from saved fields, not live
    expect(r.afterDisc).toBeCloseTo(189.57 - 14.47, 5);
  });

  it("saved-path rush comes from the _rushFee stamps, not a live recompute", () => {
    const r = effectiveQuoteTotals({ ...savedQuote, line_items: [{ _rushFee: 20 }, { _rushFee: 5 }] });
    expect(r.source).toBe("saved");
    expect(r.rushTotal).toBe(25);
  });

  it("falls back to LIVE (source 'live') for a blank/draft quote (total 0 or missing)", () => {
    expect(effectiveQuoteTotals({ total: 0, line_items: [] }).source).toBe("live");
    expect(effectiveQuoteTotals({ line_items: [] }).source).toBe("live");
    expect(effectiveQuoteTotals({}).source).toBe("live");
  });

  it("a non-finite saved total (NaN) does NOT count as saved → live", () => {
    expect(effectiveQuoteTotals({ total: NaN, line_items: [] }).source).toBe("live");
  });

  it("when saved total is present but tax is null, tax falls back to live", () => {
    const r = effectiveQuoteTotals({ total: 100, subtotal: 100, line_items: [] });
    expect(r.source).toBe("saved");
    expect(r.total).toBe(100);
    expect(Number.isFinite(r.tax)).toBe(true);
  });
});
