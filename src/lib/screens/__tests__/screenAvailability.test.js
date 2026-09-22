import { describe, it, expect } from "vitest";
import {
  screensForLineItems,
  screensForOrder,
  screensForQuote,
  committedScreens,
  normalizeScreenInventory,
  computeScreenAvailability,
  upcomingScreenDemand,
} from "../screenAvailability";

// A 3-color front + 1-color back screen-print job → 4 screens.
const twoImprint = [
  { imprints: [
    { technique: "Screen Print", location: "Front", colors: 3 },
    { technique: "Screen Print", location: "Back", colors: 1 },
  ] },
];

describe("screensForLineItems", () => {
  it("sums colors across screen-print imprints", () => {
    expect(screensForLineItems(twoImprint)).toBe(4);
  });
  it("a reorder burns 0 new screens", () => {
    expect(screensForLineItems(twoImprint, { isReorder: true })).toBe(0);
  });
  it("honors a manual override (paired/corrected count)", () => {
    expect(screensForLineItems(twoImprint, { override: 2 })).toBe(2);
    expect(screensForLineItems(twoImprint, { override: 0 })).toBe(0);
  });
  it("ignores a non-integer / negative override and auto-counts", () => {
    expect(screensForLineItems(twoImprint, { override: null })).toBe(4);
    expect(screensForLineItems(twoImprint, { override: -1 })).toBe(4);
  });
  it("non-screen-print techniques don't consume screens", () => {
    expect(screensForLineItems([{ imprints: [{ technique: "Embroidery", location: "Front", colors: 5 }] }])).toBe(0);
  });
});

describe("screensForOrder", () => {
  it("counts an active order", () => {
    expect(screensForOrder({ status: "In Production", line_items: twoImprint })).toBe(4);
  });
  it("a completed/cancelled/voided order commits 0 (screens reclaimed)", () => {
    for (const status of ["Completed", "Cancelled", "Canceled", "Voided"]) {
      expect(screensForOrder({ status, line_items: twoImprint })).toBe(0);
    }
  });
  it("respects a reorder order and an override on the order", () => {
    expect(screensForOrder({ status: "Art Approval", line_items: twoImprint, is_reorder: true })).toBe(0);
    expect(screensForOrder({ status: "Art Approval", line_items: twoImprint, setup_screens_override: 1 })).toBe(1);
  });
  it("handles junk", () => {
    expect(screensForOrder(null)).toBe(0);
    expect(screensForOrder({ status: "In Production", line_items: null })).toBe(0);
  });
});

describe("screensForQuote", () => {
  it("mirrors the order logic on quote fields", () => {
    expect(screensForQuote({ line_items: twoImprint })).toBe(4);
    expect(screensForQuote({ line_items: twoImprint, is_reorder: true })).toBe(0);
    expect(screensForQuote(null)).toBe(0);
  });
});

describe("committedScreens", () => {
  it("sums only the active orders", () => {
    const orders = [
      { status: "In Production", line_items: twoImprint },   // 4
      { status: "Completed", line_items: twoImprint },        // 0 (reclaimed)
      { status: "Art Approval", line_items: twoImprint, is_reorder: true }, // 0
      { status: "Sent", line_items: [{ imprints: [{ technique: "Screen Print", location: "Front", colors: 2 }] }] }, // 2
    ];
    expect(committedScreens(orders)).toBe(6);
  });
  it("tolerates junk input", () => {
    expect(committedScreens(null)).toBe(0);
    expect(committedScreens(undefined)).toBe(0);
  });
});

describe("upcomingScreenDemand", () => {
  const q = (status, colors, extra = {}) => ({
    status,
    line_items: [{ imprints: [{ technique: "Screen Print", location: "Front", colors }] }],
    ...extra,
  });

  it("sums screens across live pipeline quotes only", () => {
    const quotes = [
      q("Sent", 3),                 // 3
      q("Pending", 2),              // 2
      q("Approved", 4),             // 4
      q("Approved and Paid", 1),    // 1
      q("Draft", 5),                // excluded (not real yet)
      q("Declined", 6),             // excluded (lost)
      { status: "Converted to Order", line_items: q("x", 9).line_items }, // excluded (now an order)
    ];
    expect(upcomingScreenDemand(quotes)).toBe(10);
  });

  it("a reorder quote in the pipeline contributes 0", () => {
    expect(upcomingScreenDemand([q("Approved", 4, { is_reorder: true })])).toBe(0);
  });

  it("tolerates junk", () => {
    expect(upcomingScreenDemand(null)).toBe(0);
    expect(upcomingScreenDemand([{ status: "Sent" }])).toBe(0);
  });
});

describe("normalizeScreenInventory", () => {
  it("rolls up owned + coated, clamps coated to total, drops blank rows", () => {
    const inv = normalizeScreenInventory([
      { mesh: "110", total: 12, coated: 4 },
      { mesh: "156", total: 20, coated: 99 }, // coated clamped to 20
      { mesh: "", total: 0, coated: 0 },       // dropped
    ]);
    expect(inv.owned).toBe(32);
    expect(inv.coated).toBe(24);
    expect(inv.byMesh).toEqual([
      { mesh: "110", total: 12, coated: 4 },
      { mesh: "156", total: 20, coated: 20 },
    ]);
  });
  it("tolerates junk", () => {
    expect(normalizeScreenInventory(null)).toEqual({ byMesh: [], owned: 0, coated: 0 });
    expect(normalizeScreenInventory([{ total: "abc", coated: -3 }])).toEqual({ byMesh: [], owned: 0, coated: 0 });
  });
});

describe("computeScreenAvailability", () => {
  const orders = [{ status: "In Production", line_items: twoImprint }]; // 4

  it("is disabled (silent) unless owned is a positive integer", () => {
    expect(computeScreenAvailability({ orders, owned: undefined }).enabled).toBe(false);
    expect(computeScreenAvailability({ orders, owned: 0 }).enabled).toBe(false);
    expect(computeScreenAvailability({ orders, owned: 2.5 }).enabled).toBe(false);
    const off = computeScreenAvailability({ orders, owned: null });
    expect(off).toEqual({ enabled: false, owned: 0, committed: 4, free: -4, coated: null, byMesh: [] });
  });

  it("flat number: computes free = owned − committed, coated unknown (null)", () => {
    expect(computeScreenAvailability({ orders, owned: 40 })).toEqual({
      enabled: true, owned: 40, committed: 4, free: 36, coated: null, byMesh: [],
    });
  });

  it("free goes negative when over-committed", () => {
    const many = [
      { status: "In Production", line_items: twoImprint },
      { status: "Sent", line_items: twoImprint },
    ]; // 8 committed
    expect(computeScreenAvailability({ orders: many, owned: 6 }).free).toBe(-2);
  });

  it("inventory takes over: owned = sum of mesh totals, coated known, breakdown returned", () => {
    const res = computeScreenAvailability({
      orders,
      owned: 999, // ignored once inventory is present
      inventory: [{ mesh: "110", total: 12, coated: 4 }, { mesh: "230", total: 8, coated: 2 }],
    });
    expect(res).toEqual({
      enabled: true, owned: 20, committed: 4, free: 16, coated: 6,
      byMesh: [{ mesh: "110", total: 12, coated: 4 }, { mesh: "230", total: 8, coated: 2 }],
    });
  });

  it("empty inventory falls back to the flat number", () => {
    expect(computeScreenAvailability({ orders, owned: 30, inventory: [] }).owned).toBe(30);
  });
});
