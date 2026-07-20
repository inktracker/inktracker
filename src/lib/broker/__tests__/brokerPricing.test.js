import { describe, it, expect, afterEach } from "vitest";
import {
  sanitizeBrokerOverrides,
  hasBrokerOverrides,
  mergeBrokerPricing,
  brokerPricingMode,
  buildScaledSheet,
} from "../brokerPricing";
import {
  calcLinkedLinePrice,
  loadShopPricingConfig,
  BROKER_MARKUP,
  STANDARD_MARKUP,
} from "@/components/shared/pricing";

afterEach(() => loadShopPricingConfig(null));

// A minimal but complete shop sheet: $10 garment at 40% markup,
// 1-color first print $2.00 at the 25+ tier.
const SHOP_CONFIG = {
  tiers: [25, 50],
  maxColors: 2,
  firstPrint: { 1: { 25: 2.0, 50: 1.5 }, 2: { 25: 2.5, 50: 2.0 } },
  addlPrint: { 1: { 25: 1.0, 50: 0.75 }, 2: { 25: 1.5, 50: 1.0 } },
  garmentMarkup: [{ above: 0, markup: 1.4 }],
  brokerMarkupShare: 0.5,
};

// 25 pcs, $10 garment, one 1-color screen print imprint.
const LINE = {
  id: "li1",
  sizes: { M: 25 },
  garmentCost: 10,
  imprints: [{ id: "im1", technique: "Screen Print", location: "Front", colors: 1 }],
};

const linePrice = (markup, config) =>
  calcLinkedLinePrice(LINE, 0, {}, markup, {}, undefined, config);

describe("sanitizeBrokerOverrides", () => {
  it("returns {} for null / non-object / empty input", () => {
    expect(sanitizeBrokerOverrides(null)).toEqual({});
    expect(sanitizeBrokerOverrides("x")).toEqual({});
    expect(sanitizeBrokerOverrides([1])).toEqual({});
    expect(sanitizeBrokerOverrides({})).toEqual({});
  });

  it("strips keys outside the overridable whitelist", () => {
    const out = sanitizeBrokerOverrides({
      brokerMarkupShare: 0.8,
      rushTiers: [{ maxDays: 3, rate: 0.5 }],
      embroidery: { enabled: true },
      extras: { tags: 99 },
    });
    expect(out).toEqual({ brokerMarkupShare: 0.8 });
  });

  it("clamps markup share into [0,1] and drops non-numeric", () => {
    expect(sanitizeBrokerOverrides({ brokerMarkupShare: 4 }).brokerMarkupShare).toBe(1);
    expect(sanitizeBrokerOverrides({ brokerMarkupShare: -1 }).brokerMarkupShare).toBe(0);
    expect(sanitizeBrokerOverrides({ brokerMarkupShare: "abc" })).toEqual({});
  });

  it("drops malformed garment brackets and rates below cost (markup < 1)", () => {
    const out = sanitizeBrokerOverrides({
      garmentMarkup: [
        { above: 0, markup: 1.2 },
        { above: "x", markup: 1.5 },
        { above: 10, markup: 0.5 },
      ],
    });
    expect(out.garmentMarkup).toEqual([{ above: 0, markup: 1.2 }]);
  });

  it("keeps tiers/maxColors only alongside a matrix override", () => {
    expect(sanitizeBrokerOverrides({ tiers: [25, 50], maxColors: 4 })).toEqual({});
    const withMatrix = sanitizeBrokerOverrides({
      firstPrint: { 1: { 25: 1.0 } },
      tiers: [25, 50],
      maxColors: 4,
    });
    expect(withMatrix.tiers).toEqual([25, 50]);
    expect(withMatrix.maxColors).toBe(4);
  });

  it("scrubs negative and non-numeric matrix cells", () => {
    const out = sanitizeBrokerOverrides({
      firstPrint: { 1: { 25: 1.25, 50: -2 }, 2: { 25: "x" } },
    });
    expect(out.firstPrint).toEqual({ 1: { 25: 1.25 }, 2: {} });
  });
});

