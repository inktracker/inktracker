import { describe, it, expect } from "vitest";
import { setItemCheckedIn, poReceivingSummary, applyCheckInToOrder } from "@/lib/purchaseOrders";

describe("setItemCheckedIn", () => {
  const items = [{ sku: "A", quantity: 10 }, { sku: "B", quantity: 5 }];
  it("sets a non-negative integer checkedIn on the item at index", () => {
    expect(setItemCheckedIn(items, 0, 8)[0]).toMatchObject({ sku: "A", quantity: 10, checkedIn: 8 });
    expect(setItemCheckedIn(items, 1, -3)[1].checkedIn).toBe(0);
    expect(setItemCheckedIn(items, 0, 7.9)[0].checkedIn).toBe(7);
  });
  it("is a no-op out of bounds and doesn't mutate the input", () => {
    expect(setItemCheckedIn(items, 9, 3)).toBe(items);
    setItemCheckedIn(items, 0, 8);
    expect(items[0].checkedIn).toBeUndefined();
  });
});

describe("poReceivingSummary", () => {
  it("reports received flag, check-in progress, and under-received shortages", () => {
    const po = {
      received_at: "2026-09-14T00:00:00Z",
      items: [
        { sku: "A", styleCode: "5030", color: "Black", size: "M", quantity: 10, checkedIn: 10 },
        { sku: "B", styleCode: "5030", color: "Black", size: "L", quantity: 6, checkedIn: 4 }, // short 2
        { sku: "C", styleCode: "5030", color: "Black", size: "S", quantity: 3 }, // not checked in
      ],
    };
    const s = poReceivingSummary(po);
    expect(s.received).toBe(true);
    expect(s.checkedInCount).toBe(2);
    expect(s.totalItems).toBe(3);
    expect(s.allCheckedIn).toBe(false);
    expect(s.shortages).toEqual([{ sku: "B", styleCode: "5030", color: "Black", size: "L", ordered: 6, received: 4, short: 2 }]);
  });
  it("allCheckedIn true only when every line has a count", () => {
    expect(poReceivingSummary({ items: [{ quantity: 1, checkedIn: 1 }] }).allCheckedIn).toBe(true);
    expect(poReceivingSummary({ items: [] }).allCheckedIn).toBe(false);
  });
});

describe("applyCheckInToOrder", () => {
  const order = {
    checklist: { goods_progress: {} },
    line_items: [
      { styleNumber: "5030", garmentColor: "Black", sizes: { M: 10, L: 6 } },
    ],
  };
  const items = [
    { styleCode: "5030", color: "Black", size: "M", quantity: 10, checkedIn: 10 },
    { styleCode: "5030", color: "Black", size: "L", quantity: 6, checkedIn: 4 }, // short 2
  ];

  it("marks matching sizes 'received' with the counted qty on the floor", () => {
    const patch = applyCheckInToOrder(order, items, { nowIso: "T" });
    expect(patch.checklist.goods_progress["0-M"]).toEqual({ status: "received", qty: 10, by: "check-in", at: "T" });
    expect(patch.checklist.goods_progress["0-L"]).toEqual({ status: "received", qty: 4, by: "check-in", at: "T" });
  });

  it("records under-receipt as _shortfall for reorder (single-order PO)", () => {
    const patch = applyCheckInToOrder(order, items, { computeShortfall: true, nowIso: "T" });
    expect(patch.line_items[0]._shortfall).toEqual({ L: 2 });
  });

  it("does NOT compute shortfall for a multi-order (consolidated) PO", () => {
    const patch = applyCheckInToOrder(order, items, { computeShortfall: false, nowIso: "T" });
    expect(patch.line_items[0]._shortfall).toBeUndefined();
    // but still marks received
    expect(patch.checklist.goods_progress["0-L"].status).toBe("received");
  });

  it("ignores items not yet checked in and unmatched styles/sizes", () => {
    const patch = applyCheckInToOrder(order, [
      { styleCode: "5030", color: "Black", size: "M", quantity: 10 }, // no checkedIn
      { styleCode: "9999", color: "Red", size: "XL", quantity: 5, checkedIn: 5 }, // no match
    ], { nowIso: "T" });
    expect(patch.checklist.goods_progress).toEqual({});
  });

  it("does NOT mark a size 'received' when 0 arrived — it's a full shortage, not a receipt", () => {
    const zero = [{ styleCode: "5030", color: "Black", size: "M", quantity: 10, checkedIn: 0 }];
    const patch = applyCheckInToOrder(order, zero, { computeShortfall: true, nowIso: "T" });
    expect(patch.checklist.goods_progress["0-M"]).toBeUndefined(); // NOT received
    expect(patch.line_items[0]._shortfall).toEqual({ M: 10 }); // full shortage recorded
  });

  it("matches the PO item's style against ANY of the line's style aliases (reorder reconciles)", () => {
    // Order line was built from supplierStyleNumber "AC5030"; the reorder PO
    // carries the bare style "5030" — must still match and reconcile.
    const aliasOrder = {
      checklist: { goods_progress: {} },
      line_items: [{ supplierStyleNumber: "AC5030", style: "5030", garmentColor: "Black", sizes: { M: 5 } }],
    };
    const patch = applyCheckInToOrder(aliasOrder, [{ styleCode: "5030", color: "Black", size: "M", quantity: 5, checkedIn: 5 }], { nowIso: "T" });
    expect(patch.checklist.goods_progress["0-M"]?.status).toBe("received");
  });

  it("matches size case-insensitively and uses the order's canonical size key", () => {
    const caseOrder = {
      checklist: { goods_progress: {} },
      line_items: [{ styleNumber: "5030", garmentColor: "Black", sizes: { "2XL": 4 } }],
    };
    const patch = applyCheckInToOrder(caseOrder, [{ styleCode: "5030", color: "Black", size: "2xl", quantity: 4, checkedIn: 4 }], { nowIso: "T" });
    expect(patch.checklist.goods_progress["0-2XL"]?.status).toBe("received"); // canonical key
  });
});
