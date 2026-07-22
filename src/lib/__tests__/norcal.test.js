import { describe, it, expect } from "vitest";
import { norcalCartPermalink, NORCAL_STORE_URL } from "../norcal";

describe("norcalCartPermalink (client)", () => {
  it("builds the verified Shopify cart permalink", () => {
    const url = norcalCartPermalink([
      { variantId: "43077280464994", qty: 2 },
      { variantId: "43077280498765", qty: 1 },
    ]);
    expect(url).toBe(`${NORCAL_STORE_URL}/cart/43077280464994:2,43077280498765:1`);
  });

  it("drops non-numeric ids and non-positive quantities", () => {
    expect(norcalCartPermalink([
      { variantId: "abc", qty: 3 },
      { variantId: "123", qty: 0 },
      { variantId: "456", qty: 2 },
    ])).toBe(`${NORCAL_STORE_URL}/cart/456:2`);
  });

  it("returns null when nothing is orderable", () => {
    expect(norcalCartPermalink([])).toBeNull();
    expect(norcalCartPermalink([{ variantId: "x", qty: 1 }])).toBeNull();
  });

  it("appends attribution params", () => {
    expect(norcalCartPermalink([{ variantId: "456", qty: 1 }], { utm_source: "inktracker" }))
      .toBe(`${NORCAL_STORE_URL}/cart/456:1?utm_source=inktracker`);
  });
});
