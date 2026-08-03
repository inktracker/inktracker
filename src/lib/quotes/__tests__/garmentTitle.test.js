import { describe, it, expect } from "vitest";
import { getCustomGarmentTitle, customGarmentHeader } from "../garmentTitle";
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
