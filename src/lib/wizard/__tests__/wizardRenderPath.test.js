// BOUNDARY TEST — Public Wizard Render Path → Pricing Pipeline
//
// The contract test in configContract.test.js asserts on individual
// helper functions. This file goes one layer up — it replicates the
// EXACT sequence the wizard runs to compute its live pricing, end to
// end, with realistic fixtures. If any step in the chain drops or
// mangles the blank cost (the bug we kept shipping), this test fails
// before the build ships.
//
// What it covers that lower-level tests don't:
//
//   - The actual order: getEffectiveCost → liveItems shape →
//     calcQuoteTotalsWithLinking. Tests below stub each piece in
//     isolation; this one walks the real call graph.
//
//   - The hydration step: loadShopPricingConfig is called BEFORE
//     pricing math runs. Without it, the math falls back to platform
//     defaults — which is what caused the embroidery-not-showing bug
//     and (partially) the missing-garment-cost bug for shops on
//     custom tiers.
//
//   - Realistic supplier-shape inputs: piecePrice as strings,
//     priceMap with the customer's color missing, garmentCost = 0.
//     If the wizard's lookup misses any of these, the side panel
//     surfaces "$0" — exactly what the user reported.
//
// New tests get added here whenever a pricing regression slips past
// the unit tests. Each one names the specific failure mode it guards.

import { describe, it, expect, beforeEach } from "vitest";
import { getEffectiveCost } from "../getEffectiveCost";
import {
  calcQuoteTotalsWithLinking,
  loadShopPricingConfig,
  getShopPricingConfig,
} from "@/components/shared/pricing";

// Reset the module-level pricing config between tests. Without this,
// state from one test leaks into the next and we can't tell whether
// hydration actually fired.
beforeEach(() => {
  loadShopPricingConfig(null);
});

// Realistic curated style row as the shop saves it via the Wizard
// Setup → Sync from Suppliers flow. Matches the shape that comes
// out of normalizeSupplierMatch.
const SAVED_BELLA_3001 = {
  id: "bc-3001",
  styleNumber: "3001",
  brand: "Bella+Canvas",
  name: "Bella+Canvas 3001 Unisex Tee",
  description: "Unisex Jersey Short Sleeve Tee",
  weight: "4.2 oz",
  garmentCost: 3.18,
  priceMap: {
    Black: { piecePrice: 3.18 },
    White: { piecePrice: 2.95 },
    Navy:  { piecePrice: 3.25 },
  },
  colors: ["Black", "White", "Navy"],
  colorImages: {
    Black: "https://ex.com/black.jpg",
    White: "https://ex.com/white.jpg",
    Navy:  "https://ex.com/navy.jpg",
  },
  styleImage: "https://ex.com/black.jpg",
  sizes: ["S", "M", "L", "XL"],
};

/**
 * Replicates the wizard's `allLiveItems` builder (see
 * OrderWizard.jsx where `garments.filter(gg => gg.style).map(...)` runs).
 * Returns the line_items array that gets handed to
 * calcQuoteTotalsWithLinking.
 *
 * Keeping this in the test (not the wizard) deliberately — if the
 * wizard's transformer changes shape, we want this test to FAIL so we
 * notice the contract shifted, not silently rebuild against the new
 * shape.
 */
function buildLiveItemsLikeWizard(garment) {
  const gQty = Object.values(garment.sizes || {}).reduce(
    (a, v) => a + (parseInt(v) || 0),
    0
  );
  return [
    {
      id: garment.id || "g1",
      garmentCost: getEffectiveCost(garment),
      sizes: gQty > 0 ? garment.sizes : { M: 50 },
      imprints: garment.imprints,
    },
  ];
}

describe("Wizard render path — saved config flows through to a non-zero total", () => {
  it("style + color + qty + 1-color front print → total includes the blank", () => {
    const garment = {
      id: "g1",
      style: SAVED_BELLA_3001,
      color: "Black",
      sizes: { M: 50 },
      imprints: [{ id: "p1", location: "Front", colors: 1, technique: "Screen Print" }],
    };
    const liveQuote = {
      line_items: buildLiveItemsLikeWizard(garment),
      rush_rate: 0, extras: {}, discount: 0, tax_rate: 0, deposit_pct: 0,
    };
    const totals = calcQuoteTotalsWithLinking(liveQuote);
    const blanksAlone = 50 * 3.18;

    // The exact assertion that should have caught the bug the first time:
    expect(totals.total).toBeGreaterThan(blanksAlone);
    // And the per-piece sanity check — under the blank price means the
    // blank fell out of the math entirely.
    expect(totals.total / 50).toBeGreaterThan(3.18);
  });

  it("two garments in one run → both blanks make it into the run total", () => {
    const g1 = {
      id: "g1",
      style: SAVED_BELLA_3001,
      color: "Black",
      sizes: { M: 50 },
      imprints: [{ id: "p1", location: "Front", colors: 1, technique: "Screen Print" }],
    };
    const g2 = {
      id: "g2",
      style: SAVED_BELLA_3001,
      color: "Navy", // different color → different priceMap lookup
      sizes: { L: 25 },
      imprints: [{ id: "p2", location: "Back", colors: 1, technique: "Screen Print" }],
    };
    const liveQuote = {
      line_items: [
        ...buildLiveItemsLikeWizard(g1),
        ...buildLiveItemsLikeWizard(g2),
      ],
      rush_rate: 0, extras: {}, discount: 0, tax_rate: 0, deposit_pct: 0,
    };
    const totals = calcQuoteTotalsWithLinking(liveQuote);
    // 50 × $3.18 (Black) + 25 × $3.25 (Navy) = blanks alone = $240.25
    expect(totals.total).toBeGreaterThan(240);
  });

  it("rush 20% premium stacks on top of the blank cost (not just imprints)", () => {
    const garment = {
      id: "g1",
      style: SAVED_BELLA_3001,
      color: "Black",
      sizes: { M: 50 },
      imprints: [{ id: "p1", location: "Front", colors: 1, technique: "Screen Print" }],
    };
    const standardQ = {
      line_items: buildLiveItemsLikeWizard(garment),
      rush_rate: 0, extras: {}, discount: 0, tax_rate: 0, deposit_pct: 0,
    };
    const rushQ = { ...standardQ, rush_rate: 0.20 };
    const standardTotal = calcQuoteTotalsWithLinking(standardQ).total;
    const rushTotal = calcQuoteTotalsWithLinking(rushQ).total;
    // Rush should be ~20% above standard. Allow a small fudge for how
    // rush gets distributed across line items.
    expect(rushTotal).toBeGreaterThan(standardTotal * 1.15);
    expect(rushTotal).toBeLessThan(standardTotal * 1.25);
  });
});

