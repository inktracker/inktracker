import { describe, it, expect } from "vitest";
import { buildTradeSheetConfig, tradeConfigFromDraft, computeTradeTotal } from "@/lib/partnerTradePricing";

// A minimal but realistic receiver shop config: screen print + embroidery.
const shopConfig = {
  tiers: [25, 50, 100, 200],
  maxColors: 8,
  firstPrint: { 1: { 25: 6, 50: 5, 100: 4.5, 200: 4 }, 2: { 25: 8, 50: 7, 100: 6, 200: 5 } },
  addlPrint: { 1: { 25: 3, 50: 2.5, 100: 2, 200: 1.8 } },
  garmentMarkup: [{ above: 0, markup: 1.4 }],
  embroidery: {
    enabled: true,
    qtyTiers: [12, 24, 48, 72, 144],
    stitchTiers: ["Under 5K", "5K-10K", "10K-15K", "15K+"],
    pricing: {
      "Under 5K": { 12: 8, 24: 7, 48: 6, 72: 5, 144: 4 },
      "5K-10K": { 12: 10, 24: 9, 48: 8, 72: 7, 144: 6 },
      "10K-15K": { 12: 12, 24: 11, 48: 10, 72: 9, 144: 8 },
      "15K+": { 12: 14, 24: 13, 48: 12, 72: 11, 144: 10 },
    },
  },
};

const spLine = (garmentCost) => ({
  sizes: { OS: 50 }, garmentCost,
  imprints: [{ id: "i", technique: "Screen Print", colors: 1 }],
});

describe("buildTradeSheetConfig", () => {
  it("emits engine-shaped config (custom_techniques, embroidery.enabled)", () => {
    const cfg = buildTradeSheetConfig(shopConfig, 100);
    expect(cfg.custom_techniques).toBeDefined();
    expect(cfg.embroidery.enabled).toBe(true);
    expect(cfg.firstPrint[1][50]).toBe(5);
  });
});

describe("computeTradeTotal — decoration-only, at the partner's rates", () => {
  it("prices screen print at the sheet's rate × qty", () => {
    // 1 color, 50 pcs → tier 50 → $5/pc → $250 decoration.
    const cfg = buildTradeSheetConfig(shopConfig, 100);
    expect(computeTradeTotal([spLine(10)], cfg)).toBe(250);
  });

  it("scales linearly with the trade %", () => {
    const at100 = computeTradeTotal([spLine(10)], buildTradeSheetConfig(shopConfig, 100));
    const at50 = computeTradeTotal([spLine(10)], buildTradeSheetConfig(shopConfig, 50));
    expect(at50).toBe(Math.round(at100 * 0.5 * 100) / 100);
    expect(at50).toBe(125);
  });

  it("IGNORES garment cost (decoration-only — the partner didn't supply the goods)", () => {
    const cfg = buildTradeSheetConfig(shopConfig, 100);
    expect(computeTradeTotal([spLine(0)], cfg)).toBe(computeTradeTotal([spLine(999)], cfg));
  });

  it("prices embroidery off the stitch-tier grid (colors = stitch-tier index)", () => {
    // colors:2 → stitch index 1 → "5K-10K"; 50 pcs → qty tier 48 → $8/pc → $400.
    const line = { sizes: { OS: 50 }, imprints: [{ id: "e", technique: "Embroidery", colors: 2 }] };
    expect(computeTradeTotal([line], buildTradeSheetConfig(shopConfig, 100))).toBe(400);
    expect(computeTradeTotal([line], buildTradeSheetConfig(shopConfig, 50))).toBe(200);
  });

  it("returns 0 for no lines or no sheet", () => {
    expect(computeTradeTotal([], buildTradeSheetConfig(shopConfig, 100))).toBe(0);
    expect(computeTradeTotal([spLine(10)], null)).toBe(0);
  });
});

describe("tradeConfigFromDraft — who supplies the garments", () => {
  const draft = {
    tiers: [25, 50, 100, 200], maxColors: 8,
    firstPrint: shopConfig.firstPrint, addlPrint: shopConfig.addlPrint,
    garmentMarkup: [{ above: 0, markup: 1.5 }],
    embroidery: null, customTechniques: {},
  };

  it("sender-supplies: decoration-only, garment ignored (250)", () => {
    const cfg = tradeConfigFromDraft(draft, shopConfig, false);
    expect(cfg.receiver_supplies_garments).toBe(false);
    expect(cfg.garmentMarkup).toBeUndefined();
    expect(computeTradeTotal([spLine(10)], cfg)).toBe(250);
    expect(computeTradeTotal([spLine(999)], cfg)).toBe(250); // still garment-independent
  });

  it("receiver-supplies: adds garment × markup on top of decoration", () => {
    const cfg = tradeConfigFromDraft(draft, shopConfig, true);
    expect(cfg.receiver_supplies_garments).toBe(true);
    expect(cfg.garmentMarkup).toEqual([{ above: 0, markup: 1.5 }]);
    // decoration 250 + garment (10 × 1.5 × 50 = 750) = 1000.
    expect(computeTradeTotal([spLine(10)], cfg)).toBe(1000);
  });
});
