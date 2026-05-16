// Round 2 of the pricing.jsx coverage sweep: deep paths inside
// calcLinkedLinePrice and getEmbroideryPPP that the existing happy-
// path tests don't exercise.
//
// Focus areas (the next set of "where will the next silent bug
// come from" suspects):
//
//   1. Embroidery stitch-tier resolution — clamps, fallbacks
//   2. Embroidery qty-tier resolution — qty below smallest tier
//   3. Linked-print qty pooling — when the same imprint appears
//      across multiple line items, pricing tier uses combined qty
//   4. Screen-print rate fallback — table[colors] missing entry
//   5. Pricing config (per-shop _pc) overrides vs defaults

import { describe, it, expect, beforeEach } from "vitest";
import {
  calcLinkedLinePrice,
  buildLinkedQtyMap,
  findLinkedPrints,
  loadShopPricingConfig,
  getShopPricingConfig,
  STANDARD_MARKUP,
  FIRST_PRINT,
  ADDL_PRINT,
} from "../pricing.jsx";

beforeEach(() => {
  loadShopPricingConfig(null);
});

function makeImprint(overrides = {}) {
  return {
    id: "imp",
    title: "Logo",
    width: 4,
    height: 4,
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
// Embroidery — getEmbroideryPPP edge cases (lines 217-233)
// ─────────────────────────────────────────────────────────────────────

describe("getEmbroideryPPP — stitch tier clamp", () => {
  it("ES1 — colors > max stitch tier idx clamps to the last tier (no out-of-bounds)", () => {
    // stitchIdx is derived from colors-1. If colors is huge (15+),
    // stitchIdx overshoots stitchTiers length. Must clamp, not undefined.
    const r = calcLinkedLinePrice(
      makeLine({
        imprints: [makeImprint({ technique: "Embroidery", colors: 20 })],
      }),
      0, {}, STANDARD_MARKUP, {},
    );
    expect(r).not.toBe(null);
    expect(r.printCost).toBeGreaterThan(0);
  });

  it("ES2 — qty below smallest qty tier still resolves a rate (no zero-price)", () => {
    // Lowest default qty tier is 12. A 5-piece embroidery order
    // should still get the 12-tier rate, not silently $0.
    const r = calcLinkedLinePrice(
      makeLine({
        sizes: { M: "5" },
        imprints: [makeImprint({ technique: "Embroidery", colors: 1 })],
      }),
      0, {}, STANDARD_MARKUP, {},
    );
    expect(r).not.toBe(null);
    expect(r.printCost).toBeGreaterThan(0);
  });

  it("ES3 — qty exactly matches a tier", () => {
    const r = calcLinkedLinePrice(
      makeLine({
        sizes: { M: "48" }, // exact tier
        imprints: [makeImprint({ technique: "Embroidery", colors: 1 })],
      }),
      0, {}, STANDARD_MARKUP, {},
    );
    expect(r?.tier).toBe(48);
  });

  it("ES4 — qty between tiers picks the LOWER tier (matches the contract)", () => {
    // qty 36 should fall to tier 24 (between 24 and 48). The shop's
    // commercial reasoning: customer hasn't reached the next volume
    // discount, so they pay the higher per-piece rate of the prior tier.
    const r = calcLinkedLinePrice(
      makeLine({
        sizes: { M: "36" },
        imprints: [makeImprint({ technique: "Embroidery", colors: 1 })],
      }),
      0, {}, STANDARD_MARKUP, {},
    );
    expect(r?.tier).toBe(24);
  });

  it("ES5 — shop pricing config overrides default embroidery rates", () => {
    loadShopPricingConfig({
      embroidery: {
        enabled: true,
        pricing: { "Under 5K": { 12: 100.00 } }, // absurd, easy to test
        stitchTiers: ["Under 5K"],
        qtyTiers: [12],
      },
    });
    const r = calcLinkedLinePrice(
      makeLine({
        sizes: { M: "12" },
        imprints: [makeImprint({ technique: "Embroidery", colors: 1 })],
      }),
      0, {}, STANDARD_MARKUP, {},
    );
    expect(r.printCost).toBeCloseTo(12 * 100, 0);
  });

  it("ES6 — string-keyed qty tier ALSO resolves (JSONB returns strings)", () => {
    // Supabase JSONB stores object keys as strings. The function
    // tries `pricing[stitchTier][tier]` (number) and falls back to
    // `[String(tier)]`. This branch only fires when the shop's
    // config came via JSONB round-trip — easy to forget and break.
    loadShopPricingConfig({
      embroidery: {
        enabled: true,
        pricing: { "Under 5K": { "12": 50.00 } }, // string key
        stitchTiers: ["Under 5K"],
        qtyTiers: [12],
      },
    });
    const r = calcLinkedLinePrice(
      makeLine({
        sizes: { M: "12" },
        imprints: [makeImprint({ technique: "Embroidery", colors: 1 })],
      }),
      0, {}, STANDARD_MARKUP, {},
    );
    expect(r.printCost).toBeCloseTo(12 * 50, 0);
  });

  it("ES7 — missing tier pricing → rate = 0 (graceful degradation, not crash)", () => {
    loadShopPricingConfig({
      embroidery: {
        enabled: true,
        pricing: {}, // empty
        stitchTiers: ["Under 5K"],
        qtyTiers: [12],
      },
    });
    const r = calcLinkedLinePrice(
      makeLine({
        sizes: { M: "12" },
        imprints: [makeImprint({ technique: "Embroidery", colors: 1 })],
      }),
      0, {}, STANDARD_MARKUP, {},
    );
    // Should not crash. printCost is 0 but garment cost still applies.
    expect(r).not.toBe(null);
    expect(r.printCost).toBe(0);
    expect(r.gCost).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Linked prints — pooling qty across line items
// ─────────────────────────────────────────────────────────────────────

describe("Linked prints — qty pooling", () => {
  it("LP1 — linked imprint in a SINGLE line item: tier uses that line's qty only", () => {
    // Linked is only meaningful across lines. A single linked imprint
    // should behave the same as unlinked for tier selection.
    const linkedImp = makeImprint({ linked: true, colors: 1 });
    const li = makeLine({
      sizes: { M: "100" },
      imprints: [linkedImp],
    });
    const map = buildLinkedQtyMap([li]);
    const r = calcLinkedLinePrice(li, 0, {}, STANDARD_MARKUP, map);
    expect(r.tier).toBe(100);
  });

  it("LP2 — linked imprint across 3 lines: tier uses combined qty", () => {
    // Combined 25+25+25 = 75 → tier 50 (max tier ≤ 75 in defaults)
    const sharedKey = { technique: "Screen Print", title: "Logo", width: 4, height: 4 };
    const linkedImp = makeImprint({ ...sharedKey, linked: true, colors: 1 });
    const lines = [
      makeLine({ id: "li-1", sizes: { M: "25" }, imprints: [{ ...linkedImp, id: "i-1" }] }),
      makeLine({ id: "li-2", sizes: { L: "25" }, imprints: [{ ...linkedImp, id: "i-2" }] }),
      makeLine({ id: "li-3", sizes: { XL: "25" }, imprints: [{ ...linkedImp, id: "i-3" }] }),
    ];
    const map = buildLinkedQtyMap(lines);
    const r = calcLinkedLinePrice(lines[0], 0, {}, STANDARD_MARKUP, map);
    expect(r.tier).toBe(50);
  });

  it("LP3 — unlinked imprint, even with matching title, uses LINE qty NOT pooled", () => {
    // Defensive: if shop didn't tick the 'linked' checkbox, the qty
    // pool must NOT silently apply. Two identical prints in
    // different orders should price separately.
    const imp = makeImprint({ linked: false, colors: 1, title: "Logo" });
    const lines = [
      makeLine({ id: "li-1", sizes: { M: "25" }, imprints: [imp] }),
      makeLine({ id: "li-2", sizes: { L: "25" }, imprints: [imp] }),
    ];
    const map = buildLinkedQtyMap(lines);
    expect(map).toEqual({}); // no linked prints
    const r = calcLinkedLinePrice(lines[0], 0, {}, STANDARD_MARKUP, map);
    expect(r.tier).toBe(25); // own qty, not 50
  });

  it("LP4 — linked imprint where linkedQtyMap is empty: falls back to line qty", () => {
    // Defensive: caller forgot to call buildLinkedQtyMap. The
    // function should still produce a sane price using the line's
    // own qty, not blow up or return zero.
    const li = makeLine({
      sizes: { M: "25" },
      imprints: [makeImprint({ linked: true, colors: 1 })],
    });
    const r = calcLinkedLinePrice(li, 0, {}, STANDARD_MARKUP, {});
    expect(r.tier).toBe(25);
  });

  it("LP5 — findLinkedPrints returns empty for an empty / null input", () => {
    expect(findLinkedPrints([])).toEqual({});
    expect(findLinkedPrints(null)).toEqual({});
    expect(findLinkedPrints(undefined)).toEqual({});
  });

  it("LP6 — buildLinkedQtyMap aggregates qty correctly across n lines", () => {
    // getPrintKey = "technique|title|width|height" — NOT location
    const key = "Screen Print|Logo|4|4";
    const linkedImp = makeImprint({ linked: true, location: "Front", colors: 1 });
    const lines = [
      makeLine({ id: "a", sizes: { M: "10" }, imprints: [linkedImp] }),
      makeLine({ id: "b", sizes: { L: "20" }, imprints: [linkedImp] }),
      makeLine({ id: "c", sizes: { XL: "30" }, imprints: [linkedImp] }),
    ];
    const map = buildLinkedQtyMap(lines);
    expect(map[key]).toBe(60);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Screen print rate fallback (line 304)
// ─────────────────────────────────────────────────────────────────────

describe("Screen print — rate table fallback", () => {
  it("RT1 — rate from FIRST_PRINT[colors][tier] when both keys exist", () => {
    // Direct hit — the most common path. Sanity-check it still works.
    const li = makeLine({
      sizes: { M: "100" }, // tier 100
      imprints: [makeImprint({ colors: 2 })],
    });
    const r = calcLinkedLinePrice(li, 0, {}, STANDARD_MARKUP, {});
    expect(r.firstPPP).toBe(FIRST_PRINT[2][100]);
  });

  it("RT2 — second imprint pulls from ADDL_PRINT, not FIRST_PRINT", () => {
    const li = makeLine({
      sizes: { M: "100" },
      imprints: [
        makeImprint({ id: "a", location: "Front", colors: 1 }),
        makeImprint({ id: "b", location: "Back",  colors: 1 }),
      ],
    });
    const r = calcLinkedLinePrice(li, 0, {}, STANDARD_MARKUP, {});
    // First imprint costs FIRST_PRINT[1][100] × qty
    // Second imprint costs ADDL_PRINT[1][100] × qty
    const expected = (FIRST_PRINT[1][100] + ADDL_PRINT[1][100]) * 100;
    expect(r.printCost).toBeCloseTo(expected, 1);
  });

  it("RT3 — shop pricing config firstPrint overrides default FIRST_PRINT", () => {
    loadShopPricingConfig({
      firstPrint: {
        1: { 25: 99.00 }, // absurd to easily see
      },
    });
    const li = makeLine({
      sizes: { M: "25" },
      imprints: [makeImprint({ colors: 1 })],
    });
    const r = calcLinkedLinePrice(li, 0, {}, STANDARD_MARKUP, {});
    expect(r.firstPPP).toBe(99.00);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Pricing config — loadShopPricingConfig + getShopPricingConfig
// ─────────────────────────────────────────────────────────────────────

describe("Shop pricing config — load/get cycle", () => {
  it("PC1 — loadShopPricingConfig(null) clears config", () => {
    loadShopPricingConfig({ maxColors: 12 });
    loadShopPricingConfig(null);
    expect(getShopPricingConfig()).toBe(null);
  });

  it("PC2 — loadShopPricingConfig({}) treated as null (empty config)", () => {
    loadShopPricingConfig({});
    expect(getShopPricingConfig()).toBe(null);
  });

  it("PC3 — non-empty config is stored and retrievable", () => {
    const cfg = { maxColors: 12, firstPrint: { 1: { 25: 10.0 } } };
    loadShopPricingConfig(cfg);
    expect(getShopPricingConfig()).toBe(cfg);
  });
});
