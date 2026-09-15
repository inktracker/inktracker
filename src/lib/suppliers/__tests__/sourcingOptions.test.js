import { describe, it, expect } from "vitest";
import {
  candidateSuppliers,
  extractVariant,
  comparePoSuppliers,
  savingsVsCurrent,
  repriceItemsForSupplier,
  normalizeAddItemsProduct,
} from "../sourcingOptions";

describe("candidateSuppliers", () => {
  it("pairs S&S and SanMar (shared brand style numbers)", () => {
    expect(candidateSuppliers("S&S Activewear").sort()).toEqual(["S&S Activewear", "SanMar"]);
    expect(candidateSuppliers("SanMar").sort()).toEqual(["S&S Activewear", "SanMar"]);
  });
  it("AS Colour only sources from itself", () => {
    expect(candidateSuppliers("AS Colour")).toEqual(["AS Colour"]);
  });
});

describe("extractVariant", () => {
  const ssMatch = {
    piecePrice: 3.5,
    priceMap: { White: { piecePrice: 3.84 } },
    sizePriceMap: { White: { M: 3.84, "2XL": 5.5 } },
    inventoryMap: { White: { M: 420, "2XL": 12 } },
  };
  it("prefers exact per-size price + stock, color case-insensitive", () => {
    expect(extractVariant(ssMatch, null, "white", "M")).toMatchObject({ unitPrice: 3.84, onSale: false, stock: 420 });
    expect(extractVariant(ssMatch, null, "White", "2XL")).toMatchObject({ unitPrice: 5.5, stock: 12 });
  });
  it("reads AS Colour per-variant price from product.variants[]", () => {
    const product = { variants: [{ colour: "White", size: "M", price: 6.25 }] };
    expect(extractVariant({ priceMap: {} }, product, "White", "M").unitPrice).toBe(6.25);
  });
  it("stock null (unknown) when inventory absent, not 0", () => {
    expect(extractVariant({ priceMap: { White: { piecePrice: 3 } } }, null, "White", "M").stock).toBeNull();
  });

  it("returns per-warehouse breakdown sorted most-stock-first", () => {
    const m = {
      priceMap: { White: { piecePrice: 4 } },
      warehouseMap: { White: { M: [{ code: "GA", qty: 200 }, { code: "TX", qty: 500 }, { code: "NV", qty: 0 }] } },
    };
    expect(extractVariant(m, null, "White", "M").warehouses).toEqual([
      { code: "TX", qty: 500 },
      { code: "GA", qty: 200 },
    ]); // NV (0) dropped, sorted desc
  });

  it("warehouses is [] when the supplier gives none", () => {
    expect(extractVariant({ priceMap: { White: { piecePrice: 4 } } }, null, "White", "M").warehouses).toEqual([]);
  });

  it("uses the per-SIZE sale price when one is running (below standard)", () => {
    const m = {
      priceMap: { White: { piecePrice: 3.84 } },
      sizePriceMap: { White: { M: 3.84 } },
      colors: [{ colorName: "White", sizeSalePrices: { M: 2.99 } }],
    };
    expect(extractVariant(m, null, "White", "M")).toMatchObject({ unitPrice: 2.99, standardPrice: 3.84, onSale: true });
  });

  it("uses the per-COLOR sale price when no per-size sale is given", () => {
    const m = { priceMap: { White: { piecePrice: 4, salePrice: 3.5 } } };
    expect(extractVariant(m, null, "White", "M")).toMatchObject({ unitPrice: 3.5, standardPrice: 4, onSale: true });
  });

  it("ignores a 'sale' price that isn't actually lower than standard", () => {
    const m = { priceMap: { White: { piecePrice: 4, salePrice: 4.5 } } };
    expect(extractVariant(m, null, "White", "M")).toMatchObject({ unitPrice: 4, onSale: false });
  });

  it("does NOT apply the color-level sale to a size that has its own (higher) standard price", () => {
    // Real promo shape: S–XL on sale, 2XL full price. priceMap.salePrice is the
    // cheapest-size sale (3.50); 2XL has a per-size standard (5.50) and NO
    // per-size sale entry → must price at 5.50, not 3.50.
    const m = {
      priceMap: { White: { piecePrice: 3.84, salePrice: 3.5 } },
      sizePriceMap: { White: { M: 3.84, "2XL": 5.5 } },
      colors: [{ colorName: "White", sizeSalePrices: { M: 3.5 } }], // sale on M only
    };
    expect(extractVariant(m, null, "White", "2XL")).toMatchObject({ unitPrice: 5.5, standardPrice: 5.5, onSale: false });
    // M still gets its real per-size sale.
    expect(extractVariant(m, null, "White", "M")).toMatchObject({ unitPrice: 3.5, onSale: true });
  });

  it("still applies a color-level sale when the style has NO per-size standard", () => {
    const m = { priceMap: { White: { piecePrice: 4, salePrice: 3.5 } } };
    expect(extractVariant(m, null, "White", "M")).toMatchObject({ unitPrice: 3.5, onSale: true });
  });
});

