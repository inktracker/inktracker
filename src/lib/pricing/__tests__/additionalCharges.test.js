import { describe, it, expect } from "vitest";
import { normalizeAdditionalCharges, sumAdditionalCharges } from "../additionalCharges";
import { calcQuoteTotals } from "@/components/shared/pricing";

describe("normalizeAdditionalCharges", () => {
  it("returns [] for non-arrays", () => {
    expect(normalizeAdditionalCharges(null)).toEqual([]);
    expect(normalizeAdditionalCharges(undefined)).toEqual([]);
    expect(normalizeAdditionalCharges({})).toEqual([]);
  });

  it("coerces amount to number and taxable to boolean", () => {
    const out = normalizeAdditionalCharges([{ id: "a", label: "Shipping", amount: "25", taxable: 1 }]);
    expect(out).toEqual([{ id: "a", label: "Shipping", amount: 25, taxable: true }]);
  });

  it("drops fully-empty rows but keeps a labeled zero row", () => {
    const out = normalizeAdditionalCharges([
      { id: "x", label: "", amount: "" },        // dropped
      { id: "y", label: "Pending", amount: 0 },  // kept (has label)
      { id: "z", label: "", amount: 5 },         // kept (has amount)
    ]);
    expect(out.map((c) => c.id)).toEqual(["y", "z"]);
  });
});

describe("sumAdditionalCharges", () => {
  it("splits taxable vs non-taxable", () => {
    const { taxable, nonTaxable, total } = sumAdditionalCharges([
      { label: "Taxed thing", amount: 10, taxable: true },
      { label: "Shipping", amount: 25, taxable: false },
      { label: "Rush", amount: 40, taxable: true },
    ]);
    expect(taxable).toBe(50);
    expect(nonTaxable).toBe(25);
    expect(total).toBe(75);
  });
});

describe("calcQuoteTotals with additional_charges", () => {
  const baseQuote = {
    line_items: [
      { sizes: { M: 10 }, clientPpp: 10 }, // $10/pc × 10 = $100 subtotal
    ],
    tax_rate: 10,
  };

  it("is a no-op when there are no additional charges (legacy snapshot unchanged)", () => {
    const t = calcQuoteTotals(baseQuote);
    expect(t.sub).toBe(100);
    expect(t.tax).toBeCloseTo(10, 5);
    expect(t.total).toBeCloseTo(110, 5);
    expect(t.additionalTotal).toBe(0);
  });

  it("adds taxable charges to the taxed base", () => {
    const t = calcQuoteTotals({ ...baseQuote, additional_charges: [{ label: "Rush", amount: 50, taxable: true }] });
    // taxBase = 100 + 50 = 150; tax = 15; total = 165
    expect(t.tax).toBeCloseTo(15, 5);
    expect(t.total).toBeCloseTo(165, 5);
    expect(t.additionalTaxable).toBe(50);
  });

  it("adds non-taxable charges after tax (no tax applied)", () => {
    const t = calcQuoteTotals({ ...baseQuote, additional_charges: [{ label: "Shipping", amount: 25, taxable: false }] });
    // taxBase = 100; tax = 10; total = 100 + 10 + 25 = 135
    expect(t.tax).toBeCloseTo(10, 5);
    expect(t.total).toBeCloseTo(135, 5);
    expect(t.additionalNonTaxable).toBe(25);
  });

  it("handles mixed taxable + non-taxable", () => {
    const t = calcQuoteTotals({
      ...baseQuote,
      additional_charges: [
        { label: "Rush", amount: 50, taxable: true },
        { label: "Shipping", amount: 25, taxable: false },
      ],
    });
    // taxBase = 150; tax = 15; total = 150 + 15 + 25 = 190
    expect(t.tax).toBeCloseTo(15, 5);
    expect(t.total).toBeCloseTo(190, 5);
  });
});

// ── edge cases ───────────────────────────────────────────────────────────────
describe("additionalCharges — edge cases", () => {
  it("coerces string amounts and drops non-numeric to 0", () => {
    const { taxable, nonTaxable } = sumAdditionalCharges([
      { label: "A", amount: "25.50", taxable: true },
      { label: "B", amount: "not-a-number", taxable: false },
    ]);
    expect(taxable).toBe(25.5);
    expect(nonTaxable).toBe(0); // "B" coerces to 0 but is kept (has label)
  });

  it("keeps a negative amount (e.g. a manual credit) and sums it", () => {
    const { nonTaxable, total } = sumAdditionalCharges([{ label: "Credit", amount: -10, taxable: false }]);
    expect(nonTaxable).toBe(-10);
    expect(total).toBe(-10);
  });

  it("drops whitespace-only label with zero amount", () => {
    expect(normalizeAdditionalCharges([{ label: "   ", amount: 0 }])).toEqual([]);
  });

  it("coerces truthy/falsy taxable to boolean", () => {
    const out = normalizeAdditionalCharges([
      { label: "x", amount: 1, taxable: 1 },
      { label: "y", amount: 1, taxable: 0 },
    ]);
    expect(out[0].taxable).toBe(true);
    expect(out[1].taxable).toBe(false);
  });

  it("empty / all-empty arrays sum to zero", () => {
    expect(sumAdditionalCharges([])).toMatchObject({ taxable: 0, nonTaxable: 0, total: 0 });
    expect(sumAdditionalCharges([{ label: "", amount: "" }])).toMatchObject({ total: 0, list: [] });
  });
});
