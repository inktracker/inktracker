import { describe, it, expect } from "vitest";
import { roundedQuoteTotals } from "../quoteRounding";

// Footing helper: subtotal − discount + setup + additional + tax === total
function foots(rt, addlNonTax = 0, addlTaxable = 0) {
  const lhs = +(rt.sub - rt.discountAmount + rt.setup + addlTaxable + addlNonTax + rt.tax).toFixed(2);
  return lhs === rt.total;
}

describe("roundedQuoteTotals", () => {
  it("reported case: 15% of $466.70 stores the TRUE total $429.48 (not $429.49), discount $70.01", () => {
    const rt = roundedQuoteTotals({ sub: 466.70, discount: 15, discountType: "percent", taxRate: 8.265 });
    expect(rt.discountAmount).toBe(70.01); // round(70.005)
    expect(rt.afterDisc).toBe(396.69);
    expect(rt.tax).toBe(32.79);
    expect(rt.total).toBe(429.48); // was 429.49 under the old double-round
    expect(foots(rt)).toBe(true);
  });

  it("no discount, no tax → total = subtotal", () => {
    const rt = roundedQuoteTotals({ sub: 100, discount: 0, discountType: "percent", taxRate: 0 });
    expect(rt.total).toBe(100);
    expect(foots(rt)).toBe(true);
  });

  it("flat discount is applied and capped at the subtotal", () => {
    const rt = roundedQuoteTotals({ sub: 50, discount: 999, discountType: "flat", taxRate: 0 });
    expect(rt.discountAmount).toBe(50);
    expect(rt.afterDisc).toBe(0);
    expect(rt.total).toBe(0);
  });

  it("setup + taxable + non-taxable fees all foot", () => {
    // sub 100, 10% disc → afterDisc 90; setup 25; taxable fee 20; nontax 15
    // taxable base 135; tax 10% = 13.50; total = 135 + 13.50 + 15 = 163.50
    const rt = roundedQuoteTotals({
      sub: 100, discount: 10, discountType: "percent",
      setup: 25, addlTaxable: 20, addlNonTax: 15, taxRate: 10,
    });
    expect(rt.afterDisc).toBe(90);
    expect(rt.taxableBase).toBe(135);
    expect(rt.tax).toBe(13.5);
    expect(rt.total).toBe(163.5);
    expect(foots(rt, 15, 20)).toBe(true);
  });

  it("tax is computed on (afterDisc + setup + taxable fees), excluding non-taxable", () => {
    const rt = roundedQuoteTotals({ sub: 100, discount: 0, setup: 0, addlNonTax: 50, taxRate: 10 });
    expect(rt.tax).toBe(10); // 10% of 100, NOT of 150
    expect(rt.total).toBe(160);
  });
});
