import { describe, it, expect } from "vitest";
import { isLowStock, filterLowStock } from "../lowStock.js";

describe("isLowStock", () => {
  it("flags an item at or below a positive reorder threshold", () => {
    expect(isLowStock({ qty: 2, reorder: 5 })).toBe(true);
    expect(isLowStock({ qty: 5, reorder: 5 })).toBe(true); // at threshold
    expect(isLowStock({ qty: 0, reorder: 5 })).toBe(true);
  });

  it("does NOT flag an item above its reorder threshold", () => {
    expect(isLowStock({ qty: 6, reorder: 5 })).toBe(false);
  });

  it("does NOT flag an untracked item (reorder 0 / null / missing) even at qty 0", () => {
    // The bug this guard fixes: reorder has no DB default, so untracked
    // items are null → Number(null) === 0 → 0 <= 0 would falsely flag.
    expect(isLowStock({ qty: 0, reorder: 0 })).toBe(false);
    expect(isLowStock({ qty: 0, reorder: null })).toBe(false);
    expect(isLowStock({ qty: 0 })).toBe(false);
    expect(isLowStock({ qty: 0, reorder: -3 })).toBe(false);
  });

  it("treats missing/invalid qty as 0 (out of stock) against a real threshold", () => {
    expect(isLowStock({ reorder: 5 })).toBe(true);
    expect(isLowStock({ qty: null, reorder: 5 })).toBe(true);
  });

  it("is null-safe", () => {
    expect(isLowStock(null)).toBe(false);
    expect(isLowStock(undefined)).toBe(false);
  });
});

describe("filterLowStock", () => {
  it("keeps only tracked, at-or-below-threshold items", () => {
    const items = [
      { id: "a", qty: 0, reorder: 0 },   // untracked → out
      { id: "b", qty: 2, reorder: 5 },   // low → in
      { id: "c", qty: 9, reorder: 5 },   // stocked → out
      { id: "d", qty: 0, reorder: null }, // untracked → out
    ];
    expect(filterLowStock(items).map((i) => i.id)).toEqual(["b"]);
  });

  it("returns [] for null/empty input", () => {
    expect(filterLowStock(null)).toEqual([]);
    expect(filterLowStock([])).toEqual([]);
  });
});
