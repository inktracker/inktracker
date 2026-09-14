import { describe, it, expect } from "vitest";
import { matchAcVariantsForNeed, resolveAcNeedsToItems } from "../resolveAcPoItems";

// An acLookupStyle product for style 5030 in Black + White, S/M/L, with
// multi-warehouse stock so warehouse routing is exercised.
const product = {
  styleCode: "5030",
  variants: [
    { sku: "5030-BLK-S", colour: "Black", size: "S", price: 9 },
    { sku: "5030-BLK-M", colour: "Black", size: "M", price: 9 },
    { sku: "5030-WHT-S", colour: "White", size: "S", price: 9 },
  ],
  stockBySkuWarehouse: {
    "5030-BLK-S": { CA: 0, NC: 40 }, // CA out → routes to NC
    "5030-BLK-M": { CA: 100, NC: 5 },
  },
};

describe("matchAcVariantsForNeed", () => {
  it("resolves matching colour+size to a canonical PO item, routing warehouse by stock", () => {
    const need = { styleNumber: "5030", color: "BLACK", sizes: { S: 3, M: 6 }, unitCost: 9 };
    const { items, unresolved } = matchAcVariantsForNeed(need, product);
    expect(unresolved).toEqual([]);
    expect(items).toEqual([
      { sku: "5030-BLK-S", styleCode: "5030", color: "Black", size: "S", quantity: 3, unitPrice: 9, warehouse: "NC" },
      { sku: "5030-BLK-M", styleCode: "5030", color: "Black", size: "M", quantity: 6, unitPrice: 9, warehouse: "CA" },
    ]);
  });

  it("flags a size with no matching variant as unresolved — never guesses a SKU", () => {
    const need = { styleNumber: "5030", color: "BLACK", sizes: { S: 2, XL: 4 } };
    const { items, unresolved } = matchAcVariantsForNeed(need, product);
    expect(items.map((i) => i.size)).toEqual(["S"]);
    expect(unresolved).toEqual([{ style: "5030", color: "BLACK", size: "XL", qty: 4 }]);
  });

  it("flags the whole line when the colour isn't stocked", () => {
    const need = { styleNumber: "5030", color: "FOREST", sizes: { S: 5 } };
    const { items, unresolved } = matchAcVariantsForNeed(need, product);
    expect(items).toEqual([]);
    expect(unresolved).toHaveLength(1);
  });

  it("normalizes case/whitespace on colour and size", () => {
    const need = { styleNumber: "5030", color: "  black ", sizes: { " s ": 1 } };
    const { items } = matchAcVariantsForNeed(need, product);
    expect(items[0]?.sku).toBe("5030-BLK-S");
  });

  it("skips zero-qty sizes", () => {
    const { items, unresolved } = matchAcVariantsForNeed({ styleNumber: "5030", color: "BLACK", sizes: { S: 0 } }, product);
    expect(items).toEqual([]);
    expect(unresolved).toEqual([]);
  });
});

describe("resolveAcNeedsToItems", () => {
  const lookup = async (style) => (style === "5030" ? product : null);

  it("resolves multiple lines and merges the SAME variant across lines by sku+warehouse", async () => {
    const lines = [
      { styleNumber: "5030", color: "BLACK", sizes: { S: 3 }, unitCost: 9 },
      { styleNumber: "5030", color: "BLACK", sizes: { S: 2, M: 4 }, unitCost: 9 }, // S overlaps → merges to 5
    ];
    const { items, unresolved, lookupErrors } = await resolveAcNeedsToItems(lines, { lookup });
    expect(lookupErrors).toEqual([]);
    expect(unresolved).toEqual([]);
    const s = items.find((i) => i.sku === "5030-BLK-S");
    expect(s.quantity).toBe(5); // 3 + 2 merged
    expect(items.find((i) => i.sku === "5030-BLK-M").quantity).toBe(4);
  });

  it("caches the lookup per style (one call for repeated styles)", async () => {
    let calls = 0;
    const counting = async (style) => { calls++; return style === "5030" ? product : null; };
    await resolveAcNeedsToItems(
      [
        { styleNumber: "5030", color: "BLACK", sizes: { S: 1 } },
        { styleNumber: "5030", color: "WHITE", sizes: { S: 1 } },
      ],
      { lookup: counting },
    );
    expect(calls).toBe(1);
  });

  it("records a lookup error and marks the whole line unresolved when a style can't be found", async () => {
    const { items, unresolved, lookupErrors } = await resolveAcNeedsToItems(
      [{ styleNumber: "9999", color: "BLACK", sizes: { S: 2 } }],
      { lookup: async () => { throw new Error("Style not found"); } },
    );
    expect(items).toEqual([]);
    expect(unresolved).toEqual([{ style: "9999", color: "BLACK", size: "S", qty: 2 }]);
    expect(lookupErrors).toEqual([{ style: "9999", message: "Style not found" }]);
  });

  it("a null product (not found, no throw) also marks the line unresolved", async () => {
    const { unresolved, lookupErrors } = await resolveAcNeedsToItems(
      [{ styleNumber: "0000", color: "BLACK", sizes: { M: 3 } }],
      { lookup: async () => null },
    );
    expect(unresolved).toEqual([{ style: "0000", color: "BLACK", size: "M", qty: 3 }]);
    expect(lookupErrors).toEqual([]);
  });
});
