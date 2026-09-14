import { describe, it, expect } from "vitest";
import { buildSsPoItems } from "../buildSsPoItems";

describe("buildSsPoItems", () => {
  it("builds canonical items per size with a stable guessed sku, merging duplicates", () => {
    const items = buildSsPoItems([
      { styleNumber: "3600", color: "Black", sizes: { M: 5, L: 2 }, unitCost: 3 },
      { styleNumber: "3600", color: "Black", sizes: { M: 4 }, unitCost: 3 }, // M merges → 9
    ]);
    const m = items.find((i) => i.size === "M");
    expect(m).toMatchObject({ sku: "3600-BLACK-M", styleCode: "3600", color: "Black", size: "M", quantity: 9, unitPrice: 3, warehouse: "" });
    expect(items.find((i) => i.size === "L").quantity).toBe(2);
  });

  it("skips lines with no style and zero-qty sizes", () => {
    expect(buildSsPoItems([{ color: "Black", sizes: { M: 5 } }])).toEqual([]);
    expect(buildSsPoItems([{ styleNumber: "PC61", color: "Navy", sizes: { S: 0 } }])).toEqual([]);
  });

  it("handles a non-numeric style (server resolves via explicit style, not the sku)", () => {
    const items = buildSsPoItems([{ styleNumber: "PC61", color: "Navy Blue", sizes: { XL: 3 } }]);
    expect(items[0]).toMatchObject({ styleCode: "PC61", color: "Navy Blue", size: "XL", quantity: 3, sku: "PC61-NAVYBLUE-XL" });
  });
});
