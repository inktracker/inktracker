// Post-reorder "add to stock" math.
//
// The one behavior that matters most: an UNCHECKED line adds nothing —
// that's the whole point of the confirmation step (an out-of-stock item at
// the vendor must not become phantom inventory).

import { describe, it, expect } from "vitest";
import { matchLinesToItems, buildStockUpdates } from "../stockAdditions";

const ITEMS = [
  { id: "a", item: "Plastisol White", supplier_variant_id: "111", qty: 4 },
  { id: "b", item: "Emulsion", supplier_variant_id: "222", qty: 0 },
  { id: "c", item: "Untracked thing", supplier_variant_id: null, qty: 9 },
  { id: "d", item: "Dup variant", supplier_variant_id: "111", qty: 50 },
];

const LINES = [
  { variantId: 111, qty: 6 },   // number id on purpose — carts mix types
  { variantId: "222", qty: 2 },
  { variantId: "999", qty: 3 }, // ordered but nothing in inventory tracks it
];

describe("matchLinesToItems", () => {
  it("matches by supplier_variant_id across string/number ids", () => {
    const m = matchLinesToItems(ITEMS, LINES);
    expect(m[0].item.id).toBe("a");
    expect(m[1].item.id).toBe("b");
    expect(m[2].item).toBeNull();
  });

  it("first match wins on duplicate variant rows — never double-add", () => {
    const m = matchLinesToItems(ITEMS, [{ variantId: "111", qty: 1 }]);
    expect(m[0].item.id).toBe("a");
  });

  it("survives empty/garbage input", () => {
    expect(matchLinesToItems(null, null)).toEqual([]);
    expect(matchLinesToItems([], LINES).every((m) => m.item === null)).toBe(true);
  });
});

describe("buildStockUpdates", () => {
  const matches = matchLinesToItems(ITEMS, LINES);

  it("adds ordered qty on top of current stock for selected lines", () => {
    const { updates, totalAdded } = buildStockUpdates(matches, new Set(["111", "222"]));
    expect(updates).toEqual([
      { id: "a", qty: 10, added: 6 }, // 4 + 6
      { id: "b", qty: 2, added: 2 },  // 0 + 2
    ]);
    expect(totalAdded).toBe(8);
  });

  it("an UNCHECKED line adds nothing — the out-of-stock case", () => {
    const { updates, totalAdded } = buildStockUpdates(matches, new Set(["222"]));
    expect(updates).toEqual([{ id: "b", qty: 2, added: 2 }]);
    expect(totalAdded).toBe(2);
    // item 'a' untouched even though it was in the cart
    expect(updates.some((u) => u.id === "a")).toBe(false);
  });

  it("selected-but-unmatched lines are counted, not crashed on", () => {
    const { updates, skippedUnmatched } = buildStockUpdates(matches, new Set(["999"]));
    expect(updates).toEqual([]);
    expect(skippedUnmatched).toBe(1);
  });

  it("zero/garbage quantities never produce an update", () => {
    const m = matchLinesToItems(ITEMS, [{ variantId: "111", qty: 0 }, { variantId: "222", qty: "junk" }]);
    const { updates, totalAdded } = buildStockUpdates(m, new Set(["111", "222"]));
    expect(updates).toEqual([]);
    expect(totalAdded).toBe(0);
  });

  it("empty selection is a clean no-op (the Skip button)", () => {
    const { updates, totalAdded, skippedUnmatched } = buildStockUpdates(matches, new Set());
    expect(updates).toEqual([]);
    expect(totalAdded).toBe(0);
    expect(skippedUnmatched).toBe(0);
  });
});