describe("Wizard render path — degraded supplier data still produces a non-zero blank", () => {
  it("supplier returned piecePrice as STRING — wizard still includes the blank", () => {
    // The exact wire-shape that originally slipped past getEffectiveCost.
    // We previously thought our enricher always coerced; in fact older
    // shop configs and certain S&S responses pass strings through.
    const degraded = {
      ...SAVED_BELLA_3001,
      priceMap: { Black: { piecePrice: "3.18" } },
    };
    const garment = {
      id: "g1",
      style: degraded,
      color: "Black",
      sizes: { M: 50 },
      imprints: [{ id: "p1", location: "Front", colors: 1, technique: "Screen Print" }],
    };
    const totals = calcQuoteTotalsWithLinking({
      line_items: buildLiveItemsLikeWizard(garment),
      rush_rate: 0, extras: {}, discount: 0, tax_rate: 0, deposit_pct: 0,
    });
    expect(totals.total).toBeGreaterThan(50 * 3.18);
  });

  it("customer's color is missing from priceMap — wizard still includes the blank from fallback", () => {
    // Shop synced White + Navy but customer picks Black. The "color
    // not in priceMap" branch in getEffectiveCost should cover this.
    const sparse = {
      ...SAVED_BELLA_3001,
      priceMap: {
        White: { piecePrice: 2.95 },
        Navy:  { piecePrice: 3.25 },
      },
    };
    const garment = {
      id: "g1",
      style: sparse,
      color: "Black", // not in priceMap
      sizes: { M: 50 },
      imprints: [{ id: "p1", location: "Front", colors: 1, technique: "Screen Print" }],
    };
    const totals = calcQuoteTotalsWithLinking({
      line_items: buildLiveItemsLikeWizard(garment),
      rush_rate: 0, extras: {}, discount: 0, tax_rate: 0, deposit_pct: 0,
    });
    // Should resolve to garmentCost (3.18) — non-zero blank.
    expect(totals.total).toBeGreaterThan(50 * 2);
  });

  it("garmentCost = 0 AND priceMap has the color — the per-color entry still wins", () => {
    const zeroFallback = {
      ...SAVED_BELLA_3001,
      garmentCost: 0,
    };
    const garment = {
      id: "g1",
      style: zeroFallback,
      color: "Black",
      sizes: { M: 50 },
      imprints: [{ id: "p1", location: "Front", colors: 1, technique: "Screen Print" }],
    };
    const totals = calcQuoteTotalsWithLinking({
      line_items: buildLiveItemsLikeWizard(garment),
      rush_rate: 0, extras: {}, discount: 0, tax_rate: 0, deposit_pct: 0,
    });
    expect(totals.total).toBeGreaterThan(50 * 3);
  });
});

describe("Wizard render path — pricing config hydration", () => {
  it("loadShopPricingConfig(null) → math falls back to platform default tiers", () => {
    // Confirms the wizard's empty-hydration state still produces a
    // sensible total — wouldn't want a regression here that throws.
    loadShopPricingConfig(null);
    const garment = {
      id: "g1",
      style: SAVED_BELLA_3001,
      color: "Black",
      sizes: { M: 50 },
      imprints: [{ id: "p1", location: "Front", colors: 1, technique: "Screen Print" }],
    };
    const totals = calcQuoteTotalsWithLinking({
      line_items: buildLiveItemsLikeWizard(garment),
      rush_rate: 0, extras: {}, discount: 0, tax_rate: 0, deposit_pct: 0,
    });
    expect(totals.total).toBeGreaterThan(0);
  });

  it("loadShopPricingConfig(shopConfig) actually hydrates the module — round-trip via getShopPricingConfig()", () => {
    // The whole point of the QuoteRequest.jsx hydration call is to
    // populate the module-level `_pc`. If `_pc` is null, the pricing
    // engine falls back to platform defaults — which is what caused
    // the "embroidery not in dropdown" bug.
    //
    // We DON'T assert here on the exact shape the pricing engine reads
    // — that's an internal detail of pricing.jsx. We DO assert that
    // calling loadShopPricingConfig with a non-empty object actually
    // stores it, so the next consumer (getEnabledTechniques,
    // calcLinkedLinePrice, etc.) can find it. If this round-trip
    // breaks, the public wizard is silently running on platform
    // defaults and we want CI to scream.
    expect(getShopPricingConfig()).toBeNull();

    const fakeConfig = {
      tiers: [10, 25, 50, 100],
      embroidery: { enabled: true },
      anyKey: "anyValue",
    };
    loadShopPricingConfig(fakeConfig);
    expect(getShopPricingConfig()).toEqual(fakeConfig);

    // And the inverse — null clears it back to platform defaults.
    loadShopPricingConfig(null);
    expect(getShopPricingConfig()).toBeNull();
  });
});
