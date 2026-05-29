import { describe, it, expect } from "vitest";
import {
  normalizeSupplierMatch,
  pickAndNormalize,
  isStyleEnriched,
} from "../enrichStyle";

// Fixture — a realistic S&S Activewear ssLookupStyle response for a
// single style. Shape mirrors what the live edge function returns.
const SS_MATCH_BELLA_3001 = {
  id: "ss-bella-3001",
  brandName: "Bella+Canvas",
  styleNumber: "3001",
  description: "Unisex Jersey Short Sleeve Tee",
  styleCategory: "T-Shirts",
  weight: "4.2 oz",
  styleImage: "https://ss.example/3001/black.jpg",
  colors: [
    { colorName: "Black", imageUrl: "https://ss.example/3001/black.jpg", piecePrice: 3.18, weight: "4.2 oz" },
    { colorName: "White", imageUrl: "https://ss.example/3001/white.jpg", piecePrice: 2.95 },
    { colorName: "Navy",  imageUrl: "https://ss.example/3001/navy.jpg",  piecePrice: 3.25 },
  ],
  sizes: ["XS", "S", "M", "L", "XL", "2XL", "3XL"],
};

// Fixture — AS Colour style 5080 (Heavy Tee) — note the collision with
// S&S's Red Kap 5080 (a button-up shirt). The brandHint test below
// verifies we don't pick the wrong supplier on re-sync.
const AC_MATCH_5080 = {
  id: "ac-5080",
  brandName: "AS Colour",
  styleNumber: "5080",
  description: "Heavy Tee",
  weight: "280 GSM",
  colors: [
    { colorName: "Black", imageUrl: "https://ac.example/5080/black.jpg", price: 9.50 },
    { colorName: "White", imageUrl: "https://ac.example/5080/white.jpg", price: 9.50 },
  ],
};

const SS_MATCH_REDKAP_5080 = {
  id: "ss-redkap-5080",
  brandName: "Red Kap",
  styleNumber: "5080",
  description: "Industrial Work Shirt",
  styleCategory: "Workwear",
  styleImage: "https://ss.example/redkap-5080/blue.jpg",
  colors: [
    { colorName: "Blue", imageUrl: "https://ss.example/redkap-5080/blue.jpg", piecePrice: 18.50 },
  ],
};

