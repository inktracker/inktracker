import { describe, it, expect } from "vitest";
import { getCustomGarmentTitle, customGarmentHeader, customTitleAfterStyleChange } from "../garmentTitle";
import {
  applySelectedMatch as applyShop,
} from "../../../components/quotes/LineItemEditor";
import {
  applySelectedMatch as applyBroker,
} from "../../../components/broker/BrokerLineItemEditor";

// Truman's 31-069 (2026-08-03): shop sells an OTTO cap numbered 31-069;
// S&S also has a 31-069 (women's fleece crewneck). The style-blur lookup
// stamped S&S's name over every naming field and there was NO field for
// the shop's own title. customTitle is that field — it must win on every
// header surface and survive every lookup.

describe("customGarmentHeader", () => {
  it("wins when set", () => {
    expect(customGarmentHeader({ customTitle: "Otto Cap 5 Panel Mid Profile" }, "31-069"))
      .toBe("31-069 - Otto Cap 5 Panel Mid Profile");
  });

  it("returns null when unset so callers fall through to resolved fields", () => {
    expect(customGarmentHeader({}, "31-069")).toBeNull();
    expect(customGarmentHeader({ customTitle: "   " }, "31-069")).toBeNull();
    expect(customGarmentHeader(null, "31-069")).toBeNull();
  });

  it("no number → title alone; title === number → number once (no '31-069 - 31-069')", () => {
    expect(customGarmentHeader({ customTitle: "My Cap" }, "")).toBe("My Cap");
    expect(customGarmentHeader({ customTitle: "31-069" }, "31-069")).toBe("31-069");
  });

  it("getCustomGarmentTitle trims and rejects non-strings", () => {
    expect(getCustomGarmentTitle({ customTitle: "  X  " })).toBe("X");
    expect(getCustomGarmentTitle({ customTitle: 42 })).toBe("");
    expect(getCustomGarmentTitle(undefined)).toBe("");
  });
});

// The colliding S&S match, as the supplier pickers deliver it.
const CROSS_SUPPLIER_MATCH = {
  styleNumber: "31-069",
  brandName: "Independent Trading Co.",
  supplier: "S&S Activewear",
  resolvedTitle: "Women's Reflex Fleece Crewneck Sweatshirt",
  colors: [],
  raw: {},
};

describe("supplier lookups never clobber customTitle", () => {
  const li = {
    id: "x",
    style: "31-069",
    customTitle: "Otto Cap 5 Panel Mid Profile",
    sizes: {},
  };

  it("shop editor applySelectedMatch preserves it", () => {
    const out = applyShop(li, CROSS_SUPPLIER_MATCH);
    expect(out.customTitle).toBe("Otto Cap 5 Panel Mid Profile");
    // ...even while the resolved fields get the supplier's (wrong) name —
    // the header layer is what keeps the custom title on top.
    expect(out.productName).toBe("Women's Reflex Fleece Crewneck Sweatshirt");
  });

  it("broker editor applySelectedMatch preserves it", () => {
    const out = applyBroker(li, CROSS_SUPPLIER_MATCH);
    expect(out.customTitle).toBe("Otto Cap 5 Panel Mid Profile");
  });
});

