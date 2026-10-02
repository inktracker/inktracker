import { describe, it, expect } from "vitest";
import { resolveSupplierProductName, extractDescFromTitle } from "../supplierProductName";

describe("resolveSupplierProductName — one guarded garment-name resolver", () => {
  it("prefers the supplier's clean resolvedTitle", () => {
    expect(resolveSupplierProductName(
      { resolvedTitle: "COMFORT COLORS Heavyweight Ring Spun Tee", raw: { description: "6.1-ounce, 100% US ring spun cotton. Soft-washed, garment-dyed fabric. Top-stitched collar." } },
      { brand: "Comfort Colors", styleNumber: "1717" },
    )).toBe("COMFORT COLORS Heavyweight Ring Spun Tee");
  });

  it("NEVER lets a marketing/spec paragraph become the name (the broker bug)", () => {
    // No clean title, description is a long paragraph → returns "" (caller keeps
    // the prior name / header falls back to the bare style number), never the blurb.
    const paragraph = "6.1-ounce, 100% US ring spun cotton. Soft-washed, garment-dyed fabric. Top-stitched, classic width rib collar. Twill-taped neck and shoulders.";
    expect(resolveSupplierProductName(
      { resolvedTitle: "", raw: { description: paragraph } },
      { brand: "Comfort Colors", styleNumber: "1717" },
    )).toBe("");
  });

  it("uses a SHORT description as the name (S&S stores style name there)", () => {
    expect(resolveSupplierProductName(
      { resolvedTitle: "", raw: { description: "Heavyweight Hoodie" } },
      { brand: "Gildan", styleNumber: "18500" },
    )).toBe("Heavyweight Hoodie");
  });

  it("skips a description that is just the style number or a code", () => {
    expect(resolveSupplierProductName(
      { resolvedTitle: "", raw: { description: "1717" } },
      { styleNumber: "1717" },
    )).toBe("");
    expect(resolveSupplierProductName(
      { resolvedTitle: "", raw: { description: "G500" } },
      { styleNumber: "5000" },
    )).toBe("");
  });

  it("falls back to the middle segment of a 'Brand — Desc — Part' title", () => {
    // No resolvedTitle anywhere and the description is a paragraph → the last
    // resort extracts the middle of raw.title "Brand — Desc — Part".
    expect(resolveSupplierProductName(
      { resolvedTitle: "", raw: { title: "AS Colour — Staple Tee — 5001", description: "A long marketing paragraph that is far too long to be a name and should be ignored entirely here." } },
      { brand: "AS Colour", styleNumber: "5001" },
    )).toBe("Staple Tee");
  });

  it("when resolvedTitle is present it wins outright (no middle-segment extraction)", () => {
    expect(resolveSupplierProductName(
      { raw: { resolvedTitle: "AS Colour — Staple Tee — 5001" } },
      { brand: "AS Colour", styleNumber: "5001" },
    )).toBe("AS Colour — Staple Tee — 5001");
  });

  it("returns '' on null/empty match, never throws", () => {
    expect(() => resolveSupplierProductName(null, {})).not.toThrow();
    expect(resolveSupplierProductName(null, {})).toBe("");
    expect(resolveSupplierProductName({}, {})).toBe("");
  });
});

describe("extractDescFromTitle", () => {
  it("strips brand prefix and part-number suffix", () => {
    expect(extractDescFromTitle("Comfort Colors — Heavyweight Ring Spun Tee — 1717", "Comfort Colors", "1717"))
      .toBe("Heavyweight Ring Spun Tee");
  });
  it("returns '' when nothing but a code / the number is left", () => {
    expect(extractDescFromTitle("Gildan — 5000", "Gildan", "5000")).toBe("");
    expect(extractDescFromTitle("", "X", "Y")).toBe("");
  });
});
