import { describe, it, expect } from "vitest";
import {
  normalizeNorcalProducts,
  norcalCartPermalink,
  norcalCategory,
  norcalSubcategories,
  NORCAL_CATEGORIES,
  NORCAL_STORE_URL_DEFAULT,
} from "../norcal.ts";

// A trimmed sample matching the real norcalsps.com /products.json shape
// (verified live 2026-07-21).
const SAMPLE = [
  {
    id: 7736980340834,
    title: "PERMASET AQUA STANDARD WHITE",
    handle: "permaset-aqua-fabric-ink-white",
    vendor: "NorCal Screen Print Supply",
    product_type: "Ink",
    images: [{ src: "https://cdn.shopify.com/s/files/1/prod.png?v=1" }],
    variants: [
      { id: 43077280464994, title: "300ml", option1: "300ml", sku: "PA-WHT-300", price: "32.95", available: true, featured_image: null },
      { id: 43077280498765, title: "1L", option1: "1L", sku: "PA-WHT-1L", price: "79.95", available: false, featured_image: { src: "https://cdn.shopify.com/s/files/1/var.png?v=2" } },
    ],
  },
  {
    id: 111,
    title: "No Variants Product",
    handle: "empty",
    vendor: "NorCal",
    product_type: "",
    images: [],
    variants: [],
  },
];

describe("normalizeNorcalProducts", () => {
  it("flattens one row per variant with the fields we persist", () => {
    const rows = normalizeNorcalProducts(SAMPLE);
    expect(rows).toHaveLength(2); // the empty-variants product contributes nothing
    const [white300, white1L] = rows;
    expect(white300).toMatchObject({
      variantId: "43077280464994",
      productId: "7736980340834",
      title: "PERMASET AQUA STANDARD WHITE",
      size: "300ml",
      sku: "PA-WHT-300",
      price: 32.95,
      available: true,
      productType: "Ink",
    });
    // price is coerced to a number (products.json gives a string)
    expect(typeof white300.price).toBe("number");
    // available flag preserved per variant
    expect(white1L.available).toBe(false);
    expect(white1L.price).toBe(79.95);
  });

  it("prefers the variant's own image, falling back to the product image", () => {
    const [white300, white1L] = normalizeNorcalProducts(SAMPLE);
    expect(white300.image).toBe("https://cdn.shopify.com/s/files/1/prod.png?v=1"); // no variant image → product image
    expect(white1L.image).toBe("https://cdn.shopify.com/s/files/1/var.png?v=2");   // variant image wins
  });

  it("builds a product URL with the variant selected, honoring the store domain", () => {
    const [white300] = normalizeNorcalProducts(SAMPLE, "https://norcalsps.com/");
    expect(white300.url).toBe("https://norcalsps.com/products/permaset-aqua-fabric-ink-white?variant=43077280464994");
  });

  it("is tolerant of junk input", () => {
    expect(normalizeNorcalProducts(null)).toEqual([]);
    expect(normalizeNorcalProducts(undefined)).toEqual([]);
    expect(normalizeNorcalProducts([{ variants: [{ id: null }] }])).toEqual([]); // variant with no id skipped
  });

  it("tags each variant with a browsable category bucket", () => {
    const [white300] = normalizeNorcalProducts(SAMPLE);
    expect(white300.category).toBe("Inks"); // product_type "Ink" → Inks bucket
  });

  it("drops Shopify options-app hidden helper products", () => {
    const rows = normalizeNorcalProducts([
      { id: 1, title: "Hidden", handle: "h", product_type: "OPTIONS_HIDDEN_PRODUCT", variants: [{ id: 9, price: "1" }] },
      ...SAMPLE,
    ]);
    expect(rows.every((r) => r.variantId !== "9")).toBe(true);
  });
});

describe("norcalCategory", () => {
  it("maps NorCal's product_type to categories mirroring their store nav", () => {
    expect(norcalCategory("Plastisol Inks")).toBe("Inks");
    expect(norcalCategory("Waterbase Inks")).toBe("Inks");
    expect(norcalCategory("Discharge Inks")).toBe("Inks");
    expect(norcalCategory("Aluminum Screens")).toBe("Screens");
    expect(norcalCategory("Chemicals")).toBe("Chemicals");
    expect(norcalCategory("Emulsion")).toBe("Chemicals");
    expect(norcalCategory("Adhesives")).toBe("Chemicals");
    expect(norcalCategory("Equipment")).toBe("Equipment");
    expect(norcalCategory("Heat Press")).toBe("Equipment");
    expect(norcalCategory("Flash Dryer")).toBe("Equipment");
    // NorCal surfaces Squeegees and Tape as their own categories — so do we.
    expect(norcalCategory("Squeegee")).toBe("Squeegees");
    expect(norcalCategory("Tape")).toBe("Tape");
    expect(norcalCategory("Supplies")).toBe("Supplies");
  });

  it("does NOT mis-bucket 'Screen Printing Kit' as Screens", () => {
    expect(norcalCategory("Screen Printing Kit")).toBe("Equipment");
  });

  it("falls back to Supplies (their misc catch-all) for empty/unknown types", () => {
    expect(norcalCategory("")).toBe("Supplies");
    expect(norcalCategory(null)).toBe("Supplies");
    expect(norcalCategory("Service")).toBe("Supplies");
    expect(NORCAL_CATEGORIES).not.toContain("Other");
  });
});

describe("norcalSubcategories", () => {
  it("returns distinct product_types with counts, most-common first", () => {
    const variants = [
      { productType: "Plastisol Inks" },
      { productType: "Plastisol Inks" },
      { productType: "Waterbase Inks" },
      { productType: "Discharge Inks" },
      { productType: "Plastisol Inks" },
    ];
    expect(norcalSubcategories(variants)).toEqual([
      { type: "Plastisol Inks", count: 3 },
      { type: "Discharge Inks", count: 1 },
      { type: "Waterbase Inks", count: 1 },
    ]);
  });

  it("skips empty types and tolerates junk", () => {
    expect(norcalSubcategories([{ productType: "" }, { productType: "  " }, {}])).toEqual([]);
    expect(norcalSubcategories(null)).toEqual([]);
  });
});

describe("norcalCartPermalink", () => {
  it("builds the Shopify cart permalink format verified live", () => {
    const url = norcalCartPermalink(
      [{ variantId: "43077280464994", qty: 2 }, { variantId: "43077280498765", qty: 1 }],
      "https://norcalsps.com",
    );
    expect(url).toBe("https://norcalsps.com/cart/43077280464994:2,43077280498765:1");
  });

  it("drops non-numeric variant ids and non-positive quantities", () => {
    const url = norcalCartPermalink([
      { variantId: "abc", qty: 3 },      // non-numeric → dropped
      { variantId: "123", qty: 0 },      // zero qty → dropped
      { variantId: "456", qty: 2 },      // kept
    ]);
    expect(url).toBe(`${NORCAL_STORE_URL_DEFAULT}/cart/456:2`);
  });

  it("returns null when nothing is orderable", () => {
    expect(norcalCartPermalink([])).toBeNull();
    expect(norcalCartPermalink([{ variantId: "x", qty: 1 }])).toBeNull();
  });

  it("appends attribution params as a query string", () => {
    const url = norcalCartPermalink([{ variantId: "456", qty: 1 }], "https://norcalsps.com", { ref: "inktracker" });
    expect(url).toBe("https://norcalsps.com/cart/456:1?ref=inktracker");
  });
});
