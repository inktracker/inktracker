import { describe, it, expect } from "vitest";
import {
  addDaysISO,
  relativeDueLabel,
  getOrderActionHint,
} from "../agendaHints";

describe("addDaysISO", () => {
  it("walks forward across month boundaries", () => {
    expect(addDaysISO("2026-05-30", 5)).toBe("2026-06-04");
  });

  it("walks backward across year boundaries", () => {
    expect(addDaysISO("2026-01-02", -5)).toBe("2025-12-28");
  });

  it("is idempotent for n=0", () => {
    expect(addDaysISO("2026-05-30", 0)).toBe("2026-05-30");
  });

  it("ignores hh:mm:ss when present (slices to 10)", () => {
    expect(addDaysISO("2026-05-30T12:34:56", 1)).toBe("2026-05-31");
  });

  it("returns the input on malformed dates", () => {
    expect(addDaysISO("garbage", 5)).toBe("garbage");
    expect(addDaysISO(null, 5)).toBe(null);
  });

  it("coerces non-number n to 0", () => {
    expect(addDaysISO("2026-05-30", "junk")).toBe("2026-05-30");
  });
});

describe("relativeDueLabel", () => {
  it("today", () => {
    expect(relativeDueLabel("2026-05-30", "2026-05-30")).toBe("Due today");
  });

  it("tomorrow", () => {
    expect(relativeDueLabel("2026-05-31", "2026-05-30")).toBe("Due tomorrow");
  });

  it("future N days", () => {
    expect(relativeDueLabel("2026-06-04", "2026-05-30")).toBe("Due in 5 days");
  });

  it("overdue 1 day", () => {
    expect(relativeDueLabel("2026-05-29", "2026-05-30")).toBe("Overdue 1 day");
  });

  it("overdue N days", () => {
    expect(relativeDueLabel("2026-05-20", "2026-05-30")).toBe("Overdue 10 days");
  });

  it("returns empty when either input is missing", () => {
    expect(relativeDueLabel(null, "2026-05-30")).toBe("");
    expect(relativeDueLabel("2026-05-30", null)).toBe("");
  });
});

describe("getOrderActionHint", () => {
  function order(status, opts = {}) {
    return {
      status,
      line_items: opts.line_items ?? [{ sizes: { S: 5, M: 5 } }],
      checklist: { goods_progress: opts.goodsProgress ?? {} },
    };
  }

  it("Art Approval → Get art approved", () => {
    expect(getOrderActionHint(order("Art Approval"))).toBe("Get art approved");
  });

  it("Pre-Press → Set up screens", () => {
    expect(getOrderActionHint(order("Pre-Press"))).toBe("Set up screens");
  });

  it("Printing → Print scheduled", () => {
    expect(getOrderActionHint(order("Printing"))).toBe("Print scheduled");
  });

  it("Completed → no hint", () => {
    expect(getOrderActionHint(order("Completed"))).toBe(null);
  });

  it("Cancelled → no hint", () => {
    expect(getOrderActionHint(order("Cancelled"))).toBe(null);
  });

  it("null / undefined → no hint", () => {
    expect(getOrderActionHint(null)).toBe(null);
    expect(getOrderActionHint(undefined)).toBe(null);
  });

  it("Order Goods, no goods marked → Order blanks", () => {
    expect(getOrderActionHint(order("Order Goods"))).toBe("Order blanks");
  });

  it("Order Goods, some sizes ordered, others blank → Finish ordering blanks", () => {
    expect(
      getOrderActionHint(
        order("Order Goods", { goodsProgress: { "0-S": { status: "ordered" } } }),
      ),
    ).toBe("Finish ordering blanks");
  });

  it("Order Goods, all ordered but none received → Receive blanks", () => {
    expect(
      getOrderActionHint(
        order("Order Goods", {
          goodsProgress: {
            "0-S": { status: "ordered" },
            "0-M": { status: "ordered" },
          },
        }),
      ),
    ).toBe("Receive blanks");
  });

  it("Order Goods, all received → no hint (ready to advance)", () => {
    expect(
      getOrderActionHint(
        order("Order Goods", {
          goodsProgress: {
            "0-S": { status: "received" },
            "0-M": { status: "received" },
          },
        }),
      ),
    ).toBe(null);
  });

  it("Order Goods, no line items → no hint (no sizes to act on)", () => {
    expect(getOrderActionHint(order("Order Goods", { line_items: [] }))).toBe(null);
  });
});
