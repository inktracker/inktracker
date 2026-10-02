import { describe, it, expect } from "vitest";
import { computeQuoteTotals } from "../quoteTotals";

// The quote-totals money core. Pure via injected deps, so we can pin the
// invariants that protect real money: discount clamping (both directions),
// the taxable-vs-non-taxable fee split, the deposit snapshot rule, the
// client-PPP override gate, and null-safety.

const STANDARD_MARKUP = 2;

// Minimal deps: each line prices at li._ppp × li.qty, no rush, no linking.
const makeDeps = (overrides = {}) => ({
  STANDARD_MARKUP,
  detectPricingConfigBleed: () => {},
  buildLinkedQtyMap: () => ({}),
  getQty: (li: any) => Number(li?.qty) || 0,
  getLineExtras: () => ({}),
  calcLinkedLinePrice: (li: any) => ({
    ppp: Number(li?._ppp) || 0,
    qty: Number(li?.qty) || 0,
    rushFee: 0,
  }),
  sumAdditionalCharges: (charges: any) => {
    const list = Array.isArray(charges) ? charges : [];
    const taxable = list.filter((c) => c?.taxable).reduce((s, c) => s + (Number(c.amount) || 0), 0);
    const nonTaxable = list.filter((c) => !c?.taxable).reduce((s, c) => s + (Number(c.amount) || 0), 0);
    return { taxable, nonTaxable, total: taxable + nonTaxable };
  },
  ...overrides,
}) as any;

const line = (ppp: number, qty: number) => ({ _ppp: ppp, qty });

describe("computeQuoteTotals — subtotal & tax", () => {
  it("sums ppp × qty across lines", () => {
    const r = computeQuoteTotals({ line_items: [line(10, 5), line(8, 10)] }, STANDARD_MARKUP, null, makeDeps());
    expect(r.subtotal).toBe(130); // 50 + 80
    expect(r.sub).toBe(130); // no rush
    expect(r.total).toBe(130); // no tax
  });
  it("applies tax to the discounted base", () => {
    const r = computeQuoteTotals({ line_items: [line(100, 1)], tax_rate: 10 }, STANDARD_MARKUP, null, makeDeps());
    expect(r.tax).toBeCloseTo(10, 5);
    expect(r.total).toBeCloseTo(110, 5);
  });
});

describe("computeQuoteTotals — discount clamping (money safety)", () => {
  it("percent discount", () => {
    const r = computeQuoteTotals({ line_items: [line(100, 1)], discount: 25, discount_type: "percent" }, STANDARD_MARKUP, null, makeDeps());
    expect(r.afterDisc).toBeCloseTo(75, 5);
  });
  it("flat discount", () => {
    const r = computeQuoteTotals({ line_items: [line(100, 1)], discount: 30, discount_type: "flat" }, STANDARD_MARKUP, null, makeDeps());
    expect(r.afterDisc).toBeCloseTo(70, 5);
  });
  it("THE 150% SAFETY: a percent discount is clamped to 100 → never negative money", () => {
    const r = computeQuoteTotals({ line_items: [line(100, 1)], discount: 150, discount_type: "percent" }, STANDARD_MARKUP, null, makeDeps());
    expect(r.afterDisc).toBe(0); // not -50
    expect(r.total).toBe(0);
  });
  it("a flat discount larger than the subtotal clamps to $0, never negative", () => {
    const r = computeQuoteTotals({ line_items: [line(100, 1)], discount: 999, discount_type: "flat" }, STANDARD_MARKUP, null, makeDeps());
    expect(r.afterDisc).toBe(0);
    expect(r.total).toBe(0);
  });
  it("a legacy flat $150-off with NULL type is treated as flat (not 150%)", () => {
    const r = computeQuoteTotals({ line_items: [line(500, 1)], discount: 150, discount_type: null }, STANDARD_MARKUP, null, makeDeps());
    expect(r.afterDisc).toBeCloseTo(350, 5); // 500 - 150 flat, NOT 500×(1-1.0)
  });
});

describe("computeQuoteTotals — additional charges split", () => {
  it("taxable fees join the taxed base; non-taxable add AFTER tax", () => {
    const r = computeQuoteTotals(
      { line_items: [line(100, 1)], tax_rate: 10, additional_charges: [{ amount: 50, taxable: true }, { amount: 20, taxable: false }] },
      STANDARD_MARKUP, null, makeDeps(),
    );
    // taxBase = 100 + 50 = 150; tax = 15; total = 150 + 15 + 20 = 185
    expect(r.tax).toBeCloseTo(15, 5);
    expect(r.total).toBeCloseTo(185, 5);
    expect(r.additionalTaxable).toBe(50);
    expect(r.additionalNonTaxable).toBe(20);
  });
});

describe("computeQuoteTotals — deposit", () => {
  it("snapshot deposit_amount wins over pct", () => {
    const r = computeQuoteTotals({ line_items: [line(100, 1)], deposit_amount: 40, deposit_pct: 50 }, STANDARD_MARKUP, null, makeDeps());
    expect(r.deposit).toBe(40);
  });
  it("falls back to pct of total when no snapshot", () => {
    const r = computeQuoteTotals({ line_items: [line(100, 1)], deposit_pct: 25 }, STANDARD_MARKUP, null, makeDeps());
    expect(r.deposit).toBe(25);
  });
});

describe("computeQuoteTotals — client-PPP override gate", () => {
  it("honored on STANDARD markup (shop/client price)", () => {
    const r = computeQuoteTotals({ line_items: [{ qty: 10, _ppp: 5, clientPpp: 9 }] }, STANDARD_MARKUP, null, makeDeps());
    expect(r.subtotal).toBe(90); // 9 × 10 override, not 5 × 10
  });
  it("IGNORED on a non-standard (broker) markup — the contract price stands", () => {
    const BROKER = 1.5;
    const r = computeQuoteTotals({ line_items: [{ qty: 10, _ppp: 5, clientPpp: 9 }] }, BROKER, null, makeDeps());
    expect(r.subtotal).toBe(50); // 5 × 10 from calcLinkedLinePrice, override skipped
  });
});

describe("computeQuoteTotals — null safety", () => {
  it("a null/empty quote returns zeros, never throws (analytics rollups)", () => {
    expect(() => computeQuoteTotals(null, STANDARD_MARKUP, null, makeDeps())).not.toThrow();
    const r = computeQuoteTotals(null, STANDARD_MARKUP, null, makeDeps());
    expect(r.total).toBe(0);
    expect(r.subtotal).toBe(0);
    expect(r.deposit).toBe(0);
  });
});