describe("mergeBrokerPricing", () => {
  it("returns shopConfig untouched (same reference) with no overrides", () => {
    expect(mergeBrokerPricing(SHOP_CONFIG, null)).toBe(SHOP_CONFIG);
    expect(mergeBrokerPricing(SHOP_CONFIG, {})).toBe(SHOP_CONFIG);
    expect(mergeBrokerPricing(undefined, null)).toBeUndefined();
  });

  it("layers overridden sections and inherits the rest", () => {
    const merged = mergeBrokerPricing(SHOP_CONFIG, { brokerMarkupShare: 1 });
    expect(merged.brokerMarkupShare).toBe(1);
    expect(merged.firstPrint).toBe(SHOP_CONFIG.firstPrint);
    expect(merged.garmentMarkup).toBe(SHOP_CONFIG.garmentMarkup);
    // never mutates the shop sheet
    expect(SHOP_CONFIG.brokerMarkupShare).toBe(0.5);
  });

  it("falls back to the module-global config when shopConfig is absent", () => {
    loadShopPricingConfig(SHOP_CONFIG, "shop@x.test");
    const merged = mergeBrokerPricing(undefined, { brokerMarkupShare: 1 });
    expect(merged.firstPrint).toBe(SHOP_CONFIG.firstPrint);
    expect(merged.brokerMarkupShare).toBe(1);
  });
});

describe("overlay money path (calcLinkedLinePrice)", () => {
  it("markup-share override moves the wholesale price, not retail", () => {
    // share=1 → broker pays raw garment cost ($10) instead of the
    // default 50/50 split of the 40% markup ($12).
    const merged = mergeBrokerPricing(SHOP_CONFIG, { brokerMarkupShare: 1 });

    const baseBroker = linePrice(BROKER_MARKUP, SHOP_CONFIG);
    const overlayBroker = linePrice(BROKER_MARKUP, merged);
    expect(overlayBroker.gCost).toBeCloseTo(25 * 10, 2);
    expect(overlayBroker.gCost).toBeLessThan(baseBroker.gCost);

    // Retail (client-side suggestion) is computed against the PLAIN
    // shop config by the editor — identical with or without an overlay.
    const retail = linePrice(STANDARD_MARKUP, SHOP_CONFIG);
    expect(retail.gCost).toBeCloseTo(25 * 10 * 1.4, 2);
  });

  it("contract print-rate override changes the wholesale print charge", () => {
    const merged = mergeBrokerPricing(SHOP_CONFIG, {
      firstPrint: { 1: { 25: 1.0, 50: 0.8 }, 2: { 25: 1.2, 50: 1.0 } },
      addlPrint: SHOP_CONFIG.addlPrint,
      tiers: SHOP_CONFIG.tiers,
      maxColors: SHOP_CONFIG.maxColors,
    });

    const baseBroker = linePrice(BROKER_MARKUP, SHOP_CONFIG);
    const overlayBroker = linePrice(BROKER_MARKUP, merged);
    // $2.00/pc → $1.00/pc on 25 pcs = $25 less on the line.
    expect(baseBroker.lineTotal - overlayBroker.lineTotal).toBeCloseTo(25, 2);
  });

  it("garment-bracket override applies to the broker garment cost", () => {
    // Broker bracket 20% with default share 0.5 → broker pays
    // 1 + (0.2 * 0.5) = 1.10 on the $10 garment.
    const merged = mergeBrokerPricing(SHOP_CONFIG, {
      garmentMarkup: [{ above: 0, markup: 1.2 }],
    });
    const overlayBroker = linePrice(BROKER_MARKUP, merged);
    expect(overlayBroker.gCost).toBeCloseTo(25 * 10 * 1.1, 2);
  });
});

