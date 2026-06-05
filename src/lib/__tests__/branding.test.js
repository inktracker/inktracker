import { describe, it, expect } from "vitest";
import { brand, darken, normalizeBrandColor, DEFAULT_BRAND } from "../branding.js";

describe("brand (B)", () => {
  it("B1 — returns the shop's color when valid", () => {
    expect(brand({ brand_color: "#1a1a1a" })).toBe("#1a1a1a");
  });

  it("B2 — normalizes uppercase + whitespace", () => {
    expect(brand({ brand_color: "  #ABCDEF  " })).toBe("#abcdef");
  });

  it("B3 — null shop → default", () => {
    expect(brand(null)).toBe(DEFAULT_BRAND);
  });

  it("B4 — shop with no brand_color → default", () => {
    expect(brand({})).toBe(DEFAULT_BRAND);
    expect(brand({ brand_color: null })).toBe(DEFAULT_BRAND);
    expect(brand({ brand_color: "" })).toBe(DEFAULT_BRAND);
  });

  it("B5 — invalid input → default (defense in depth past the DB CHECK)", () => {
    expect(brand({ brand_color: "tealish" })).toBe(DEFAULT_BRAND);
    expect(brand({ brand_color: "red-600" })).toBe(DEFAULT_BRAND);
    expect(brand({ brand_color: "#fff" })).toBe(DEFAULT_BRAND); // short form not allowed
    expect(brand({ brand_color: 42 })).toBe(DEFAULT_BRAND);
  });
});

describe("darken (D)", () => {
  it("D1 — 25% darker on a saturated mid-tone", () => {
    // teal-600 = #0d9488 → channels (13, 148, 136) × 0.75 ≈ (10, 111, 102) = #0a6f66
    expect(darken("#0d9488", 25)).toBe("#0a6f66");
  });

  it("D2 — 0% returns the same color (rounding-stable)", () => {
    expect(darken("#0d9488", 0)).toBe("#0d9488");
  });

  it("D3 — 100% → black", () => {
    expect(darken("#abcdef", 100)).toBe("#000000");
  });

  it("D4 — invalid input returns input unchanged (caller can detect)", () => {
    expect(darken("not-a-color", 25)).toBe("not-a-color");
    expect(darken(null, 25)).toBe(null);
  });

  it("D5 — default pct is 25", () => {
    expect(darken("#0d9488")).toBe(darken("#0d9488", 25));
  });
});

describe("normalizeBrandColor (NBC)", () => {
  it("NBC1 — lowercases and trims valid hex", () => {
    expect(normalizeBrandColor(" #ABCDEF ")).toBe("#abcdef");
  });

  it("NBC2 — rejects invalid input → null", () => {
    expect(normalizeBrandColor("teal")).toBe(null);
    expect(normalizeBrandColor("#abc")).toBe(null);
    expect(normalizeBrandColor("")).toBe(null);
    expect(normalizeBrandColor(null)).toBe(null);
    expect(normalizeBrandColor(undefined)).toBe(null);
  });
});