// Joe, 2026-09-28: duplicated a garment line, switched the copy to AS Colour
// 5030, and the header still read "5030 - HEAVY FADED MINUS TEE" — the title
// typed for the ORIGINAL garment. Duplicate copies customTitle, and rule 1
// then lets that stale text beat the correct supplier name everywhere it
// matters: quote, PDF, customer page, QuickBooks line description.
describe("customTitleAfterStyleChange (rule 4 — a title names ONE garment)", () => {
  const dup = { style: "5082", customTitle: "HEAVY FADED MINUS TEE" };

  it("drops the inherited title when the copy is pointed at a different style", () => {
    expect(customTitleAfterStyleChange(dup, "5030")).toBe("");
    // …so the header falls back to the resolved supplier name.
    const relabelled = { ...dup, style: "5030", customTitle: customTitleAfterStyleChange(dup, "5030") };
    expect(customGarmentHeader(relabelled, "5030")).toBeNull();
  });

  it("keeps the title while the style is unchanged (case/whitespace only)", () => {
    expect(customTitleAfterStyleChange(dup, "5082")).toBe("HEAVY FADED MINUS TEE");
    expect(customTitleAfterStyleChange({ style: "pc61", customTitle: "My Tee" }, "PC61 ")).toBe("My Tee");
  });

  it("keeps the title when the field is BLANKED to re-search — rule 3 stands", () => {
    expect(customTitleAfterStyleChange(dup, "")).toBe("HEAVY FADED MINUS TEE");
    expect(customTitleAfterStyleChange(dup, "   ")).toBe("HEAVY FADED MINUS TEE");
  });

  it("Truman's 31-069 keeps its title — he never retypes the number", () => {
    const otto = { style: "31-069", customTitle: "Otto Cap 5 Panel Mid Profile" };
    expect(customTitleAfterStyleChange(otto, "31-069")).toBe("Otto Cap 5 Panel Mid Profile");
  });

  it("no title set → stays empty; junk input never throws", () => {
    expect(customTitleAfterStyleChange({ style: "5082" }, "5030")).toBe("");
    expect(customTitleAfterStyleChange(null, "5030")).toBe("");
    expect(customTitleAfterStyleChange({ customTitle: "X" }, "5030")).toBe("");
  });
});

import { isSpecDump, brandStyleHeader } from "../garmentTitle";

describe("isSpecDump — reject marketing paragraphs as garment names", () => {
  it("true for the AS Colour / Comfort Colors blurbs", () => {
    expect(isSpecDump("The timeless AS Colour Classic Tee, ideal for printing with its regular fit and heavy weight 6.5 oz, 22-singles 100% combed cotton.")).toBe(true);
    expect(isSpecDump("6.1-ounce, 100% US ring spun cotton Soft-washed, garment-dyed fabric Top-stitched")).toBe(true);
  });
  it("false for a real short product name", () => {
    expect(isSpecDump("Unisex Heavyweight Hooded Sweatshirt")).toBe(false);
    expect(isSpecDump("Garment-Dyed Heavyweight Tee")).toBe(false);
    expect(isSpecDump("")).toBe(false);
  });
  it("catches a short-but-sentencey or spec'd string", () => {
    expect(isSpecDump("Soft tee. Great print.")).toBe(true); // two sentences
    expect(isSpecDump("Heavy 6.5 oz tee")).toBe(true);        // spec marker
  });
});

describe("brandStyleHeader", () => {
  it("brand + number", () => {
    expect(brandStyleHeader("Comfort Colors", "1717")).toBe("Comfort Colors 1717");
  });
  it("falls back to whichever half exists", () => {
    expect(brandStyleHeader("", "5026")).toBe("5026");
    expect(brandStyleHeader("AS Colour", "")).toBe("AS Colour");
    expect(brandStyleHeader("", "")).toBe("Garment");
  });
});

import { categoryLabel, brandStyleCategoryHeader } from "../garmentTitle";

describe("categoryLabel / brandStyleCategoryHeader", () => {
  it("singularizes simple plural categories", () => {
    expect(categoryLabel("T-Shirts")).toBe("T-Shirt");
    expect(categoryLabel("Tanks")).toBe("Tank");
    expect(categoryLabel("Polos")).toBe("Polo");
  });
  it("leaves compound categories alone", () => {
    expect(categoryLabel("Hoodies & Sweatshirts")).toBe("Hoodies & Sweatshirts");
    expect(categoryLabel("")).toBe("");
  });
  it("builds 'Brand Style — Category', dropping missing halves", () => {
    expect(brandStyleCategoryHeader("Comfort Colors", "1717", "T-Shirts")).toBe("Comfort Colors 1717 — T-Shirt");
    expect(brandStyleCategoryHeader("Comfort Colors", "1717", "")).toBe("Comfort Colors 1717");
    expect(brandStyleCategoryHeader("", "5026", "T-Shirts")).toBe("5026 — T-Shirt");
  });
});
