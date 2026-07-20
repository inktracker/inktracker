import { describe, it, expect } from "vitest";
import { applySelectedMatch as applyShop } from "../LineItemEditor";
import { applySelectedMatch as applyBroker } from "../../broker/BrokerLineItemEditor";

// Regression tests for the brand-ternary bug (SanMar integration):
// `supplier` used to be INFERRED from brandName —
//   brandName === "AS Colour" ? "AS Colour" : "S&S Activewear"
// — so every SanMar item (Gildan, Bella+Canvas, District… all brands
// S&S also carries) persisted as "S&S Activewear", and reorders/restock
// would route to the wrong vendor. Supplier identity now comes ONLY
// from the fetch-time `_supplier` tag; an untagged match persists ""
// (unknown), never a guessed default.

const BASE_LI = { id: "li-1", style: "5000", brand: "", sizes: {} };

function match(overrides = {}) {
  return {
    id: 9001,
    brandName: "Gildan",
    styleNumber: "5000",
    description: "Heavy Cotton T-Shirt",
    styleCategory: "T-Shirts",
    colors: [],
    inventoryMap: {},
    priceMap: {},
    sizePriceMap: {},
    raw: {},
    ...overrides,
  };
}

describe.each([
  ["LineItemEditor", applyShop],
  ["BrokerLineItemEditor", applyBroker],
])("%s applySelectedMatch — supplier persistence", (_label, applySelectedMatch) => {
  it("persists supplier === 'SanMar' when the SanMar-tagged option is selected", () => {
    const li = applySelectedMatch(BASE_LI, match({ _supplier: "SanMar" }));
    expect(li.supplier).toBe("SanMar");
  });

  it("persists the S&S tag when the S&S option is selected (same brand)", () => {
    const li = applySelectedMatch(BASE_LI, match({ _supplier: "S&S Activewear" }));
    expect(li.supplier).toBe("S&S Activewear");
  });

  it("an UNTAGGED match persists unknown ('') — never a silent S&S default", () => {
    const li = applySelectedMatch(BASE_LI, match());
    expect(li.supplier).toBe("");
  });

  it("never infers supplier from brandName — 'AS Colour' brand without a tag stays unknown", () => {
    const li = applySelectedMatch(
      BASE_LI,
      match({ brandName: "AS Colour", raw: { brandName: "AS Colour" } })
    );
    expect(li.supplier).toBe("");
  });
});
