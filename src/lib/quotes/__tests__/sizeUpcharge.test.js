import { describe, it, expect } from "vitest";
import { getUpchargedSizes } from "../sizeUpcharge";

const ORDER = ["OS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"];

describe("getUpchargedSizes", () => {
  it("returns [] for a flat-priced garment even with a 2XL on the order", () => {
    // AS Colour 5001: every size $5.85. Ordering a 2XL must NOT trigger the note.
    const sizes = { S: 25, "2XL": 10 };
    const flat = { S: 5.85, M: 5.85, L: 5.85, XL: 5.85, "2XL": 5.85, "3XL": 5.85 };
    expect(getUpchargedSizes(sizes, flat, ORDER)).toEqual([]);
  });

  it("names only the ordered sizes that cost more than the base", () => {
    // AS Colour 5101: XS–3XL $16, 4XL/5XL $19.
    const prices = { S: 16, XL: 16, "2XL": 16, "3XL": 16, "4XL": 19, "5XL": 19 };
    const sizes = { S: 20, "2XL": 5, "4XL": 6, "5XL": 4 };
    // 2XL is base ($16) → excluded; only 4XL & 5XL, in size order.
    expect(getUpchargedSizes(sizes, prices, ORDER)).toEqual(["4XL", "5XL"]);
  });

  it("excludes an upcharged size that isn't on the order", () => {
    const prices = { S: 16, "4XL": 19, "5XL": 19 };
    const sizes = { S: 30 }; // only base sizes ordered
    expect(getUpchargedSizes(sizes, prices, ORDER)).toEqual([]);
  });

  it("flags a 2XL when the garment genuinely charges more for it", () => {
    // Comfort Colors tee: S–XL $8.62, 2XL $10.07.
    const prices = { S: 8.62, M: 8.62, XL: 8.62, "2XL": 10.07 };
    const sizes = { M: 20, "2XL": 5 };
    expect(getUpchargedSizes(sizes, prices, ORDER)).toEqual(["2XL"]);
  });

  it("returns [] when there is no per-size price data", () => {
    expect(getUpchargedSizes({ S: 10, "2XL": 5 }, null, ORDER)).toEqual([]);
    expect(getUpchargedSizes({ S: 10, "2XL": 5 }, {}, ORDER)).toEqual([]);
  });

  it("falls back to the sizes' own keys when no order is supplied", () => {
    const prices = { S: 16, "4XL": 19 };
    const sizes = { S: 10, "4XL": 4 };
    expect(getUpchargedSizes(sizes, prices).sort()).toEqual(["4XL"]);
  });

  it("ignores zero/blank quantities", () => {
    const prices = { S: 16, "4XL": 19 };
    const sizes = { S: 10, "4XL": 0 };
    expect(getUpchargedSizes(sizes, prices, ORDER)).toEqual([]);
  });
});