// A SanMar PO for 100 White M @ style 1717 — cheaper at S&S.
const po = {
  supplier: "SanMar",
  items: [{ styleCode: "1717", color: "White", size: "M", quantity: 100, unitPrice: 4.45 }],
};
const lookup = (prices, stock = {}) => async (supplier) => ({
  matches: [{
    sizePriceMap: { White: { M: prices[supplier] } },
    inventoryMap: stock[supplier] ? { White: { M: stock[supplier] } } : undefined,
  }],
});

describe("comparePoSuppliers + savingsVsCurrent", () => {
  it("prices the PO through each candidate and flags the cheaper supplier's savings", async () => {
    const cmp = await comparePoSuppliers(po, {
      lookupByStyle: lookup({ SanMar: 4.45, "S&S Activewear": 4.15 }),
    });
    expect(cmp.current.total).toBeCloseTo(445);
    expect(cmp.best.supplier).toBe("S&S Activewear");
    const s = savingsVsCurrent(cmp);
    expect(s.supplier).toBe("S&S Activewear");
    expect(s.totalSaved).toBeCloseTo(30);
    expect(s.perPiece).toBeCloseTo(0.3);
  });

  it("returns null savings when the current supplier is already cheapest", async () => {
    const cmp = await comparePoSuppliers(po, {
      lookupByStyle: lookup({ SanMar: 4.1, "S&S Activewear": 4.5 }),
    });
    expect(cmp.best.supplier).toBe("SanMar");
    expect(savingsVsCurrent(cmp)).toBeNull();
  });

  it("won't crown an alternative that can't cover every line", async () => {
    const twoLine = {
      supplier: "SanMar",
      items: [
        { styleCode: "1717", color: "White", size: "M", quantity: 100, unitPrice: 4.45 },
        { styleCode: "9999", color: "White", size: "M", quantity: 10, unitPrice: 5 },
      ],
    };
    // S&S is cheaper on 1717 but doesn't carry 9999 (no match).
    const lookupByStyle = async (supplier, style) => {
      if (supplier === "S&S Activewear" && style === "9999") return { matches: [] };
      const price = supplier === "S&S Activewear" ? 4.15 : style === "9999" ? 5 : 4.45;
      return { matches: [{ sizePriceMap: { White: { M: price } } }] };
    };
    const cmp = await comparePoSuppliers(twoLine, { lookupByStyle });
    const ssAlt = cmp.alternatives.find((a) => a.supplier === "S&S Activewear");
    expect(ssAlt.coversAll).toBe(false);
    expect(ssAlt.missing).toHaveLength(1);
    // best must be the current (covers all) — no false savings claim.
    expect(cmp.best.supplier).toBe("SanMar");
    expect(savingsVsCurrent(cmp)).toBeNull();
  });

  it("counts a running SALE as the buy-now cost — a sale can win the comparison", async () => {
    // S&S standard 4.60 (pricier than SanMar 4.45) but on sale at 4.10 → S&S wins.
    const lookupByStyle = async (supplier) =>
      supplier === "S&S Activewear"
        ? { matches: [{ sizePriceMap: { White: { M: 4.6 } }, colors: [{ colorName: "White", sizeSalePrices: { M: 4.1 } }] }] }
        : { matches: [{ sizePriceMap: { White: { M: 4.45 } } }] };
    const cmp = await comparePoSuppliers(po, { lookupByStyle });
    const ssAlt = cmp.alternatives.find((a) => a.supplier === "S&S Activewear");
    expect(ssAlt.hasSale).toBe(true);
    expect(ssAlt.total).toBeCloseTo(410); // 4.10 × 100, not 4.60
    expect(cmp.best.supplier).toBe("S&S Activewear");
    expect(savingsVsCurrent(cmp).totalSaved).toBeCloseTo(35);
  });

  it("surfaces low-stock lines on the cheaper supplier", async () => {
    const cmp = await comparePoSuppliers(po, {
      lookupByStyle: lookup({ SanMar: 4.45, "S&S Activewear": 4.15 }, { "S&S Activewear": 40 }),
    });
    const s = savingsVsCurrent(cmp);
    expect(s.shortStock).toHaveLength(1); // 40 in stock < 100 needed
  });

  it("annotates each supplier with free-freight status from thresholds", async () => {
    const cmp = await comparePoSuppliers(po, {
      lookupByStyle: lookup({ SanMar: 4.45, "S&S Activewear": 4.15 }),
      thresholds: { SanMar: 300, "S&S Activewear": 500 },
    });
    // SanMar total 445 ≥ 300 → clears; S&S total 415 < 500 → short by 85.
    expect(cmp.current.clearsFreight).toBe(true);
    const ss = cmp.alternatives.find((a) => a.supplier === "S&S Activewear");
    expect(ss.clearsFreight).toBe(false);
    expect(ss.freightGap).toBeCloseTo(85);
  });

  it("AS Colour PO never crowns a cross-catalog price winner (savings stays within family)", async () => {
    const acPo = { supplier: "AS Colour", items: [{ styleCode: "5050", color: "Black", size: "M", quantity: 10 }] };
    // Even if S&S/SanMar return a (colliding) match, best/savings stays AS Colour.
    const cmp = await comparePoSuppliers(acPo, { lookupByStyle: async () => ({ matches: [{ priceMap: { Black: { piecePrice: 6 } } }] }) });
    expect(cmp.best.supplier).toBe("AS Colour");
    expect(savingsVsCurrent(cmp)).toBeNull();
  });

  it("prices ALL THREE suppliers for coverage so a non-carrying supplier is flagged", async () => {
    // S&S/SanMar carry 1717; AS Colour returns nothing → coversAll false → grayable.
    const lookupByStyle = async (supplier) =>
      supplier === "AS Colour" ? { matches: [] } : { matches: [{ sizePriceMap: { White: { M: 4.4 } } }] };
    const cmp = await comparePoSuppliers(po, { lookupByStyle });
    const ac = cmp.alternatives.find((a) => a.supplier === "AS Colour");
    expect(ac.coversAll).toBe(false); // doesn't carry it → picker grays it
    expect(cmp.alternatives.find((a) => a.supplier === "S&S Activewear").coversAll).toBe(true);
  });
});

