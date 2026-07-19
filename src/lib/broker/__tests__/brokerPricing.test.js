import { describe, it, expect, afterEach } from "vitest";
import {
  sanitizeBrokerOverrides,
  hasBrokerOverrides,
  mergeBrokerPricing,
  brokerPricingMode,
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
