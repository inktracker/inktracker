// CONTRACT TEST — Wizard Config → Public Pricing Math
//
// This is the test that would have caught the production bug where the
// shop's saved wizard_styles[] was missing garmentCost + priceMap, so
// the customer-facing wizard charged $0 for the blank garment and only
// counted imprint costs.
//
// The contract being enforced:
//
//   Given an enriched style row (the output of normalizeSupplierMatch +
//   the shape persisted into shops.wizard_styles), when the public
//   wizard runs its live pricing math on that style + a color + a
//   quantity + one or more imprints, the resulting line total MUST
//   include the blank cost (priceMap[color].piecePrice * qty) ON TOP
//   of the imprint costs.
//
// If a future change drops a field from normalizeSupplierMatch or breaks
// getEffectiveCost's lookup chain, this test fails before the bug ever
// reaches production.

import { describe, it, expect } from "vitest";
import { normalizeSupplierMatch, isStyleEnriched } from "../enrichStyle";
import { calcQuoteTotalsWithLinking } from "@/components/shared/pricing";
// Import the REAL function the wizard uses, not an inlined replica.
// Prior version of this test inlined a copy of getEffectiveCost; the
// real function had a string-coercion bug that the test didn't catch
// because the inlined copy didn't have it. Importing the real one
// closes the drift gap.
import { getEffectiveCost } from "../getEffectiveCost";

// A realistic supplier response for Bella+Canvas 3001 — Black at $3.18.
const FIXTURE_SUPPLIER_MATCH = {
  id: "ss-bella-3001",
  brandName: "Bella+Canvas",
  styleNumber: "3001",
  description: "Unisex Jersey Short Sleeve Tee",
  styleCategory: "T-Shirts",
  weight: "4.2 oz",
  styleImage: "https://ss.example/3001/black.jpg",
  colors: [
    { colorName: "Black", imageUrl: "https://ss.example/3001/black.jpg", piecePrice: 3.18 },
    { colorName: "White", imageUrl: "https://ss.example/3001/white.jpg", piecePrice: 2.95 },
  ],
  sizes: ["S", "M", "L", "XL"],
};

/**
 * Replicates the live-quote shape OrderWizard hands to
 * calcQuoteTotalsWithLinking. Lets us assert: given enriched style data,
 * the math sees the blank cost.
 */
function buildLiveQuote({ enrichedStyle, color, sizes, imprints, rushRate = 0 }) {
  const gg = {
    id: "g1",
    style: enrichedStyle,
    color,
    sizes,
    imprints,
  };
  return {
    line_items: [
      {
        id: gg.id,
        garmentCost: getEffectiveCost(gg),
        sizes: gg.sizes,
        imprints: gg.imprints,
      },
    ],
    rush_rate: rushRate,
    extras: {},
    discount: 0,
    tax_rate: 0,
    deposit_pct: 0,
  };
}

