import { describe, it, expect } from "vitest";
import {
  countGoodsProgress,
  autoCheckOrderGoodsTask,
  nextGoodsStatusOnTap,
  unreceivedCount,
} from "../orderGoodsProgress.js";

describe("countGoodsProgress", () => {
  it("returns zeros for null/empty order", () => {
    expect(countGoodsProgress(null)).toEqual({ total: 0, ordered: 0, received: 0, marked: 0 });
    expect(countGoodsProgress({})).toEqual({ total: 0, ordered: 0, received: 0, marked: 0 });
    expect(countGoodsProgress({ line_items: [] })).toEqual({ total: 0, ordered: 0, received: 0, marked: 0 });
  });

  it("counts every size with qty > 0 as one slot in total", () => {
    const order = {
      line_items: [
        { sizes: { S: 5, M: 3, L: 0 } }, // L excluded
        { sizes: { XL: 2 } },
      ],
    };
    expect(countGoodsProgress(order).total).toBe(3);
  });

  it("counts ordered and received separately, marked = ordered + received", () => {
    const order = {
      line_items: [{ sizes: { S: 5, M: 5, L: 5, XL: 5 } }],
      checklist: {
        goods_progress: {
          "0-S": { status: "ordered" },
          "0-M": { status: "ordered" },
          "0-L": { status: "received" },
          // 0-XL is blank
        },
      },
    };
    const c = countGoodsProgress(order);
    expect(c).toEqual({ total: 4, ordered: 2, received: 1, marked: 3 });
  });

  it("ignores stale keys for sizes that don't exist on a line item", () => {
    // A renamed size that left a stale goods_progress entry shouldn't
    // inflate the count.
    const order = {
      line_items: [{ sizes: { S: 5 } }],
      checklist: {
        goods_progress: {
          "0-S":   { status: "ordered" },
          "0-XXL": { status: "received" }, // stale
        },
      },
    };
    const c = countGoodsProgress(order);
    expect(c.total).toBe(1);
    expect(c.ordered).toBe(1);
    expect(c.received).toBe(0);
  });

  it("handles missing checklist gracefully", () => {
    const order = { line_items: [{ sizes: { S: 5 } }] };
    expect(countGoodsProgress(order)).toEqual({ total: 1, ordered: 0, received: 0, marked: 0 });
  });

  it("treats non-integer qty strings as their parsed int (whatever Object.entries returns)", () => {
    // sizes commonly come back as strings from JSON; the helper should
    // still count them.
    const order = {
      line_items: [{ sizes: { S: "5", M: "0", L: "abc" } }],
    };
    // S parses to 5 (counted); M to 0 (skipped); L to NaN (skipped).
    expect(countGoodsProgress(order).total).toBe(1);
  });
});

describe("autoCheckOrderGoodsTask", () => {
  it("returns null for steps other than Order Goods (manual task always)", () => {
    expect(autoCheckOrderGoodsTask("Pre-Press", "Place blank order", { total: 5, marked: 5 }))
      .toBe(null);
    expect(autoCheckOrderGoodsTask("Printing", "Receive goods", { total: 5, received: 5 }))
      .toBe(null);
  });

  it("returns null for tasks that aren't auto-derived (e.g. Check inventory)", () => {
    expect(autoCheckOrderGoodsTask("Order Goods", "Check inventory", { total: 5, marked: 5 }))
      .toBe(null);
  });

  it("'Place blank order' returns true once every size is at-least-ordered", () => {
    expect(autoCheckOrderGoodsTask("Order Goods", "Place blank order", { total: 5, marked: 5 }))
      .toBe(true);
  });

  it("'Place blank order' returns false when partially marked", () => {
    expect(autoCheckOrderGoodsTask("Order Goods", "Place blank order", { total: 5, marked: 3 }))
      .toBe(false);
  });

  it("'Place blank order' returns false when no sizes at all (total=0)", () => {
    // Zero-size edge case: nothing to order means nothing to auto-check.
    expect(autoCheckOrderGoodsTask("Order Goods", "Place blank order", { total: 0, marked: 0 }))
      .toBe(false);
  });

  it("'Receive goods' returns true only when every size is received (ordered doesn't count)", () => {
    expect(autoCheckOrderGoodsTask("Order Goods", "Receive goods", { total: 5, received: 5 }))
      .toBe(true);
    expect(autoCheckOrderGoodsTask("Order Goods", "Receive goods", { total: 5, received: 4 }))
      .toBe(false);
    // All ordered but none received → still false (matches Joe's
    // "amber checks blank order, but receive goods stays manual" intent).
    expect(autoCheckOrderGoodsTask("Order Goods", "Receive goods", { total: 5, marked: 5, received: 0 }))
      .toBe(false);
  });

  it("handles null/missing counts defensively", () => {
    expect(autoCheckOrderGoodsTask("Order Goods", "Place blank order", null))
      .toBe(false);
    expect(autoCheckOrderGoodsTask("Order Goods", "Receive goods", {}))
      .toBe(false);
  });
});

describe("nextGoodsStatusOnTap", () => {
  it("advances ordered → received", () => {
    expect(nextGoodsStatusOnTap("ordered")).toBe("received");
  });

  it("blocks blank → ordered (manual click never advances from blank — that's the API auto-mark's job)", () => {
    expect(nextGoodsStatusOnTap(undefined)).toBe(null);
    expect(nextGoodsStatusOnTap(null)).toBe(null);
    expect(nextGoodsStatusOnTap("")).toBe(null);
  });

  it("blocks received → anything (received is terminal)", () => {
    expect(nextGoodsStatusOnTap("received")).toBe(null);
  });

  it("blocks unknown status values defensively", () => {
    expect(nextGoodsStatusOnTap("pending")).toBe(null);
    expect(nextGoodsStatusOnTap("delivered")).toBe(null);
  });
});

describe("unreceivedCount", () => {
  it("returns 0 when every size is received", () => {
    const order = {
      line_items: [{ sizes: { S: 5, M: 5 } }],
      checklist: { goods_progress: {
        "0-S": { status: "received" },
        "0-M": { status: "received" },
      }},
    };
    expect(unreceivedCount(order)).toBe(0);
  });

  it("counts blank + ordered sizes as unreceived", () => {
    const order = {
      line_items: [{ sizes: { S: 5, M: 5, L: 5 } }],
      checklist: { goods_progress: {
        "0-S": { status: "received" },
        "0-M": { status: "ordered" }, // not received yet
        // 0-L blank
      }},
    };
    expect(unreceivedCount(order)).toBe(2);
  });

  it("returns 0 for an empty order (not -1)", () => {
    expect(unreceivedCount(null)).toBe(0);
    expect(unreceivedCount({ line_items: [] })).toBe(0);
  });
});
