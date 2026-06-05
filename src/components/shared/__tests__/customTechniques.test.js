// Custom-technique price tables. Shops can add additional decoration
// methods (DTG, DTF, Heat Transfer, Sublimation, anything they name)
// via Account → Pricing and assign per-color × per-tier rates. The
// engine routes per-imprint based on the imprint's `technique`
// field; unknown techniques fall back to the screen-print table so
// adding a technique without filling in its rate sheet still prices
// SOMETHING (rather than zero) — surfaced to the shop as "missing
// rates" so they remember to fill it in.

import { describe, it, expect, beforeEach } from "vitest";
import {
  loadShopPricingConfig,
  getTier,
  getTechniqueRates,
  getEnabledTechniques,
  calcLinkedLinePrice,
  STANDARD_MARKUP,
} from "../pricing";

// Helper — minimal screen-print rate config that varies enough by tier
// to make custom-vs-default routing observable in the assertions.
const SCREEN_PRINT_CFG = {
  firstPrint: {
    1: { 25: 6.30, 50: 5.67, 100: 5.22, 200: 4.90 },
    2: { 25: 6.93, 50: 6.24, 100: 5.77, 200: 5.48 },
  },
  addlPrint: {
    1: { 25: 3.15, 50: 2.68, 100: 2.41, 200: 2.29 },
    2: { 25: 3.45, 50: 2.93, 100: 2.64, 200: 2.51 },
  },
  tiers: [25, 50, 100, 200],
  maxColors: 8,
};

// Distinct DTG rates so we can tell them apart from screen print.
const DTG_RATES = {
  firstPrint: {
    1: { 25: 12.00, 50: 11.00, 100: 10.00, 200: 9.00 },
    2: { 25: 12.00, 50: 11.00, 100: 10.00, 200: 9.00 },
  },
  addlPrint: {
    1: { 25: 6.00, 50: 5.50, 100: 5.00, 200: 4.50 },
    2: { 25: 6.00, 50: 5.50, 100: 5.00, 200: 4.50 },
  },
  tiers: [25, 50, 100, 200],
  maxColors: 2,
};

beforeEach(() => {
  loadShopPricingConfig(null); // reset between tests
});

describe("getTechniqueRates — resolver", () => {
  it("returns null for Embroidery so the caller takes the embroidery path", () => {
    expect(getTechniqueRates("Embroidery", SCREEN_PRINT_CFG)).toBeNull();
  });

  it("returns screen-print defaults when no custom_techniques are configured", () => {
    const rates = getTechniqueRates("DTG", SCREEN_PRINT_CFG);
    expect(rates.firstPrint).toBe(SCREEN_PRINT_CFG.firstPrint);
    expect(rates.tiers).toEqual([25, 50, 100, 200]);
    expect(rates.maxColors).toBe(8);
  });

  it("returns the custom table when the tech is configured", () => {
    const cfg = { ...SCREEN_PRINT_CFG, custom_techniques: { DTG: DTG_RATES } };
    const rates = getTechniqueRates("DTG", cfg);
    expect(rates.firstPrint).toBe(DTG_RATES.firstPrint);
    expect(rates.addlPrint).toBe(DTG_RATES.addlPrint);
    expect(rates.maxColors).toBe(2);
  });

  it("falls back per-field when the custom config is partial", () => {
    // Shop added DTG but only set first-print rates; addl + tiers + max
    // should fall through to screen-print so the partial save still
    // produces a calculable rate instead of NaN/zero.
    const cfg = {
      ...SCREEN_PRINT_CFG,
      custom_techniques: {
        DTG: { firstPrint: DTG_RATES.firstPrint }, // missing addlPrint, tiers, maxColors
      },
    };
    const rates = getTechniqueRates("DTG", cfg);
    expect(rates.firstPrint).toBe(DTG_RATES.firstPrint);     // custom
    expect(rates.addlPrint).toBe(SCREEN_PRINT_CFG.addlPrint); // fallback
    expect(rates.tiers).toEqual([25, 50, 100, 200]);          // fallback
    expect(rates.maxColors).toBe(8);                          // fallback
  });

  it("rejects non-positive / non-finite maxColors and falls back", () => {
    const cfg = {
      ...SCREEN_PRINT_CFG,
      custom_techniques: { DTG: { ...DTG_RATES, maxColors: 0 } },
    };
    expect(getTechniqueRates("DTG", cfg).maxColors).toBe(8);
    const cfg2 = {
      ...SCREEN_PRINT_CFG,
      custom_techniques: { DTG: { ...DTG_RATES, maxColors: -3 } },
    };
    expect(getTechniqueRates("DTG", cfg2).maxColors).toBe(8);
  });
});

