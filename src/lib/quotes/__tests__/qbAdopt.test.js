import { describe, it, expect } from "vitest";
import { buildQuoteAdoptPatch, qbModifiedState } from "../qbAdopt.js";

describe("buildQuoteAdoptPatch — reconcile a quote toward its QB mirror", () => {
  it("returns null when the quote was never mirrored (qb_total null)", () => {
    expect(buildQuoteAdoptPatch({ total: 3491.14, qb_total: null })).toBeNull();
    expect(buildQuoteAdoptPatch({ total: 3491.14 })).toBeNull();
    expect(buildQuoteAdoptPatch(null)).toBeNull();
  });

  it("adopts QB total/tax and derives the rate from QB's own subtotal", () => {
    // Kato / Thunder House: QB $3576.10 vs quote $3491.14 (drift +$84.96).
    const quote = {
      total: 3491.14, tax: 0, tax_rate: 0,
      qb_total: 3576.10, qb_tax_amount: 85.10, qb_subtotal: 3491.00,
    };
    const patch = buildQuoteAdoptPatch(quote);
    expect(patch.total).toBe(3576.10);
    expect(patch.tax).toBe(85.10);
    // 85.10 / 3491.00 * 100 = 2.4377…%
    expect(patch.tax_rate).toBeCloseTo(2.4377, 3);
  });

  it("falls back to total − tax for the subtotal when qb_subtotal is absent", () => {
    const patch = buildQuoteAdoptPatch({ total: 100, qb_total: 108, qb_tax_amount: 8 });
    // base = 108 − 8 = 100 → 8 / 100 * 100 = 8%
    expect(patch).toEqual({ total: 108, tax: 8, tax_rate: 8 });
  });

  it("yields a zero rate for a tax-free adopt (no divide-by-zero)", () => {
    const patch = buildQuoteAdoptPatch({ total: 200, qb_total: 250, qb_tax_amount: 0, qb_subtotal: 250 });
    expect(patch).toEqual({ total: 250, tax: 0, tax_rate: 0 });
  });

  it("never emits line_items or any non-money field", () => {
    const patch = buildQuoteAdoptPatch({
      total: 100, qb_total: 108, qb_tax_amount: 8, qb_subtotal: 100,
      line_items: [{ id: "li1" }], notes: "keep me",
    });
    expect(Object.keys(patch).sort()).toEqual(["tax", "tax_rate", "total"]);
  });

  it("qbModifiedState flags a drifted quote and clears once adopted", () => {
    const quote = { total: 3491.14, qb_total: 3576.10, qb_tax_amount: 85.10, qb_subtotal: 3491.00 };
    expect(qbModifiedState(quote).modified).toBe(true);
    const adopted = { ...quote, ...buildQuoteAdoptPatch(quote) };
    expect(qbModifiedState(adopted).modified).toBe(false);
  });
});
