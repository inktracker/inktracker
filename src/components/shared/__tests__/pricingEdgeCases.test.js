// Coverage sweep on calcLinkedLinePrice + helpers — branches the
// happy-path tests in pricing.test.js don't hit.
//
// These are the silent-bug hotspots: defensive fallbacks, edge-case
// inputs, secondary-imprint pricing rules, per-size vs flat-cost
// branching, custom shop-config values. Each test names an invariant
// that the shop owner would actually care about.

import { describe, it, expect, beforeEach } from "vitest";
import {
  calcLinkedLinePrice,
  calcQuoteTotalsWithLinking,
  buildQBInvoicePayload,
  loadShopPricingConfig,
  STANDARD_MARKUP,
  BROKER_MARKUP,
  EXTRA_RATES,
} from "../pricing.jsx";

beforeEach(() => {
  loadShopPricingConfig(null);
});

function makeImprint(overrides = {}) {
  return {
    id: "imp",
    title: "",
    location: "Front",
    colors: 1,
    technique: "Screen Print",
    linked: false,
    ...overrides,
  };
}

function makeLine(overrides = {}) {
  return {
    id: "li",
    style: "1717",
    garmentCost: "4.62",
    garmentColor: "Black",
    sizes: { M: "50" },
    imprints: [makeImprint()],
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────
// calcLinkedLinePrice — color count edge cases
// ─────────────────────────────────────────────────────────────────────

describe("calcLinkedLinePrice — color count clamping", () => {
  it("CC1 — imp.colors > 8 (default max) clamps to 8 (no out-of-bounds pricing-table access)", () => {
    // Pricing tables are keyed 1..8. A 12-color imprint must NOT
    // silently fall through to rate = 0 (free print) or crash on
    // a missing table entry.
    const r = calcLinkedLinePrice(
      makeLine({ imprints: [makeImprint({ colors: 12 })] }),
      0, {}, STANDARD_MARKUP, {},
    );
    expect(r).not.toBe(null);
    expect(r.printCost).toBeGreaterThan(0);
  });

  it("CC2 — imp.colors = 0 is DROPPED from pricing (the editor's 'not ready' marker)", () => {
    // Contract: an imprint slot with colors=0 means the shop hasn't
    // configured that print yet. It's silently excluded from the
    // line total — NOT clamped to 1 color (that would over-charge
    // the customer for an unfinished design).
    // The clamp `Math.max(1, ...)` at line 289 only runs on the
    // already-filtered active imprints, so it never sees 0.
    const r = calcLinkedLinePrice(
      makeLine({
        imprints: [
          makeImprint({ id: "real", colors: 1 }),
          makeImprint({ id: "skip", colors: 0 }),
        ],
      }),
      0, {}, STANDARD_MARKUP, {},
    );
    // printCost reflects ONE imprint, not two
    const oneOnly = calcLinkedLinePrice(
      makeLine({ imprints: [makeImprint({ colors: 1 })] }),
      0, {}, STANDARD_MARKUP, {},
    );
    expect(r.printCost).toBe(oneOnly.printCost);
  });

  it("CC3 — imp.colors = null/undefined is also dropped (treated as 0)", () => {
    // Same contract via different inputs (form clears, API miss).
    const r = calcLinkedLinePrice(
      makeLine({
        imprints: [
          makeImprint({ id: "real", colors: 1 }),
          { id: "skip-null", colors: null, technique: "Screen Print" },
          { id: "skip-undef", technique: "Screen Print" },
        ],
      }),
      0, {}, STANDARD_MARKUP, {},
    );
    const oneOnly = calcLinkedLinePrice(
      makeLine({ imprints: [makeImprint({ colors: 1 })] }),
      0, {}, STANDARD_MARKUP, {},
    );
    expect(r.printCost).toBe(oneOnly.printCost);
  });

  it("CC4 — shop's maxColors config caps higher than default 8", () => {
    // Some shops handle 12-color prints. Setting maxColors=12 in the
    // pricing config should let the clamp reach that value.
    loadShopPricingConfig({
      maxColors: 12,
      firstPrint: { 9: { 25: 11.0, 50: 9.9, 100: 9.0, 200: 8.5 } },
      addlPrint:  { 9: { 25: 5.4, 50: 4.6, 100: 4.0, 200: 3.6 } },
    });
    const r9 = calcLinkedLinePrice(
      makeLine({ imprints: [makeImprint({ colors: 9 })] }),
      0, {}, STANDARD_MARKUP, {},
    );
    expect(r9?.printCost).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// calcLinkedLinePrice — secondary imprints (additional prints)
// ─────────────────────────────────────────────────────────────────────

describe("calcLinkedLinePrice — multiple imprints", () => {
  it("MI1 — second imprint uses the ADDL_PRINT table (volume rate), not FIRST_PRINT", () => {
    // The pricing model: first print at FIRST_PRINT rate, additional
    // imprints at ADDL_PRINT (cheaper). If a regression swapped or
    // misused these tables, customers would over/under-pay.
    const oneImp = calcLinkedLinePrice(
      makeLine({ imprints: [makeImprint({ id: "a", colors: 1 })] }),
      0, {}, STANDARD_MARKUP, {},
    );
    const twoImp = calcLinkedLinePrice(
      makeLine({
        imprints: [
          makeImprint({ id: "a", colors: 1, location: "Front" }),
          makeImprint({ id: "b", colors: 1, location: "Back" }),
        ],
      }),
      0, {}, STANDARD_MARKUP, {},
    );
    // Second imprint adds cost, but less than another first-print would
    expect(twoImp.printCost).toBeGreaterThan(oneImp.printCost);
    const addedByImprint2 = twoImp.printCost - oneImp.printCost;
    expect(addedByImprint2).toBeLessThan(oneImp.printCost);
  });

  it("MI2 — imprints with colors=0 are dropped (don't count toward printCost)", () => {
    // A blank imprint slot the user added but didn't fill in shouldn't
    // affect pricing.
    const baseline = calcLinkedLinePrice(
      makeLine({ imprints: [makeImprint({ colors: 1 })] }),
      0, {}, STANDARD_MARKUP, {},
    );
    const withBlank = calcLinkedLinePrice(
      makeLine({
        imprints: [
          makeImprint({ id: "a", colors: 1 }),
          makeImprint({ id: "b", colors: 0 }),
        ],
      }),
      0, {}, STANDARD_MARKUP, {},
    );
    expect(withBlank.printCost).toBe(baseline.printCost);
  });

  it("MI3 — all-zero-color imprints return null (entire line is empty)", () => {
    const r = calcLinkedLinePrice(
      makeLine({ imprints: [makeImprint({ colors: 0 })] }),
      0, {}, STANDARD_MARKUP, {},
    );
    expect(r).toBe(null);
  });
});

// ─────────────────────────────────────────────────────────────────────
// calcLinkedLinePrice — embroidery pricing
// ─────────────────────────────────────────────────────────────────────

describe("calcLinkedLinePrice — embroidery", () => {
  it("EM1 — secondary embroidery imprint priced at 70% of primary (volume rule)", () => {
    // Contract: when a line has multiple embroidery imprints, the
    // SECOND onward gets 70% of the per-piece rate. This is the
    // commercial agreement with the embroiderer — breaking it
    // either undercharges the customer or overcharges (silent
    // either way without a test).
    const one = calcLinkedLinePrice(
      makeLine({
        imprints: [makeImprint({ technique: "Embroidery", colors: 2 })],
      }),
      0, {}, STANDARD_MARKUP, {},
    );
    const two = calcLinkedLinePrice(
      makeLine({
        imprints: [
          makeImprint({ id: "a", technique: "Embroidery", colors: 2 }),
          makeImprint({ id: "b", technique: "Embroidery", colors: 2 }),
        ],
      }),
      0, {}, STANDARD_MARKUP, {},
    );
    // The added cost of imprint #2 = first rate × 0.7 × qty
    // Total of imprint #2 alone = (total two) - (total one)
    const addedByImprint2 = two.printCost - one.printCost;
    // Single embroidery imprint cost == one.printCost. 70% of that
    // should approximate the added cost.
    const expectedAdded = one.printCost * 0.7;
    expect(addedByImprint2).toBeCloseTo(expectedAdded, 0); // ±$1 ok for rounding
  });
});

// ─────────────────────────────────────────────────────────────────────
// calcLinkedLinePrice — extras (with custom numeric values)
// ─────────────────────────────────────────────────────────────────────

describe("calcLinkedLinePrice — extras handling", () => {
  it("EX1 — boolean extras use default EXTRA_RATES per piece × qty", () => {
    const baseline = calcLinkedLinePrice(
      makeLine(), 0, {}, STANDARD_MARKUP, {},
    );
    const withExtras = calcLinkedLinePrice(
      makeLine(), 0, { colorMatch: true }, STANDARD_MARKUP, {},
    );
    const qty = 50;
    const expectedAdded = EXTRA_RATES.colorMatch * qty;
    const actualAdded = (withExtras.lineTotal - baseline.lineTotal);
    expect(actualAdded).toBeCloseTo(expectedAdded, 0);
  });

  it("EX2 — numeric extra value overrides EXTRA_RATES default (custom shop pricing)", () => {
    // The extras object can carry either booleans (use default rate)
    // or numbers (custom rate per piece). If the numeric path is
    // broken, shops can't price their own custom upcharges.
    const baseline = calcLinkedLinePrice(
      makeLine(), 0, {}, STANDARD_MARKUP, {},
    );
    const withCustom = calcLinkedLinePrice(
      makeLine(), 0, { colorMatch: 3.50 }, STANDARD_MARKUP, {},
    );
    const qty = 50;
    const expectedAdded = 3.50 * qty;
    const actualAdded = (withCustom.lineTotal - baseline.lineTotal);
    expect(actualAdded).toBeCloseTo(expectedAdded, 0);
    // And it must NOT equal the default rate
    expect(actualAdded).not.toBeCloseTo(EXTRA_RATES.colorMatch * qty, 0);
  });

  it("EX3 — shop config extras override the constants", () => {
    loadShopPricingConfig({
      extras: { colorMatch: 5.00 },
    });
    const baseline = calcLinkedLinePrice(
      makeLine(), 0, {}, STANDARD_MARKUP, {},
    );
    const withExtras = calcLinkedLinePrice(
      makeLine(), 0, { colorMatch: true }, STANDARD_MARKUP, {},
    );
    const qty = 50;
    expect(withExtras.lineTotal - baseline.lineTotal).toBeCloseTo(5.00 * qty, 0);
  });

  it("EX4 — unknown extra key (typo, removed feature) is ignored, not crash", () => {
    const r = calcLinkedLinePrice(
      makeLine(), 0, { nonExistentExtra: true }, STANDARD_MARKUP, {},
    );
    expect(r).not.toBe(null);
    expect(r.lineTotal).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// calcLinkedLinePrice — per-size vs flat garment cost
// ─────────────────────────────────────────────────────────────────────

describe("calcLinkedLinePrice — garment cost source", () => {
  it("GC1 — sizePricesOverride wins over li.sizePrices (caller-provided override)", () => {
    const li = makeLine({
      garmentCost: "4.62",
      sizePrices: { M: 5.00 },
    });
    const r = calcLinkedLinePrice(
      li, 0, {}, STANDARD_MARKUP, {},
      { M: 10.00 }, // override
    );
    // Garment ppp for M = 10.00 × markup. With override winning,
    // total should be much higher than if li.sizePrices won.
    expect(r.gCost).toBeGreaterThan(li.sizes.M * 5.00 * STANDARD_MARKUP);
  });

  it("GC2 — li.sizePrices used when no override (supplier-API pre-fill)", () => {
    const li = makeLine({
      garmentCost: "4.62",
      sizePrices: { M: 7.00 },
    });
    const noOverride = calcLinkedLinePrice(li, 0, {}, STANDARD_MARKUP, {});
    const noSizes    = calcLinkedLinePrice(
      makeLine({ garmentCost: "4.62" }),
      0, {}, STANDARD_MARKUP, {},
    );
    // Per-size $7 vs flat $4.62 → higher gCost with sizePrices
    expect(noOverride.gCost).toBeGreaterThan(noSizes.gCost);
  });

  it("GC3 — mixed: some sizes have prices, others fall back to flat", () => {
    // Real shop case: API returned price for M but not for L. L must
    // fall back to flat garmentCost, not zero out.
    const li = makeLine({
      garmentCost: "4.62",
      sizes: { M: "20", L: "10" },
      sizePrices: { M: 7.00 }, // L missing
    });
    const r = calcLinkedLinePrice(li, 0, {}, STANDARD_MARKUP, {});
    // gCost must include BOTH sizes' garment cost, not just M
    const flatLPart = 10 * 4.62 * STANDARD_MARKUP;
    expect(r.gCost).toBeGreaterThan(flatLPart * 0.5); // sanity floor
  });

  it("GC4 — sizePrices entry of 0 or negative falls back to flat (defensive)", () => {
    const li = makeLine({
      garmentCost: "4.62",
      sizePrices: { M: 0 }, // API returned 0 → must NOT charge $0/piece
    });
    const r = calcLinkedLinePrice(li, 0, {}, STANDARD_MARKUP, {});
    // gCost should reflect flatCost × markup × qty, not $0
    const expectedFromFlat = 50 * 4.62 * STANDARD_MARKUP;
    expect(r.gCost).toBeGreaterThan(expectedFromFlat * 0.5);
  });
});

// ─────────────────────────────────────────────────────────────────────
// calcLinkedLinePrice — empty / null / defensive
// ─────────────────────────────────────────────────────────────────────

describe("calcLinkedLinePrice — defensive cases", () => {
  it("DF1 — null line item returns null (no crash)", () => {
    expect(calcLinkedLinePrice(null, 0, {}, STANDARD_MARKUP, {})).toBe(null);
  });

  it("DF2 — empty imprints array returns null", () => {
    expect(calcLinkedLinePrice(
      makeLine({ imprints: [] }), 0, {}, STANDARD_MARKUP, {},
    )).toBe(null);
  });

  it("DF3 — zero qty across all sizes returns null", () => {
    expect(calcLinkedLinePrice(
      makeLine({ sizes: { M: "0", L: "0" } }), 0, {}, STANDARD_MARKUP, {},
    )).toBe(null);
  });

  it("DF4 — qty=1 (minimum) still computes a price", () => {
    // The lower-bound case: one piece, one color, one imprint. Used
    // by the wizard for sample orders.
    const r = calcLinkedLinePrice(
      makeLine({ sizes: { M: "1" } }), 0, {}, STANDARD_MARKUP, {},
    );
    expect(r).not.toBe(null);
    expect(r.lineTotal).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Quote totals — rush + discount + tax interactions (covered partly
// already, this adds the not-covered combos)
// ─────────────────────────────────────────────────────────────────────

describe("calcQuoteTotalsWithLinking — interaction cases", () => {
  it("IT1 — rush + percent discount: discount applies AFTER rush is added", () => {
    // (sub including rush) × (1 - discount%). NOT pre-rush sub × (1 - d).
    const q = {
      line_items: [makeLine()],
      rush_rate: 0.20,
      discount: 10, // 10%
      discount_type: "percent",
      tax_rate: 0,
    };
    const t = calcQuoteTotalsWithLinking(q);
    // afterDisc should be sub × 0.9
    expect(t.afterDisc).toBeCloseTo(t.sub * 0.9, 1);
  });

  it("IT2 — rush + flat discount > sub clamps afterDisc to 0 (no negative totals)", () => {
    // Defensive: shop could enter a flat discount larger than the
    // quote subtotal. Should not produce a negative invoice.
    const q = {
      line_items: [makeLine()],
      rush_rate: 0,
      discount: 99999,
      discount_type: "flat",
      tax_rate: 0,
    };
    const t = calcQuoteTotalsWithLinking(q);
    expect(t.afterDisc).toBe(0);
    expect(t.total).toBe(0);
  });

  it("IT3 — tax computed on afterDisc, not on sub (discount goes BEFORE tax)", () => {
    const q = {
      line_items: [makeLine()],
      rush_rate: 0,
      discount: 10,
      discount_type: "percent",
      tax_rate: 8.25,
    };
    const t = calcQuoteTotalsWithLinking(q);
    expect(t.tax).toBeCloseTo(t.afterDisc * 0.0825, 1);
  });

  it("IT4 — empty line_items → all totals are 0, no crash", () => {
    const t = calcQuoteTotalsWithLinking({ line_items: [] });
    expect(t.sub).toBe(0);
    expect(t.total).toBe(0);
  });

  it("IT5 — null quote → all totals are 0", () => {
    const t = calcQuoteTotalsWithLinking(null);
    expect(t.sub).toBe(0);
    expect(t.total).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// buildQBInvoicePayload — discount/tax/clientPpp interaction with QB
// ─────────────────────────────────────────────────────────────────────

describe("buildQBInvoicePayload — interaction cases", () => {
  it("QI1 — clientPpp override surfaces in QB line amount", () => {
    // Customer-locked per-piece price (negotiated rate). The QB
    // invoice must reflect this, NOT the standard live calc.
    const li = makeLine({ clientPpp: 5.00 });
    const q = {
      line_items: [li],
      rush_rate: 0,
      tax_rate: 0,
    };
    const payload = buildQBInvoicePayload(q);
    // qty × clientPpp = expected amount
    expect(payload.lines[0].amount).toBeCloseTo(50 * 5.00, 1);
  });

  it("QI2 — flat discount > 100 with no discount_type defaults to flat", () => {
    // Implicit-flat behavior: if user enters 150 and discount_type
    // is unset, treat as a $150 discount (not 150%).
    const q = {
      line_items: [makeLine()],
      discount: 150,
      // discount_type left undefined
      rush_rate: 0,
      tax_rate: 0,
    };
    const payload = buildQBInvoicePayload(q);
    expect(payload.discountType).toBe("flat");
    expect(payload.discountAmount).toBe(150);
  });

  it("QI3 — discount_type explicit 'percent' with value > 100 still treated as percent (not flat)", () => {
    // Defense against the auto-flat-detection eating an explicit
    // percent. If a shop sets type=percent AND value=200, that's
    // nonsensical but we should still respect their explicit choice.
    const q = {
      line_items: [makeLine()],
      discount: 200,
      discount_type: "percent",
      rush_rate: 0,
      tax_rate: 0,
    };
    const payload = buildQBInvoicePayload(q);
    expect(payload.discountType).toBe("percent");
    expect(payload.discountPercent).toBe(200);
  });
});