describe("hasBrokerOverrides", () => {
  it("is false for junk-only blobs and true for a real override", () => {
    expect(hasBrokerOverrides(null)).toBe(false);
    expect(hasBrokerOverrides({ rushTiers: [] })).toBe(false);
    expect(hasBrokerOverrides({ brokerMarkupShare: 0.9 })).toBe(true);
  });
});

describe("pricing modes (the markup-% vs custom-sheet toggle)", () => {
  const SHEET_ROW = {
    mode: "sheet",
    brokerMarkupShare: 0,
    garmentMarkup: [{ above: 0, markup: 1.2 }],
    firstPrint: { 1: { 25: 1.0 } },
    addlPrint: { 1: { 25: 0.5 } },
    tiers: [25, 50],
    maxColors: 2,
  };

  it("markup mode strips any sheet sections that snuck into the row", () => {
    const out = sanitizeBrokerOverrides({
      mode: "markup",
      brokerMarkupShare: 0.7,
      firstPrint: { 1: { 25: 1.0 } },
      garmentMarkup: [{ above: 0, markup: 1.2 }],
    });
    expect(out).toEqual({ mode: "markup", brokerMarkupShare: 0.7 });
  });

  it("sheet mode keeps all sections including a 0 share (brackets apply exactly)", () => {
    const out = sanitizeBrokerOverrides(SHEET_ROW);
    expect(out.mode).toBe("sheet");
    expect(out.brokerMarkupShare).toBe(0);
    expect(out.firstPrint).toEqual(SHEET_ROW.firstPrint);
    expect(out.garmentMarkup).toEqual(SHEET_ROW.garmentMarkup);
  });

  it("mode alone (no substance) sanitizes to {} — pure default, row deletable", () => {
    expect(sanitizeBrokerOverrides({ mode: "markup" })).toEqual({});
    expect(hasBrokerOverrides({ mode: "markup" })).toBe(false);
  });

  it("brokerPricingMode derives the toggle for pre-mode rows", () => {
    expect(brokerPricingMode({ brokerMarkupShare: 0.8 })).toBe("markup");
    expect(brokerPricingMode({ firstPrint: { 1: { 25: 1.0 } } })).toBe("sheet");
    expect(brokerPricingMode(null)).toBe("markup");
    expect(brokerPricingMode(SHEET_ROW)).toBe("sheet");
  });

  it("merge never leaks the mode key into the pricing config", () => {
    const merged = mergeBrokerPricing(SHOP_CONFIG, SHEET_ROW);
    expect(merged.mode).toBeUndefined();
    expect(merged.brokerMarkupShare).toBe(0);
    expect(merged.firstPrint).toEqual(SHEET_ROW.firstPrint);
  });

  it("sheet mode with share 0: broker pays the sheet's brackets exactly", () => {
    const merged = mergeBrokerPricing(SHOP_CONFIG, {
      mode: "sheet",
      brokerMarkupShare: 0,
      garmentMarkup: [{ above: 0, markup: 1.2 }],
    });
    const r = linePrice(BROKER_MARKUP, merged);
    // share 0 → no discount on the bracket: broker pays cost × 1.2.
    expect(r.gCost).toBeCloseTo(25 * 10 * 1.2, 2);
  });
});

