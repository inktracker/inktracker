// Pin buildSaleSizePrices — the map applied when a sale line under Garment
// Cost is clicked. Bug story (2026-07-20): the click filled one flat number
// and wiped li.sizePrices, so a 2XL that costs $2 over a Small priced like
// a Small on the final quote.
import { describe, it, expect } from "vitest";
import { buildSaleSizePrices } from "../salePricing";

const option = {
  priceMap: { White: { piecePrice: 8.62, salePrice: 6.34 } },
  colors: [
    {
      colorName: "White",
      sizePrices: { S: 8.62, M: 8.62, L: 8.62, "2XL": 10.62, "3XL": 11.62 },
      sizeSalePrices: { S: 6.34, M: 6.34, L: 6.34, "2XL": 8.1 },
    },
  ],
};

describe("buildSaleSizePrices", () => {
  it("uses the supplier's actual per-size sale price when provided", () => {
    const out = buildSaleSizePrices(option, "White", 6.34);
    expect(out.S).toBe(6.34);
    expect(out["2XL"]).toBe(8.1);
  });

  it("keeps full standard cost for a size the supplier left off sale", () => {
    // 3XL has no reported sale AND the supplier gave per-size sales for the
    // other sizes → 3XL is genuinely not on sale, so it holds its real
    // standard cost (11.62). The markup matrix must price it from that actual
    // cost, never a shifted-down number (Joe 2026-09-15).
    const out = buildSaleSizePrices(option, "White", 6.34);
    expect(out["3XL"]).toBe(11.62);
  });

  it("keeps full standard cost when a per-size 'sale' is at/above that size's standard", () => {
    const bad = JSON.parse(JSON.stringify(option));
    bad.colors[0].sizeSalePrices["2XL"] = 10.62; // not a real sale (== std)
    const out = buildSaleSizePrices(bad, "White", 6.34);
    expect(out["2XL"]).toBe(10.62); // actual standard cost, not a fake/shifted sale
  });

  it("spreads a color-level-only sale across sizes (no per-size sale map)", () => {
    // SanMar-style: a single color sale, no per-size sale detail. Here the
    // discount SHOULD spread so the one sale reaches every size while each
    // size keeps its upcharge. base 8.62 − sale 6.34 = 2.28 discount.
    const colorLevel = {
      priceMap: { White: { piecePrice: 8.62, salePrice: 6.34 } },
      colors: [{
        colorName: "White",
        sizePrices: { S: 8.62, "2XL": 10.62, "3XL": 11.62 },
        sizeSalePrices: {},
      }],
    };
    const out = buildSaleSizePrices(colorLevel, "White", 6.34);
    expect(out).toEqual({ S: 6.34, "2XL": 8.34, "3XL": 9.34 });
  });

  it("returns {} when the option has no per-size data for the color", () => {
    expect(buildSaleSizePrices({ priceMap: {}, colors: [] }, "White", 6.34)).toEqual({});
    expect(
      buildSaleSizePrices({ colors: [{ colorName: "White" }] }, "White", 6.34),
    ).toEqual({});
  });

  it("returns {} for a non-positive sale price", () => {
    expect(buildSaleSizePrices(option, "White", 0)).toEqual({});
    expect(buildSaleSizePrices(option, "White", NaN)).toEqual({});
  });

  it("never shifts a size's cost below $0.01", () => {
    const deep = {
      priceMap: { White: { piecePrice: 10 } },
      colors: [{ colorName: "White", sizePrices: { S: 0.5 }, sizeSalePrices: {} }],
    };
    expect(buildSaleSizePrices(deep, "White", 1).S).toBe(0.01);
  });

  it("only reads the requested color", () => {
    const out = buildSaleSizePrices(
      {
        priceMap: { Red: { piecePrice: 9 } },
        colors: [
          { colorName: "White", sizePrices: { S: 8.62 }, sizeSalePrices: {} },
          { colorName: "Red", sizePrices: { S: 9, "2XL": 11 }, sizeSalePrices: { S: 7 } },
        ],
      },
      "Red",
      7,
    );
    // Red gave a per-size sale (S), so its 2XL is not on sale → full std 11.
    expect(out).toEqual({ S: 7, "2XL": 11 });
  });
});
