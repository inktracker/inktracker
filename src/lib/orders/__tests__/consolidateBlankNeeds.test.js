import { describe, it, expect } from "vitest";
import { aggregateBlankNeeds, normalizeSupplier, ordersNeedingGoods } from "../consolidateBlankNeeds";

const line = (o) => ({ supplier: "AS Colour", brand: "AS Colour", styleNumber: "5030", garmentColor: "BLACK", garmentCost: 9, productTitle: "Box Tee", sizes: { S: 2, M: 3 }, ...o });
const order = (id, items) => ({ id, order_id: `ORD-${id}`, line_items: items });

describe("normalizeSupplier", () => {
  it("canonicalizes known aliases, passes unknown through", () => {
    expect(normalizeSupplier("s&s")).toBe("S&S Activewear");
    expect(normalizeSupplier("S&S Activewear")).toBe("S&S Activewear");
    expect(normalizeSupplier("ascolour")).toBe("AS Colour");
    expect(normalizeSupplier("AS Colour")).toBe("AS Colour");
    expect(normalizeSupplier("SanMar")).toBe("SanMar");
    expect(normalizeSupplier("  Alphabroder ")).toBe("Alphabroder");
    expect(normalizeSupplier("")).toBe("");
    expect(normalizeSupplier(null)).toBe("");
  });
});

describe("aggregateBlankNeeds", () => {
  it("sums the SAME style+color across multiple orders into one line, sizes merged", () => {
    const { bySupplier } = aggregateBlankNeeds([
      order("A", [line({ sizes: { S: 5, M: 6 } })]),
      order("B", [line({ sizes: { M: 4, L: 2 } })]),
    ]);
    const ac = bySupplier["AS Colour"];
    expect(ac.lines).toHaveLength(1);
    expect(ac.lines[0].sizes).toEqual({ S: 5, M: 10, L: 2 });
    expect(ac.lines[0].totalQty).toBe(17);
    expect(ac.lines[0].sourceOrders).toEqual([
      { orderId: "A", orderRef: "ORD-A", qty: 11 },
      { orderId: "B", orderRef: "ORD-B", qty: 6 },
    ]);
    expect(ac.totalQty).toBe(17);
    expect(ac.estSubtotal).toBe(153); // 17 × $9
  });

  it("keeps different colors and different styles as separate lines", () => {
    const { bySupplier } = aggregateBlankNeeds([
      order("A", [
        line({ garmentColor: "BLACK" }),
        line({ garmentColor: "WHITE" }),
        line({ styleNumber: "5050", garmentColor: "BLACK" }),
      ]),
    ]);
    expect(bySupplier["AS Colour"].lines).toHaveLength(3);
  });

  it("groups by SUPPLIER, canonicalizing aliases so s&s and S&S merge", () => {
    const { bySupplier } = aggregateBlankNeeds([
      order("A", [
        { supplier: "s&s", styleNumber: "3600", garmentColor: "Black", garmentCost: 3, sizes: { M: 5 } },
        { supplier: "S&S Activewear", styleNumber: "3600", garmentColor: "Black", garmentCost: 3, sizes: { L: 5 } },
        line({}),
      ]),
    ]);
    expect(Object.keys(bySupplier).sort()).toEqual(["AS Colour", "S&S Activewear"]);
    expect(bySupplier["S&S Activewear"].lines).toHaveLength(1);
    expect(bySupplier["S&S Activewear"].lines[0].totalQty).toBe(10);
  });

  it("routes lines missing a supplier or style to `unresolved`, never dropping qty", () => {
    const { bySupplier, unresolved } = aggregateBlankNeeds([
      order("A", [
        { supplier: "", styleNumber: "X", garmentColor: "Red", sizes: { M: 3 } },
        { supplier: "AS Colour", styleNumber: "", garmentColor: "Red", sizes: { M: 2 } },
        line({}),
      ]),
    ]);
    expect(unresolved).toHaveLength(2);
    expect(unresolved.map((u) => u.qty)).toEqual([3, 2]);
    expect(bySupplier["AS Colour"].lines).toHaveLength(1); // only the valid line
  });

  it("skips zero-quantity lines entirely", () => {
    const { bySupplier, unresolved } = aggregateBlankNeeds([
      order("A", [line({ sizes: { S: 0, M: 0 } }), line({ sizes: {} })]),
    ]);
    expect(bySupplier).toEqual({});
    expect(unresolved).toEqual([]);
  });

  it("flags a garment-cost mismatch for the same style across jobs (snapshot drift)", () => {
    const { bySupplier } = aggregateBlankNeeds([
      order("A", [line({ garmentCost: 9 })]),
      order("B", [line({ garmentCost: 10.5 })]),
    ]);
    const l = bySupplier["AS Colour"].lines[0];
    expect(l.costMismatch).toBe(true);
    expect(l.unitCost).toBe(9); // first non-zero kept
  });

  it("handles empty / malformed input safely", () => {
    expect(aggregateBlankNeeds(null)).toEqual({ bySupplier: {}, unresolved: [] });
    expect(aggregateBlankNeeds([{ id: "A" }])).toEqual({ bySupplier: {}, unresolved: [] });
    expect(aggregateBlankNeeds([order("A", [{ styleNumber: "5030" }])])).toEqual({ bySupplier: {}, unresolved: [] });
  });
});

describe("ordersNeedingGoods", () => {
  const withLine = (id, status) => ({ id, order_id: `ORD-${id}`, status, line_items: [{ sizes: { M: 3 } }] });

  it("includes active orders, excludes terminal ones", () => {
    const orders = [
      withLine("A", "Order Goods"),
      withLine("B", "Printing"),
      withLine("C", "Completed"),
      withLine("D", "Cancelled"),
    ];
    expect(ordersNeedingGoods(orders, []).map((o) => o.id)).toEqual(["A", "B"]);
  });

  it("excludes an order already covered by a SUBMITTED PO (scalar or array link)", () => {
    const orders = [withLine("A", "Order Goods"), withLine("B", "Order Goods"), withLine("C", "Order Goods")];
    const pos = [
      { status: "submitted", source_order_id: "A" },
      { status: "submitted", source_order_ids: ["B"] },
      { status: "draft", source_order_id: "C" }, // draft doesn't count as covered
    ];
    expect(ordersNeedingGoods(orders, pos).map((o) => o.id)).toEqual(["C"]);
  });

  it("excludes orders with no orderable quantity", () => {
    const orders = [
      { id: "A", status: "Order Goods", line_items: [{ sizes: { M: 0 } }] },
      { id: "B", status: "Order Goods", line_items: [] },
    ];
    expect(ordersNeedingGoods(orders, [])).toEqual([]);
  });
});
