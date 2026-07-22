import { describe, it, expect } from "vitest";
import { SUPPLIERS, SUPPLIER_LIST, supplierCartPermalink, supplierForStoreUrl } from "../suppliers";

describe("SUPPLIERS config", () => {
  it("has NorCal and Ryonet as public-Shopify vendors", () => {
    expect(SUPPLIERS.norcal.storeUrl).toBe("https://norcalsps.com");
    expect(SUPPLIERS.ryonet.storeUrl).toBe("https://www.screenprinting.com");
    expect(SUPPLIER_LIST.map((s) => s.key)).toEqual(["norcal", "ryonet"]);
  });
});

describe("supplierCartPermalink", () => {
  it("builds a store-specific cart permalink", () => {
    expect(supplierCartPermalink("https://www.screenprinting.com", [{ variantId: "123", qty: 2 }]))
      .toBe("https://www.screenprinting.com/cart/123:2");
    expect(supplierCartPermalink("https://norcalsps.com", [{ variantId: "9", qty: 1 }], { utm_source: "inktracker" }))
      .toBe("https://norcalsps.com/cart/9:1?utm_source=inktracker");
  });

  it("drops junk lines and returns null when nothing orderable / no store", () => {
    expect(supplierCartPermalink("https://x.com", [{ variantId: "abc", qty: 1 }])).toBeNull();
    expect(supplierCartPermalink("https://x.com", [])).toBeNull();
    expect(supplierCartPermalink("", [{ variantId: "1", qty: 1 }])).toBeNull();
  });
});

describe("supplierForStoreUrl", () => {
  it("resolves a supplier from a stored product URL's host", () => {
    expect(supplierForStoreUrl("https://norcalsps.com/products/x?variant=1").key).toBe("norcal");
    expect(supplierForStoreUrl("https://www.screenprinting.com/products/y?variant=2").key).toBe("ryonet");
    expect(supplierForStoreUrl("https://someoneelse.com/x")).toBeNull();
    expect(supplierForStoreUrl("")).toBeNull();
  });
});