describe("Contract: enriched config → public wizard pricing math", () => {
  const enriched = normalizeSupplierMatch(FIXTURE_SUPPLIER_MATCH, {
    source: "ss",
    brandHint: "Bella+Canvas",
  });

  it("the enriched style satisfies isStyleEnriched (gate passes)", () => {
    // If this fails, the save-time auto-enrich would loop forever or skip
    // the row — and the bug from production would silently return.
    expect(isStyleEnriched(enriched)).toBe(true);
  });

  it("the enriched style includes priceMap entries the wizard math reads", () => {
    // The exact fields the wizard needs:
    expect(enriched.priceMap).toBeTruthy();
    expect(enriched.priceMap.Black).toEqual({ piecePrice: 3.18 });
    expect(enriched.garmentCost).toBeGreaterThan(0);
  });

  it("getEffectiveCost returns the per-color blank price (not 0)", () => {
    // This is what gets fed into the math as `garmentCost`. If this
    // returns 0, the line total only reflects imprint costs.
    const cost = getEffectiveCost({ style: enriched, color: "Black" });
    expect(cost).toBe(3.18);
  });

  it("falls back to garmentCost when color isn't in priceMap", () => {
    const cost = getEffectiveCost({ style: enriched, color: "Maroon" });
    // Maroon isn't in priceMap — falls back to the flat garmentCost
    // (which normalizeSupplierMatch derived from the supplier match).
    expect(cost).toBe(enriched.garmentCost);
    expect(cost).toBeGreaterThan(0);
  });

  it("calcQuoteTotalsWithLinking produces a total that INCLUDES the blank cost", () => {
    // The end-to-end assertion. 50 pieces, 1-color front print, Black tee.
    const quote = buildLiveQuote({
      enrichedStyle: enriched,
      color: "Black",
      sizes: { S: 10, M: 20, L: 15, XL: 5 },
      imprints: [{ id: "p1", location: "Front", colors: 1, technique: "Screen Print" }],
    });
    const totals = calcQuoteTotalsWithLinking(quote);
    const qty = 50;
    const blanksAlone = qty * 3.18; // $159.00

    // Critical assertion — total must be ≥ the blank cost. Anything less
    // means the blank fell out of the math (the production bug).
    expect(totals.total).toBeGreaterThanOrEqual(blanksAlone);

    // Additionally — total should be MORE than blanks alone (imprints
    // add cost too). This catches the inverse failure mode (imprints
    // silently dropped).
    expect(totals.total).toBeGreaterThan(blanksAlone);
  });

  it("the public wizard's per-piece price reflects the blank cost", () => {
    // Same math, asserted as per-piece. A regression that drops the
    // blank would make per-piece roughly the imprint setup cost
    // amortized — usually <$1. The blank alone is $3.18, so anything
    // below that means the bug is back.
    const quote = buildLiveQuote({
      enrichedStyle: enriched,
      color: "Black",
      sizes: { M: 50 },
      imprints: [{ id: "p1", location: "Front", colors: 1, technique: "Screen Print" }],
    });
    const totals = calcQuoteTotalsWithLinking(quote);
    const perPiece = totals.total / 50;
    expect(perPiece).toBeGreaterThan(3.18);
  });

  it("a style row with photos but missing cost data fails isStyleEnriched", () => {
    // The EXACT shape that was sitting in the user's prod database
    // before the fix — would silently pass the old predicate.
    const photoOnlyRow = {
      name: "Bella+Canvas 3001",
      styleImage: enriched.styleImage,
      colorImages: enriched.colorImages,
      colors: enriched.colors,
      // No garmentCost, no priceMap — the bug.
    };
    expect(isStyleEnriched(photoOnlyRow)).toBe(false);
    // Which means the save-time auto-enrich will refetch it. Good.
  });
});

describe("Contract: getEffectiveCost — the bugs that slipped past v1 of this test", () => {
  // These cases were ALL the inlined-replica's blind spots. They use
  // the imported real function now, so any future change to it has to
  // satisfy these or the build fails.

  it("coerces string prices through Number() — supplier APIs sometimes ship strings", () => {
    // Bella+Canvas's S&S response occasionally returns piecePrice as a
    // string ("3.18"). The original `pm?.piecePrice || ...` chain
    // treated the string as truthy without parsing, returned it, and
    // the downstream math silently degraded to NaN. Real fn must
    // coerce.
    const gg = {
      style: { priceMap: { Black: { piecePrice: "3.18" } } },
      color: "Black",
    };
    expect(getEffectiveCost(gg)).toBe(3.18);
    expect(typeof getEffectiveCost(gg)).toBe("number");
  });

  it("falls back to garmentCost when the selected color isn't in priceMap", () => {
    const gg = {
      style: {
        garmentCost: 5.5,
        priceMap: { Black: { piecePrice: 3.18 } },
      },
      color: "Maroon", // not in priceMap
    };
    expect(getEffectiveCost(gg)).toBe(5.5);
  });

  it("falls back to the first non-zero priceMap entry when selected color is missing AND garmentCost is 0", () => {
    // "Shop synced White but customer picked Black" — sparse priceMap
    // edge case. Charging the average garment beats silently invoicing
    // $0 for the blank.
    const gg = {
      style: {
        garmentCost: 0,
        priceMap: {
          White: { piecePrice: 2.95 },
          Navy:  { piecePrice: 3.25 },
        },
      },
      color: "Black",
    };
    expect(getEffectiveCost(gg)).toBeGreaterThan(0);
  });

  it("returns 0 for the true-unknown case so the UI surfaces 'Add quantities to see pricing'", () => {
    const gg = { style: { priceMap: {} }, color: "Black" };
    expect(getEffectiveCost(gg)).toBe(0);
  });

  it("returns 0 (not NaN) for a falsy style — wizard's empty initial state", () => {
    expect(getEffectiveCost({ style: null, color: "" })).toBe(0);
    expect(getEffectiveCost({ style: undefined, color: "" })).toBe(0);
    expect(getEffectiveCost(undefined)).toBe(0);
  });

  it("treats zero-priced priceMap entries as missing (not as a valid blank)", () => {
    // Supplier sometimes ships piecePrice: 0 for discontinued colors.
    // Should fall through to the garmentCost fallback, not return 0.
    const gg = {
      style: {
        garmentCost: 5.5,
        priceMap: { Black: { piecePrice: 0 } },
      },
      color: "Black",
    };
    expect(getEffectiveCost(gg)).toBe(5.5);
  });
});