describe("normalizeAddItemsProduct", () => {
  it("synthesizes variants from colors[] for S&S/SanMar (guessed SKU, sale-aware price, stock)", () => {
    const result = {
      matches: [{
        styleNumber: "1717",
        title: "Comfort Colors 1717",
        colors: [{ colorName: "White", sizePrices: { M: 6.53, L: 6.53 }, sizeSalePrices: { M: 6.34 }, sizeQuantities: { M: 900, L: 40 } }],
        sizePriceMap: { White: { M: 6.53, L: 6.53 } },
        priceMap: { White: { piecePrice: 6.53 } },
        inventoryMap: { White: { M: 900, L: 40 } },
      }],
    };
    const p = normalizeAddItemsProduct(result, "S&S Activewear");
    expect(p.styleCode).toBe("1717");
    expect(p.variants).toHaveLength(2);
    const m = p.variants.find((v) => v.size === "M");
    expect(m).toMatchObject({ sku: "1717-WHITE-M", colour: "White", price: 6.34, stock: 900 }); // sale price
    expect(p.variants.find((v) => v.size === "L").price).toBe(6.53); // no sale on L
  });

  it("passes AS Colour through untouched (keeps its variants)", () => {
    const result = { product: { styleCode: "5050", variants: [{ sku: "5050-BLK-M", colour: "Black", size: "M", price: 6 }] } };
    expect(normalizeAddItemsProduct(result, "AS Colour").variants[0].sku).toBe("5050-BLK-M");
  });

  it("returns null when nothing was found", () => {
    expect(normalizeAddItemsProduct({ matches: [] }, "S&S Activewear")).toBeNull();
  });
});

describe("repriceItemsForSupplier", () => {
  it("re-stamps unit price from the target result + a guessed SKU for S&S", () => {
    const items = [{ styleCode: "1717", color: "White", size: "M", quantity: 100, unitPrice: 4.45, warehouse: "CA" }];
    const target = { lines: [{ unitPrice: 4.15 }] };
    const out = repriceItemsForSupplier(items, target, "S&S Activewear");
    expect(out[0]).toMatchObject({ sku: "1717-WHITE-M", unitPrice: 4.15, warehouse: "" });
  });
  it("blanks the SKU for AS Colour (needs its real SKU)", () => {
    const items = [{ styleCode: "5050", color: "Black", size: "M", quantity: 10, unitPrice: 6 }];
    expect(repriceItemsForSupplier(items, { lines: [{ unitPrice: 5.9 }] }, "AS Colour")[0].sku).toBe("");
  });
});