describe("sheet covers ALL decoration methods (Joe 2026-07-19)", () => {
  const SHOP_WITH_METHODS = {
    ...SHOP_CONFIG,
    embroidery: {
      enabled: true,
      digitizingFee: 50,
      qtyTiers: [12, 24],
      stitchTiers: ["Under 5K", "5K-10K"],
      pricing: { "Under 5K": { 12: 8.5, 24: 7.5 }, "5K-10K": { 12: 10.5, 24: 9.0 } },
      extras: { puffEmbroidery: 2.0 },
    },
    custom_techniques: {
      DTG: { tiers: [25, 50], maxColors: 1, firstPrint: { 1: { 25: 9.0, 50: 8.0 } }, addlPrint: { 1: { 25: 4.0, 50: 3.5 } } },
    },
  };

  it("sanitize keeps embroidery RATES but never enabled/extras", () => {
    const out = sanitizeBrokerOverrides({
      mode: "sheet",
      embroidery: {
        enabled: false,           // must not be overridable
        extras: { puffEmbroidery: 99 }, // must not be overridable
        digitizingFee: 25,
        qtyTiers: [12, 24],
        stitchTiers: ["Under 5K", "5K-10K"],
        pricing: { "Under 5K": { 12: 6.0, 24: 5.0 } },
      },
    });
    expect(out.embroidery.digitizingFee).toBe(25);
    expect(out.embroidery.pricing["Under 5K"][12]).toBe(6.0);
    expect(out.embroidery.enabled).toBeUndefined();
    expect(out.embroidery.extras).toBeUndefined();
  });

  it("markup mode strips embroidery and custom_techniques", () => {
    const out = sanitizeBrokerOverrides({
      mode: "markup",
      brokerMarkupShare: 0.6,
      embroidery: { pricing: { "Under 5K": { 12: 1 } } },
      custom_techniques: { DTG: { firstPrint: { 1: { 25: 1 } } } },
    });
    expect(out).toEqual({ mode: "markup", brokerMarkupShare: 0.6 });
  });

  it("merge is one-level-deep: broker embroidery rates apply, shop enabled/extras survive", () => {
    const merged = mergeBrokerPricing(SHOP_WITH_METHODS, {
      mode: "sheet",
      embroidery: { pricing: { "Under 5K": { 12: 6.0, 24: 5.0 }, "5K-10K": { 12: 8.0, 24: 7.0 } }, digitizingFee: 25 },
    });
    expect(merged.embroidery.pricing["Under 5K"][12]).toBe(6.0);
    expect(merged.embroidery.digitizingFee).toBe(25);
    expect(merged.embroidery.enabled).toBe(true);
    expect(merged.embroidery.extras).toEqual({ puffEmbroidery: 2.0 });
    // untouched techniques inherit wholesale
    expect(merged.custom_techniques.DTG.firstPrint[1][25]).toBe(9.0);
  });

  it("embroidery money path: broker wholesale uses the overridden stitch rates", () => {
    const merged = mergeBrokerPricing(SHOP_WITH_METHODS, {
      mode: "sheet",
      embroidery: { pricing: { "Under 5K": { 12: 6.0, 24: 5.0 }, "5K-10K": { 12: 8.0, 24: 7.0 } }, qtyTiers: [12, 24], stitchTiers: ["Under 5K", "5K-10K"] },
    });
    // For embroidery, imp.colors carries the stitch tier (1-based in
    // the field; the engine uses colors-1 as the stitchTiers index —
    // see lib/quotes/imprintLabels.js). colors: 1 → "Under 5K".
    const li = {
      id: "li-emb",
      sizes: { M: 12 },
      garmentCost: 0,
      imprints: [{ id: "im-e", technique: "Embroidery", location: "Left Chest", colors: 1 }],
    };
    const brokerR = calcLinkedLinePrice(li, 0, {}, BROKER_MARKUP, {}, undefined, merged);
    const shopR = calcLinkedLinePrice(li, 0, {}, BROKER_MARKUP, {}, undefined, SHOP_WITH_METHODS);
    expect(brokerR.lineTotal).toBeCloseTo(12 * 6.0, 2);
    expect(shopR.lineTotal).toBeCloseTo(12 * 8.5, 2);
  });

  it("custom technique money path: broker wholesale uses the overridden DTG rates", () => {
    const merged = mergeBrokerPricing(SHOP_WITH_METHODS, {
      mode: "sheet",
      custom_techniques: { DTG: { firstPrint: { 1: { 25: 6.0, 50: 5.0 } }, tiers: [25, 50], maxColors: 1 } },
    });
    const li = {
      id: "li-dtg",
      sizes: { M: 25 },
      garmentCost: 0,
      imprints: [{ id: "im-d", technique: "DTG", location: "Front", colors: 1 }],
    };
    const brokerR = calcLinkedLinePrice(li, 0, {}, BROKER_MARKUP, {}, undefined, merged);
    const shopR = calcLinkedLinePrice(li, 0, {}, BROKER_MARKUP, {}, undefined, SHOP_WITH_METHODS);
    expect(brokerR.lineTotal).toBeCloseTo(25 * 6.0, 2);
    expect(shopR.lineTotal).toBeCloseTo(25 * 9.0, 2);
    // addlPrint not overridden → inherits the shop's DTG table
    expect(merged.custom_techniques.DTG.addlPrint[1][25]).toBe(4.0);
  });
});

