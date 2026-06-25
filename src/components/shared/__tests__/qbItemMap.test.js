// Per-shop QB item-name mapping. Lets a shop point InkTracker's garment
// categories ("Hoodies & Sweatshirts") at their own existing QuickBooks item
// ("Sweatshirts") so invoices stop creating duplicate items. Non-breaking:
// no mapping = identical to today.

import { describe, it, expect, beforeEach } from "vitest";
import { mapQbItemName, buildQBInvoicePayload, loadShopPricingConfig } from "../pricing";

describe("mapQbItemName", () => {
  const MAP = {
    "Hoodies & Sweatshirts": "Sweatshirts",
    "Customer Supplied": "Customer Supplied Goods",
  };

  it("translates a mapped name to the shop's QB item", () => {
    expect(mapQbItemName("Hoodies & Sweatshirts", MAP)).toBe("Sweatshirts");
    expect(mapQbItemName("Customer Supplied", MAP)).toBe("Customer Supplied Goods");
  });

  it("returns the name unchanged when there's no mapping (non-breaking)", () => {
    expect(mapQbItemName("T-Shirts", MAP)).toBe("T-Shirts");
    expect(mapQbItemName("Setup Fee", MAP)).toBe("Setup Fee");
  });

  it("ignores empty/blank mappings and falls back to the original", () => {
    expect(mapQbItemName("T-Shirts", { "T-Shirts": "" })).toBe("T-Shirts");
    expect(mapQbItemName("T-Shirts", { "T-Shirts": "   " })).toBe("T-Shirts");
  });

  it("tolerates null/undefined inputs", () => {
    expect(mapQbItemName("T-Shirts", null)).toBe("T-Shirts");
    expect(mapQbItemName("T-Shirts", undefined)).toBe("T-Shirts");
    expect(mapQbItemName(null, MAP)).toBe(null);
  });
});

describe("buildQBInvoicePayload applies the shop's qb_item_map", () => {
  const QUOTE = {
    line_items: [{
      brand: "AS Colour", style: "5100", garmentColor: "Black",
      sizes: { M: 10 },
      category: "Hoodies & Sweatshirts",
      _ppp: 25, _lineTotal: 250,
    }],
    tax_rate: 0,
    total: 250,
  };

  beforeEach(() => loadShopPricingConfig(null));

  it("maps the line's itemName to the shop's QB item when configured", () => {
    loadShopPricingConfig({ qb_item_map: { "Hoodies & Sweatshirts": "Sweatshirts" } });
    const payload = buildQBInvoicePayload(QUOTE);
    const garmentLine = payload.lines.find((l) => l.amount === 250);
    expect(garmentLine.itemName).toBe("Sweatshirts");
  });

  it("leaves itemName as the category when no map is set (non-breaking)", () => {
    loadShopPricingConfig({});
    const payload = buildQBInvoicePayload(QUOTE);
    const garmentLine = payload.lines.find((l) => l.amount === 250);
    expect(garmentLine.itemName).toBe("Hoodies & Sweatshirts");
  });
});