describe("getEnabledTechniques — surfaces configured customs", () => {
  it("includes Screen Print by default", () => {
    expect(getEnabledTechniques({})).toEqual(["Screen Print"]);
  });

  it("appends every key from custom_techniques", () => {
    const cfg = { custom_techniques: { DTG: {}, DTF: {} } };
    expect(getEnabledTechniques(cfg)).toEqual(["Screen Print", "DTG", "DTF"]);
  });

  it("interleaves Embroidery before customs when both configured", () => {
    const cfg = {
      embroidery: { enabled: true },
      custom_techniques: { DTG: {} },
    };
    expect(getEnabledTechniques(cfg)).toEqual(["Screen Print", "Embroidery", "DTG"]);
  });

  it("doesn't duplicate a tech if a shop names a custom 'Screen Print'", () => {
    const cfg = { custom_techniques: { "Screen Print": {} } };
    // Existing entry stays at position 0; no second copy at the end.
    expect(getEnabledTechniques(cfg)).toEqual(["Screen Print"]);
  });

  it("ignores empty / whitespace tech names (defensive)", () => {
    const cfg = { custom_techniques: { "": {}, "   ": {}, "DTG": {} } };
    expect(getEnabledTechniques(cfg)).toEqual(["Screen Print", "DTG"]);
  });
});

describe("getTier — accepts override tiers", () => {
  it("uses _pc.tiers when no override", () => {
    loadShopPricingConfig({ tiers: [10, 25, 50] });
    expect(getTier(30)).toBe(25);
  });

  it("uses override tiers when passed", () => {
    loadShopPricingConfig({ tiers: [25, 50, 100] });
    expect(getTier(30, [10, 20, 30])).toBe(30);
  });

  it("returns the lowest tier when qty is below all tiers", () => {
    expect(getTier(5, [10, 25, 50])).toBe(10);
  });
});

// ── End-to-end: calcLinkedLinePrice routes by technique ──────────
function makeLine(technique, opts = {}) {
  return {
    id: "li-test",
    garmentCost: 5,
    sizes: { M: 50 },
    imprints: [
      {
        id: "imp-1",
        location: "Front",
        colors: 1,
        technique,
        ...(opts.imprint || {}),
      },
    ],
  };
}

describe("calcLinkedLinePrice — per-technique rate routing", () => {
  it("uses screen-print rates when no custom_techniques are set", () => {
    loadShopPricingConfig(SCREEN_PRINT_CFG);
    const r = calcLinkedLinePrice(
      makeLine("Screen Print"),
      0, // rushRate
      {}, // extras
      STANDARD_MARKUP,
      {}, // linkedQtyMap
    );
    // 50 pcs, 1 color, screen-print first = $5.67/pc * 50 = $283.50 print cost
    expect(r.printBreakdown[0].rate).toBe(5.67);
  });

  it("uses DTG rates when imprint is DTG and DTG is configured", () => {
    loadShopPricingConfig({
      ...SCREEN_PRINT_CFG,
      custom_techniques: { DTG: DTG_RATES },
    });
    const r = calcLinkedLinePrice(
      makeLine("DTG"),
      0,
      {},
      STANDARD_MARKUP,
      {},
    );
    // 50 pcs, 1 color, DTG first = $11.00/pc
    expect(r.printBreakdown[0].rate).toBe(11.00);
  });

  it("falls back to screen-print rates when DTG is selected but not configured", () => {
    // Shop selected DTG on an imprint without ever opening Account →
    // Pricing → DTG. Engine should not return $0; falling back to
    // screen-print keeps the quote priceable until the shop fills in
    // their own DTG sheet.
    loadShopPricingConfig(SCREEN_PRINT_CFG);
    const r = calcLinkedLinePrice(
      makeLine("DTG"),
      0,
      {},
      STANDARD_MARKUP,
      {},
    );
    expect(r.printBreakdown[0].rate).toBe(5.67);
  });

  it("respects per-technique maxColors clamp", () => {
    // DTG configured with maxColors=2. An imprint with colors=5 should
    // clamp to 2 (not blow past the table).
    loadShopPricingConfig({
      ...SCREEN_PRINT_CFG,
      custom_techniques: { DTG: DTG_RATES },
    });
    const line = makeLine("DTG", { imprint: { colors: 5 } });
    const r = calcLinkedLinePrice(line, 0, {}, STANDARD_MARKUP, {});
    // Clamped to 2; DTG.firstPrint[2][50] = $11
    expect(r.printBreakdown[0].rate).toBe(11.00);
    expect(r.printBreakdown[0].colors).toBe(2);
  });
});