describe("buildScaledSheet — the Quick Price scaler (Joe 2026-07-20)", () => {
  const SHOP = {
    tiers: [25, 50],
    maxColors: 2,
    firstPrint: { 1: { 25: 6.0, 50: 5.0 }, 2: { 25: 7.0, 50: 6.0 } },
    addlPrint: { 1: { 25: 3.0, 50: 2.5 }, 2: { 25: 3.5, 50: 3.0 } },
    garmentMarkup: [{ above: 0, markup: 1.4 }],
    embroidery: {
      enabled: true,
      digitizingFee: 50,
      qtyTiers: [12, 24],
      stitchTiers: ["Under 5K"],
      pricing: { "Under 5K": { 12: 8.0, 24: 7.0 } },
    },
    custom_techniques: {
      DTG: { tiers: [25, 50], maxColors: 1, firstPrint: { 1: { 25: 10.0, 50: 9.0 } }, addlPrint: { 1: { 25: 5.0, 50: 4.0 } } },
    },
  };

  it("scales every dollar rate to the given percent, rounded to cents", () => {
    const s = buildScaledSheet(SHOP, 90);
    expect(s.firstPrint[1][25]).toBe(5.4);
    expect(s.addlPrint[2][50]).toBe(2.7);
    expect(s.embroidery.pricing["Under 5K"][12]).toBe(7.2);
    expect(s.embroidery.digitizingFee).toBe(45);
    expect(s.customTechniques.DTG.firstPrint[1][50]).toBe(8.1);
  });

  it("garment markup scales its MARGIN, not the multiplier (40% at 90% -> 36%)", () => {
    const s = buildScaledSheet(SHOP, 90);
    expect(s.garmentMarkup[0].markup).toBeCloseTo(1.36, 4);
    expect(s.garmentMarkup[0].above).toBe(0);
  });

  it("always derives from the shop sheet — re-applying never compounds", () => {
    const first = buildScaledSheet(SHOP, 90);
    const second = buildScaledSheet(SHOP, 85);
    expect(second.firstPrint[1][25]).toBe(5.1); // 85% of 6.00, not 85% of 5.40
    expect(first.firstPrint[1][25]).toBe(5.4);
  });

  it("carries tier snapshots and fills sparse/missing cells with 0", () => {
    const s = buildScaledSheet({ ...SHOP, firstPrint: { 1: { 25: 6.0 } } }, 90);
    expect(s.tiers).toEqual([25, 50]);
    expect(s.maxColors).toBe(2);
    expect(s.firstPrint[1][50]).toBe(0);
    expect(s.firstPrint[2][25]).toBe(0);
  });

  it("no embroidery section when the shop has it disabled", () => {
    const s = buildScaledSheet({ ...SHOP, embroidery: { ...SHOP.embroidery, enabled: false } }, 90);
    expect(s.embroidery).toBeNull();
  });

  it("0% zeroes the sheet; negatives floor at 0; huge percents cap at 200%", () => {
    expect(buildScaledSheet(SHOP, 0).firstPrint[1][25]).toBe(0);
    expect(buildScaledSheet(SHOP, -50).firstPrint[1][25]).toBe(0);
    expect(buildScaledSheet(SHOP, 999).firstPrint[1][25]).toBeCloseTo(12.0, 2); // caps at 200%
  });
});
