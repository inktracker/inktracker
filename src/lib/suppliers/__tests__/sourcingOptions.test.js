import { describe, it, expect } from "vitest";
import {
  candidateSuppliers,
  extractVariant,
  comparePoSuppliers,
  savingsVsCurrent,
  repriceItemsForSupplier,
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

  it("AS Colour PO has no alternatives to compare", async () => {
    const acPo = { supplier: "AS Colour", items: [{ styleCode: "5050", color: "Black", size: "M", quantity: 10 }] };
    const cmp = await comparePoSuppliers(acPo, { lookupByStyle: async () => ({ matches: [{ priceMap: { Black: { piecePrice: 6 } } }] }) });
    expect(cmp.alternatives).toHaveLength(0);
    expect(savingsVsCurrent(cmp)).toBeNull();
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
