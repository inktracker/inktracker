import { describe, it, expect } from "vitest";
import {
  preferredSupplier,
  preferredSourceToken,
  pickDefaultOption,
  orderBySupplierPreference,
} from "../preference";
import { pickAndNormalize } from "@/lib/wizard/enrichStyle";

const SS = { id: "ss::gildan::1", _supplier: "S&S Activewear", brandName: "Gildan", styleNumber: "5000" };
const SM = { id: "sanmar::gildan::1", _supplier: "SanMar", brandName: "Gildan", styleNumber: "5000" };
const BAYSIDE = { id: "ss::bayside::2", _supplier: "S&S Activewear", brandName: "Bayside", styleNumber: "5000" };

describe("preferredSupplier / preferredSourceToken", () => {
  it("accepts only the two known suppliers", () => {
    expect(preferredSupplier({ defaultSupplier: "SanMar" })).toBe("SanMar");
    expect(preferredSupplier({ defaultSupplier: "S&S Activewear" })).toBe("S&S Activewear");
    expect(preferredSupplier({ defaultSupplier: "AS Colour" })).toBe("");
    expect(preferredSupplier({})).toBe("");
    expect(preferredSupplier(null)).toBe("");
  });

  it("maps to enrichStyle source tokens", () => {
    expect(preferredSourceToken({ defaultSupplier: "SanMar" })).toBe("sanmar");
    expect(preferredSourceToken({ defaultSupplier: "S&S Activewear" })).toBe("ss");
    expect(preferredSourceToken({})).toBe("");
  });
});

describe("pickDefaultOption", () => {
  it("the line's SAVED supplier always wins — even against the preference", () => {
    const picked = pickDefaultOption([SS, SM], { brand: "Gildan", supplier: "SanMar", preferred: "S&S Activewear" });
    expect(picked).toBe(SM);
  });

  it("regression: a reopened SanMar line no longer falls to the first S&S name-match", () => {
    // Old code: options.find(byName) → SS (grab order) regardless of the
    // line's saved supplier. That silently flipped the line's data.
    const picked = pickDefaultOption([SS, SM], { brand: "Gildan", supplier: "SanMar", preferred: "" });
    expect(picked).toBe(SM);
  });

  it("no saved supplier: the shop's preferred supplier auto-selects", () => {
    expect(pickDefaultOption([SS, SM], { brand: "Gildan", preferred: "SanMar" })).toBe(SM);
    expect(pickDefaultOption([SS, SM], { brand: "Gildan", preferred: "S&S Activewear" })).toBe(SS);
  });

  it("no preference: first candidate (legacy S&S-first order)", () => {
    expect(pickDefaultOption([SS, SM], { brand: "Gildan" })).toBe(SS);
  });

  it("no brand + single distinct brand across suppliers: preference resolves it", () => {
    expect(pickDefaultOption([SS, SM], { preferred: "SanMar" })).toBe(SM);
  });

  it("no brand + MULTIPLE brands: never auto-picks (the garment is ambiguous)", () => {
    expect(pickDefaultOption([SS, SM, BAYSIDE], { preferred: "SanMar" })).toBeNull();
  });

  it("single option still auto-applies; empty input returns null", () => {
    expect(pickDefaultOption([BAYSIDE], {})).toBe(BAYSIDE);
    expect(pickDefaultOption([], { preferred: "SanMar" })).toBeNull();
  });

  it("brand set but no name match → null (never substitutes a different garment)", () => {
    expect(pickDefaultOption([SS, SM], { brand: "Comfort Colors", preferred: "SanMar" })).toBeNull();
  });
});

describe("orderBySupplierPreference", () => {
  it("moves the preferred supplier's options to the front, stable otherwise", () => {
    expect(orderBySupplierPreference([SS, BAYSIDE, SM], "SanMar").map((o) => o.id))
      .toEqual([SM.id, SS.id, BAYSIDE.id]);
  });
  it("no preference or no match → untouched", () => {
    expect(orderBySupplierPreference([SS, SM], "")).toEqual([SS, SM]);
    expect(orderBySupplierPreference([BAYSIDE], "SanMar")).toEqual([BAYSIDE]);
  });
});

describe("enrichStyle honors preferredSource", () => {
  const ssData = { matches: [{ brandName: "Gildan", styleNumber: "5000", colors: [], priceMap: {} }] };
  const smData = { matches: [{ brandName: "Gildan", styleNumber: "5000", colors: [], priceMap: {} }] };

  it("brand hint carried by both suppliers: preference decides the source", () => {
    const picked = pickAndNormalize(ssData, null, smData, { brandHint: "Gildan", styleNumber: "5000", preferredSource: "sanmar" });
    expect(picked.enrichedFrom).toBe("sanmar");
  });

  it("no preference keeps the legacy S&S-first order", () => {
    const picked = pickAndNormalize(ssData, null, smData, { brandHint: "Gildan", styleNumber: "5000" });
    expect(picked.enrichedFrom).toBe("ss");
  });

  it("a saved supplierHint pin outranks the preference", () => {
    const picked = pickAndNormalize(ssData, null, smData, { brandHint: "Gildan", styleNumber: "5000", supplierHint: "ss", preferredSource: "sanmar" });
    expect(picked.enrichedFrom).toBe("ss");
  });

  it("no-hint free-form path also prefers the chosen source", () => {
    const picked = pickAndNormalize(ssData, null, smData, { styleNumber: "5000", preferredSource: "sanmar" });
    expect(picked.enrichedFrom).toBe("sanmar");
  });
});