describe("normalizeSupplierMatch", () => {
  it("captures the cost fields the public wizard needs to include the blank in pricing math", () => {
    const result = normalizeSupplierMatch(SS_MATCH_BELLA_3001, { source: "ss" });

    // garmentCost — flat fallback used by getEffectiveCost when a color
    // isn't in priceMap. Without this, the public wizard charges $0 for
    // the blank.
    expect(result.garmentCost).toBeGreaterThan(0);

    // priceMap — per-color overrides, the primary lookup path. Without
    // this, every color falls back to garmentCost (less accurate).
    expect(result.priceMap).toBeTruthy();
    expect(Object.keys(result.priceMap).length).toBe(3);
    expect(result.priceMap.Black).toEqual({ piecePrice: 3.18 });
    expect(result.priceMap.White).toEqual({ piecePrice: 2.95 });
    expect(result.priceMap.Navy).toEqual({ piecePrice: 3.25 });
  });

  it("captures images + color list", () => {
    const result = normalizeSupplierMatch(SS_MATCH_BELLA_3001, { source: "ss" });
    expect(result.styleImage).toBe("https://ss.example/3001/black.jpg");
    expect(result.colors).toEqual(["Black", "White", "Navy"]);
    expect(result.colorImages.Black).toBe("https://ss.example/3001/black.jpg");
    expect(result.colorImages.White).toBe("https://ss.example/3001/white.jpg");
  });

  it("falls back to colorImages['Black'] when match.styleImage is missing", () => {
    const noStyleImg = { ...SS_MATCH_BELLA_3001, styleImage: undefined };
    const result = normalizeSupplierMatch(noStyleImg, { source: "ss" });
    expect(result.styleImage).toBe("https://ss.example/3001/black.jpg");
  });

  it("handles AS Colour's `price` field (instead of S&S's `piecePrice`)", () => {
    const result = normalizeSupplierMatch(AC_MATCH_5080, { source: "ac" });
    expect(result.priceMap.Black).toEqual({ piecePrice: 9.50 });
    expect(result.garmentCost).toBe(9.50);
  });

  it("preserves the caller's brand hint (prevents supplier-collision overwrites)", () => {
    const result = normalizeSupplierMatch(AC_MATCH_5080, {
      source: "ac",
      brandHint: "AS Colour",
    });
    expect(result.brand).toBe("AS Colour");
  });

  it("falls back to the match's brandName when no hint given", () => {
    const result = normalizeSupplierMatch(SS_MATCH_BELLA_3001, { source: "ss" });
    expect(result.brand).toBe("Bella+Canvas");
  });

  it("returns null for a falsy match", () => {
    expect(normalizeSupplierMatch(null, { source: "ss" })).toBeNull();
    expect(normalizeSupplierMatch(undefined, { source: "ss" })).toBeNull();
  });

  it("returns an empty priceMap (not null) when colors lack prices", () => {
    const noPrices = {
      ...SS_MATCH_BELLA_3001,
      colors: [
        { colorName: "Black", imageUrl: "https://ss.example/3001/black.jpg" }, // no piecePrice
      ],
    };
    const result = normalizeSupplierMatch(noPrices, { source: "ss" });
    expect(result.priceMap).toEqual({});
    // Empty priceMap is fine — garmentCost still resolves from the match itself
  });

  it("stamps provenance fields (enrichedAt, enrichedFrom)", () => {
    const before = Date.now();
    const result = normalizeSupplierMatch(SS_MATCH_BELLA_3001, { source: "ss" });
    expect(result.enrichedFrom).toBe("ss");
    expect(new Date(result.enrichedAt).getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe("pickAndNormalize — supplier disambiguation", () => {
  it("picks AS Colour when brand hint includes 'AS Colour' (style number collides on S&S)", () => {
    // This is the real bug from production: shop had "AS Colour 5080" but
    // a sync without the brand hint pulled S&S's Red Kap 5080 instead.
    const result = pickAndNormalize(
      { matches: [SS_MATCH_REDKAP_5080] },
      { matches: [AC_MATCH_5080] },
      { brandHint: "AS Colour" }
    );

    expect(result.brand).toBe("AS Colour");
    expect(result.enrichedFrom).toBe("ac");
    expect(result.description).toBe("Heavy Tee");
    // Critical assertion — this is the value that was getting clobbered:
    expect(result.priceMap.Black.piecePrice).toBe(9.50);
  });

  it("picks the matching brand from S&S when brand hint matches", () => {
    const result = pickAndNormalize(
      { matches: [SS_MATCH_REDKAP_5080, SS_MATCH_BELLA_3001] },
      null,
      { brandHint: "Bella+Canvas" }
    );
    expect(result.brand).toBe("Bella+Canvas");
    expect(result.enrichedFrom).toBe("ss");
  });

  it("falls back to the first match when no brand hint is given", () => {
    const result = pickAndNormalize(
      { matches: [SS_MATCH_BELLA_3001] },
      { matches: [AC_MATCH_5080] },
      {}
    );
    expect(result.enrichedFrom).toBe("ss"); // ss listed first
  });

  it("falls back to AS Colour when S&S has no matches", () => {
    const result = pickAndNormalize(null, { matches: [AC_MATCH_5080] }, {});
    expect(result.enrichedFrom).toBe("ac");
  });

  it("returns null when neither supplier knows the style", () => {
    expect(pickAndNormalize(null, null, {})).toBeNull();
    expect(pickAndNormalize({ matches: [] }, { matches: [] }, {})).toBeNull();
  });
});

describe("isStyleEnriched — predicate", () => {
  it("requires styleImage, colorImages, AND cost data (the bug the user caught)", () => {
    // The exact failure mode from production:
    // photos were synced, cost was not, so save-time auto-enrich skipped
    // it. Now the predicate requires cost too.
    const photoOnly = {
      styleImage: "https://ss.example/3001/black.jpg",
      colorImages: { Black: "https://ss.example/3001/black.jpg" },
      // no garmentCost, no priceMap
    };
    expect(isStyleEnriched(photoOnly)).toBe(false);
  });

  it("accepts a style with garmentCost > 0 (flat-price fallback)", () => {
    expect(
      isStyleEnriched({
        styleImage: "x",
        colorImages: { Black: "x" },
        garmentCost: 5.5,
      })
    ).toBe(true);
  });

  it("accepts a style with priceMap entries (per-color prices)", () => {
    expect(
      isStyleEnriched({
        styleImage: "x",
        colorImages: { Black: "x" },
        priceMap: { Black: { piecePrice: 5.5 } },
      })
    ).toBe(true);
  });

  it("rejects a style with garmentCost = 0 and empty priceMap", () => {
    expect(
      isStyleEnriched({
        styleImage: "x",
        colorImages: { Black: "x" },
        garmentCost: 0,
        priceMap: {},
      })
    ).toBe(false);
  });

  it("rejects a falsy input gracefully", () => {
    expect(isStyleEnriched(null)).toBe(false);
    expect(isStyleEnriched(undefined)).toBe(false);
    expect(isStyleEnriched({})).toBe(false);
  });
});
