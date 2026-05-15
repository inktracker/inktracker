import { describe, it, expect } from "vitest";
import {
  poSubtotal,
  freightProgress,
  mergeItem,
  removeItem,
  updateItemQty,
  validateForSubmit,
  buildSubmitPayload,
  mergePOItems,
  mergeableDestinations,
  buildMergedPO,
  combinedReference,
  routeWarehouseForSku,
  applyPOItemsToGoodsProgress,
} from "../purchaseOrders.js";

describe("routeWarehouseForSku", () => {
  it("returns default when default has any stock", () => {
    expect(routeWarehouseForSku({ CA: 100, NC: 50 }, "CA"))
      .toEqual({ warehouse: "CA", source: "default" });
  });

  it("falls back to the other warehouse when default is at zero", () => {
    expect(routeWarehouseForSku({ CA: 0, NC: 50 }, "CA"))
      .toEqual({ warehouse: "NC", source: "fallback" });
  });

  it("KEEPS default when it has stock but less than the requested qty (AS Colour handles splits)", () => {
    // CA has 5, you ordered 10. Default still wins — AS Colour will
    // ship the 5 from CA and the rest from another warehouse server-side.
    expect(routeWarehouseForSku({ CA: 5, NC: 50 }, "CA", 10))
      .toEqual({ warehouse: "CA", source: "default" });
  });

  it("KEEPS default when it has way less than requested but still > 0", () => {
    expect(routeWarehouseForSku({ CA: 198, NC: 112 }, "CA", 500))
      .toEqual({ warehouse: "CA", source: "default" });
  });

  it("sticks with default when both warehouses are at zero — flagged for UI", () => {
    expect(routeWarehouseForSku({ CA: 0, NC: 0 }, "CA"))
      .toEqual({ warehouse: "CA", source: "default-empty" });
  });

  it("respects a non-default warehouse choice (e.g. east coast shop)", () => {
    expect(routeWarehouseForSku({ CA: 100, NC: 50 }, "NC"))
      .toEqual({ warehouse: "NC", source: "default" });
    expect(routeWarehouseForSku({ CA: 100, NC: 0 }, "NC"))
      .toEqual({ warehouse: "CA", source: "fallback" });
  });

  it("handles missing stock map without crashing", () => {
    expect(routeWarehouseForSku(null, "CA").warehouse).toBe("CA");
    expect(routeWarehouseForSku({}, "CA").source).toBe("default-empty");
  });

  it("picks the warehouse with the most stock among non-default options when default is out", () => {
    expect(routeWarehouseForSku({ CA: 0, NC: 5, AUS: 50 }, "CA").warehouse).toBe("AUS");
  });
});

describe("poSubtotal", () => {
  it("returns 0 for empty / non-array", () => {
    expect(poSubtotal([])).toBe(0);
    expect(poSubtotal(null)).toBe(0);
    expect(poSubtotal(undefined)).toBe(0);
  });

  it("sums quantity * unitPrice", () => {
    expect(
      poSubtotal([
        { quantity: 12, unitPrice: 5.5 },
        { quantity: 3, unitPrice: 10 },
      ]),
    ).toBeCloseTo(96, 5);
  });

  it("treats missing fields as 0 instead of NaN", () => {
    expect(poSubtotal([{ quantity: 5 }, { unitPrice: 10 }])).toBe(0);
  });
});

describe("freightProgress", () => {
  it("returns qualifies=false and 0% at empty cart", () => {
    const p = freightProgress([], 200);
    expect(p.subtotal).toBe(0);
    expect(p.percentage).toBe(0);
    expect(p.remaining).toBe(200);
    expect(p.qualifies).toBe(false);
  });

  it("qualifies once subtotal hits the threshold", () => {
    const p = freightProgress([{ quantity: 20, unitPrice: 10 }], 200);
    expect(p.subtotal).toBe(200);
    expect(p.percentage).toBe(100);
    expect(p.remaining).toBe(0);
    expect(p.qualifies).toBe(true);
  });

  it("clamps percentage at 100 when over the threshold", () => {
    const p = freightProgress([{ quantity: 20, unitPrice: 15 }], 200);
    expect(p.subtotal).toBe(300);
    expect(p.percentage).toBe(100);
    expect(p.remaining).toBe(0);
    expect(p.qualifies).toBe(true);
  });

  it("returns qualifies=false when threshold is 0/missing (no threshold configured)", () => {
    const p = freightProgress([{ quantity: 5, unitPrice: 10 }], 0);
    expect(p.qualifies).toBe(false);
    expect(p.remaining).toBe(0);
    expect(p.percentage).toBe(0);
  });
});

describe("mergeItem", () => {
  it("adds a new line when SKU/warehouse don't match", () => {
    const next = mergeItem([], { sku: "X", warehouse: "USA", quantity: 5, unitPrice: 10 });
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ sku: "X", quantity: 5, unitPrice: 10, warehouse: "USA" });
  });

  it("bumps quantity when SKU + warehouse match an existing line", () => {
    const start = [{ sku: "X", warehouse: "USA", quantity: 5, unitPrice: 10 }];
    const next = mergeItem(start, { sku: "X", warehouse: "USA", quantity: 3 });
    expect(next).toHaveLength(1);
    expect(next[0].quantity).toBe(8);
  });

  it("treats different warehouses as separate lines", () => {
    const start = [{ sku: "X", warehouse: "USA", quantity: 5, unitPrice: 10 }];
    const next = mergeItem(start, { sku: "X", warehouse: "AUS", quantity: 3 });
    expect(next).toHaveLength(2);
  });

  it("preserves existing unitPrice when new line carries no price", () => {
    const start = [{ sku: "X", warehouse: "", quantity: 5, unitPrice: 10 }];
    const next = mergeItem(start, { sku: "X", warehouse: "", quantity: 3 });
    expect(next[0].unitPrice).toBe(10);
  });

  it("adopts the new unitPrice when the existing line had 0", () => {
    const start = [{ sku: "X", warehouse: "", quantity: 5, unitPrice: 0 }];
    const next = mergeItem(start, { sku: "X", warehouse: "", quantity: 3, unitPrice: 7.5 });
    expect(next[0].unitPrice).toBe(7.5);
  });

  it("returns the original list if newItem has no SKU", () => {
    const start = [{ sku: "X", quantity: 1 }];
    expect(mergeItem(start, {})).toBe(start);
  });

  it("survives null/undefined items array", () => {
    expect(mergeItem(null, { sku: "X", quantity: 1 })).toEqual([
      expect.objectContaining({ sku: "X", quantity: 1 }),
    ]);
  });
});

describe("updateItemQty / removeItem", () => {
  const items = [
    { sku: "A", quantity: 5 },
    { sku: "B", quantity: 10 },
  ];

  it("updateItemQty changes the quantity at a given index", () => {
    expect(updateItemQty(items, 1, 7)[1].quantity).toBe(7);
  });

  it("updateItemQty removes the line when quantity goes to 0 or negative", () => {
    expect(updateItemQty(items, 0, 0)).toHaveLength(1);
    expect(updateItemQty(items, 0, -1)).toHaveLength(1);
  });

  it("removeItem removes by index", () => {
    expect(removeItem(items, 0)).toEqual([{ sku: "B", quantity: 10 }]);
  });

  it("removeItem ignores out-of-bounds indices", () => {
    expect(removeItem(items, 99)).toEqual(items);
    expect(removeItem(items, -1)).toEqual(items);
  });
});

describe("validateForSubmit", () => {
  const valid = {
    reference: "PO-2026-001",
    shipping_method: "Ground",
    ship_to: { firstName: "Joe", lastName: "Doe", address1: "100 Main", city: "Reno", zip: "89501", countryCode: "US" },
    items: [{ sku: "X", quantity: 5, warehouse: "USA" }],
  };

  it("accepts a valid PO", () => {
    expect(validateForSubmit(valid)).toEqual([]);
  });

  it("flags missing reference", () => {
    expect(validateForSubmit({ ...valid, reference: "" })).toContain(
      "PO reference is required",
    );
  });

  it("flags reference longer than 20 chars (AS Colour limit)", () => {
    const errs = validateForSubmit({ ...valid, reference: "PO for ORD-2026-0WCV9" }); // 21 chars
    expect(errs.find(e => e.includes("20 characters"))).toBeTruthy();
  });

  it("flags missing shipping_method", () => {
    expect(validateForSubmit({ ...valid, shipping_method: undefined })).toEqual(
      expect.arrayContaining(["Shipping method is required"]),
    );
  });

  it("flags each missing shipping address field", () => {
    const errs = validateForSubmit({
      ...valid,
      ship_to: { address1: "", city: "", zip: "", countryCode: "" },
    });
    expect(errs).toEqual(
      expect.arrayContaining([
        "Shipping address: street is required",
        "Shipping address: city is required",
        "Shipping address: zip is required",
        "Shipping address: country code is required",
      ]),
    );
  });

  it("flags empty items list", () => {
    expect(validateForSubmit({ ...valid, items: [] })).toContain(
      "At least one item is required",
    );
  });

  it("flags item-level problems with line numbers", () => {
    const errs = validateForSubmit({
      ...valid,
      items: [{ sku: "", quantity: 0 }],
    });
    expect(errs).toEqual(
      expect.arrayContaining([
        "Item 1: SKU is missing",
        "Item 1: quantity must be positive",
      ]),
    );
  });
});

describe("mergePOItems", () => {
  it("appends source items into an empty destination", () => {
    const out = mergePOItems(
      [{ sku: "A", warehouse: "", quantity: 5, unitPrice: 10 }],
      [],
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ sku: "A", quantity: 5 });
  });

  it("dedupes overlapping SKUs by summing quantities", () => {
    const out = mergePOItems(
      [{ sku: "A", warehouse: "", quantity: 3 }],
      [{ sku: "A", warehouse: "", quantity: 5, unitPrice: 10 }],
    );
    expect(out).toHaveLength(1);
    expect(out[0].quantity).toBe(8);
    expect(out[0].unitPrice).toBe(10);
  });

  it("keeps separate lines for different warehouses on the same SKU", () => {
    const out = mergePOItems(
      [{ sku: "A", warehouse: "AUS", quantity: 3 }],
      [{ sku: "A", warehouse: "USA", quantity: 5 }],
    );
    expect(out).toHaveLength(2);
  });

  it("returns the destination unchanged when source is empty", () => {
    const dest = [{ sku: "A", quantity: 5 }];
    expect(mergePOItems([], dest)).toEqual(dest);
    expect(mergePOItems(null, dest)).toEqual(dest);
  });
});

describe("mergeableDestinations", () => {
  const drafts = [
    { id: "1", supplier: "AS Colour", status: "draft" },
    { id: "2", supplier: "AS Colour", status: "draft" },
    { id: "3", supplier: "AS Colour", status: "submitted" },
    { id: "4", supplier: "S&S Activewear", status: "draft" },
  ];

  it("includes other drafts of the same supplier", () => {
    const out = mergeableDestinations(drafts[0], drafts);
    expect(out.map((x) => x.id)).toEqual(["2"]);
  });

  it("excludes the source PO itself", () => {
    const out = mergeableDestinations(drafts[1], drafts);
    expect(out.map((x) => x.id)).toEqual(["1"]);
  });

  it("excludes submitted POs", () => {
    const onlySubmittedSibling = [drafts[0], drafts[2]];
    expect(mergeableDestinations(drafts[0], onlySubmittedSibling)).toEqual([]);
  });

  it("excludes different-supplier drafts", () => {
    const onlySS = [drafts[0], drafts[3]];
    expect(mergeableDestinations(drafts[0], onlySS)).toEqual([]);
  });

  it("returns an empty array for null/undefined po", () => {
    expect(mergeableDestinations(null, drafts)).toEqual([]);
  });
});

describe("buildMergedPO", () => {
  const make = (overrides = {}) => ({
    id: "1",
    shop_owner: "shop@example.com",
    supplier: "AS Colour",
    status: "draft",
    reference: "PO-001",
    ship_to: { address1: "100 Main", city: "Reno", zip: "89501", countryCode: "US" },
    shipping_method: "Ground",
    notes: "rush",
    courier_instructions: "side door",
    items: [{ sku: "A", warehouse: "", quantity: 5, unitPrice: 10 }],
    ...overrides,
  });

  it("throws when fewer than two sources", () => {
    expect(() => buildMergedPO([])).toThrow();
    expect(() => buildMergedPO([make()])).toThrow();
    expect(() => buildMergedPO(null)).toThrow();
  });

  it("throws on mixed suppliers", () => {
    expect(() =>
      buildMergedPO([make({ id: "1" }), make({ id: "2", supplier: "S&S Activewear" })]),
    ).toThrow(/different suppliers/);
  });

  it("throws on mixed shop_owners", () => {
    expect(() =>
      buildMergedPO([make({ id: "1" }), make({ id: "2", shop_owner: "other@example.com" })]),
    ).toThrow(/different shops/);
  });

  it("throws when any source is not a draft", () => {
    expect(() =>
      buildMergedPO([make({ id: "1" }), make({ id: "2", status: "submitted" })]),
    ).toThrow(/draft/);
  });

  it("joins source references via combinedReference", () => {
    const out = buildMergedPO([
      make({ id: "1", reference: "PO-001" }),
      make({ id: "2", reference: "PO-002" }),
      make({ id: "3", reference: "PO-003" }),
    ]);
    // No common prefix at a space boundary — plain comma join.
    expect(out.reference).toBe("PO-001, PO-002, PO-003");
  });

  it("dedupes the 'PO for ORD-...' prefix when merging order-derived POs", () => {
    const out = buildMergedPO([
      make({ id: "1", reference: "PO for ORD-2026-0WCV9" }),
      make({ id: "2", reference: "PO for ORD-2026-0EVS3" }),
    ]);
    expect(out.reference).toBe("PO for ORD-2026-0WCV9, ORD-2026-0EVS3");
  });

  it("falls back to 'Untitled PO' for sources with no reference", () => {
    const out = buildMergedPO([
      make({ id: "1", reference: "" }),
      make({ id: "2", reference: "PO-002" }),
    ]);
    expect(out.reference).toBe("Untitled PO, PO-002");
  });

  it("sums quantities for matching SKUs across sources", () => {
    const out = buildMergedPO([
      make({ id: "1", items: [{ sku: "A", warehouse: "", quantity: 5, unitPrice: 10 }] }),
      make({ id: "2", items: [{ sku: "A", warehouse: "", quantity: 3 }, { sku: "B", warehouse: "", quantity: 7 }] }),
    ]);
    const a = out.items.find((it) => it.sku === "A");
    const b = out.items.find((it) => it.sku === "B");
    expect(a.quantity).toBe(8);
    expect(b.quantity).toBe(7);
  });

  it("inherits ship_to / shipping_method / notes / courier_instructions from the first source", () => {
    const out = buildMergedPO([
      make({ id: "1", ship_to: { address1: "FIRST" }, shipping_method: "Ground", notes: "first notes", courier_instructions: "first courier" }),
      make({ id: "2", ship_to: { address1: "SECOND" }, shipping_method: "Express", notes: "second notes", courier_instructions: "second courier" }),
    ]);
    expect(out.ship_to.address1).toBe("FIRST");
    expect(out.shipping_method).toBe("Ground");
    expect(out.notes).toBe("first notes");
    expect(out.courier_instructions).toBe("first courier");
  });

  it("starts the merged PO as a draft", () => {
    const out = buildMergedPO([make({ id: "1" }), make({ id: "2" })]);
    expect(out.status).toBe("draft");
  });
});

describe("combinedReference", () => {
  it("returns 'Untitled PO' on empty input", () => {
    expect(combinedReference([])).toBe("Untitled PO");
    expect(combinedReference(null)).toBe("Untitled PO");
  });

  it("returns the single ref unchanged", () => {
    expect(combinedReference(["PO-001"])).toBe("PO-001");
  });

  it("strips a shared 'PO for ' prefix and prepends it once", () => {
    expect(
      combinedReference(["PO for ORD-2026-0WCV9", "PO for ORD-2026-0EVS3"]),
    ).toBe("PO for ORD-2026-0WCV9, ORD-2026-0EVS3");
  });

  it("works with three or more sharing the same prefix", () => {
    expect(
      combinedReference([
        "PO for ORD-A",
        "PO for ORD-B",
        "PO for ORD-C",
      ]),
    ).toBe("PO for ORD-A, ORD-B, ORD-C");
  });

  it("falls back to plain comma-join when refs don't share a word-boundary prefix", () => {
    expect(combinedReference(["PO-001", "PO-002"])).toBe("PO-001, PO-002");
    expect(combinedReference(["PO for ORD-A", "Custom name"])).toBe("PO for ORD-A, Custom name");
  });

  it("dedupes when the same ref appears twice", () => {
    expect(combinedReference(["PO for X", "PO for X"])).toBe("PO for X");
  });

  it("handles empty or whitespace refs by inserting 'Untitled PO'", () => {
    expect(combinedReference(["", "PO-002"])).toBe("Untitled PO, PO-002");
    expect(combinedReference(["  ", "PO-002"])).toBe("Untitled PO, PO-002");
  });
});

describe("buildSubmitPayload", () => {
  it("produces the AS Colour /v1/orders shape with CA warehouse default", () => {
    const out = buildSubmitPayload({
      reference: "PO-1",
      shipping_method: "Ground",
      notes: "rush please",
      courier_instructions: "side door",
      ship_to: { address1: "100 Main", city: "Reno", zip: "89501", countryCode: "US" },
      items: [
        { sku: "A", warehouse: "NC", quantity: 5 },
        { sku: "B", quantity: 3 }, // no per-item warehouse, no po.warehouse → default CA
      ],
    });
    expect(out).toEqual({
      reference: "PO-1",
      shippingMethod: "Ground",
      orderNotes: "rush please",
      courierInstructions: "side door",
      shippingAddress: { address1: "100 Main", city: "Reno", zip: "89501", countryCode: "US" },
      items: [
        { sku: "A", warehouse: "NC", quantity: 5 },
        { sku: "B", warehouse: "CA", quantity: 3 },
      ],
    });
  });

  it("per-item warehouse wins; po.warehouse is only the fallback for items with none", () => {
    const out = buildSubmitPayload({
      reference: "PO-1",
      shipping_method: "Ground",
      ship_to: { address1: "1", city: "x", zip: "y", countryCode: "US" },
      warehouse: "NC", // fallback for items lacking their own
      items: [
        { sku: "A", warehouse: "CA", quantity: 5 }, // keeps CA (item-level)
        { sku: "B", quantity: 3 },                  // inherits NC (fallback)
      ],
    });
    expect(out.items[0].warehouse).toBe("CA");
    expect(out.items[1].warehouse).toBe("NC");
  });
});

describe("applyPOItemsToGoodsProgress", () => {
  const NOW = "2026-05-15T00:00:00.000Z";
  const baseOrder = {
    checklist: {},
    line_items: [
      { style: "5026", garmentColor: "Black", sizes: { S: 5, M: 5, L: 5, XL: 3 } },
      { style: "5026", garmentColor: "Athletic Heather", sizes: { S: 5, M: 5, L: 5 } },
      { style: "5050", garmentColor: "White", sizes: { S: 10, M: 10 } },
    ],
  };

  it("marks matching sizes as ordered, keyed by liIdx-size", () => {
    const result = applyPOItemsToGoodsProgress(baseOrder, [
      { styleCode: "5026", color: "Black", size: "M", quantity: 5 },
      { styleCode: "5026", color: "Black", size: "L", quantity: 5 },
    ], "8533", NOW);
    expect(result.goods_progress["0-M"]).toEqual({
      status: "ordered", by: "API", at: NOW, supplier_order_id: "8533",
    });
    expect(result.goods_progress["0-L"]).toEqual({
      status: "ordered", by: "API", at: NOW, supplier_order_id: "8533",
    });
    expect(result.goods_progress["0-S"]).toBeUndefined();
  });

  it("matches color case-insensitively (BLACK vs Black)", () => {
    const result = applyPOItemsToGoodsProgress(baseOrder, [
      { styleCode: "5026", color: "BLACK", size: "S" },
    ], null, NOW);
    expect(result.goods_progress["0-S"]?.status).toBe("ordered");
  });

  it("disambiguates by color when same style has two color variants", () => {
    // 5026 Black is liIdx 0, 5026 Athletic Heather is liIdx 1.
    const result = applyPOItemsToGoodsProgress(baseOrder, [
      { styleCode: "5026", color: "Athletic Heather", size: "M" },
    ], null, NOW);
    expect(result.goods_progress["1-M"]?.status).toBe("ordered");
    expect(result.goods_progress["0-M"]).toBeUndefined();
  });

  it("never overwrites a 'received' status (operator's manual click wins)", () => {
    const order = {
      ...baseOrder,
      checklist: {
        goods_progress: {
          "0-M": { status: "received", by: "Joe", at: "2026-05-14T00:00:00Z" },
        },
      },
    };
    const result = applyPOItemsToGoodsProgress(order, [
      { styleCode: "5026", color: "Black", size: "M" },
    ], "8533", NOW);
    expect(result.goods_progress["0-M"].status).toBe("received");
    expect(result.goods_progress["0-M"].by).toBe("Joe");
  });

  it("overwrites a stale 'ordered' status with a fresh API mark (re-submit case)", () => {
    const order = {
      ...baseOrder,
      checklist: {
        goods_progress: {
          "0-M": { status: "ordered", by: "Joe", at: "2026-05-14T00:00:00Z" },
        },
      },
    };
    const result = applyPOItemsToGoodsProgress(order, [
      { styleCode: "5026", color: "Black", size: "M" },
    ], "8533", NOW);
    expect(result.goods_progress["0-M"].by).toBe("API");
    expect(result.goods_progress["0-M"].supplier_order_id).toBe("8533");
  });

  it("skips PO items with no matching line item (defensive — typos, deleted lines)", () => {
    const result = applyPOItemsToGoodsProgress(baseOrder, [
      { styleCode: "9999", color: "Black", size: "M" },
    ], null, NOW);
    expect(result.goods_progress).toEqual({});
  });

  it("skips sizes that don't exist on the matched line item", () => {
    // 5050 White only has S and M, so XL should skip.
    const result = applyPOItemsToGoodsProgress(baseOrder, [
      { styleCode: "5050", color: "White", size: "XL" },
    ], null, NOW);
    expect(result.goods_progress).toEqual({});
  });

  it("falls back to li.supplierStyleNumber / resolvedStyleNumber when li.style is the display label", () => {
    const order = {
      checklist: {},
      line_items: [
        { style: "Premium Tee", supplierStyleNumber: "5026", garmentColor: "Black", sizes: { M: 5 } },
        { style: "Heavy Tee",   resolvedStyleNumber: "5050", garmentColor: "White", sizes: { S: 5 } },
        { style: "Lightweight", styleNumber: "5080",         garmentColor: "Navy",  sizes: { L: 5 } },
      ],
    };
    const result = applyPOItemsToGoodsProgress(order, [
      { styleCode: "5026", color: "Black", size: "M" },
      { styleCode: "5050", color: "White", size: "S" },
      { styleCode: "5080", color: "Navy",  size: "L" },
    ], null, NOW);
    expect(result.goods_progress["0-M"]?.status).toBe("ordered");
    expect(result.goods_progress["1-S"]?.status).toBe("ordered");
    expect(result.goods_progress["2-L"]?.status).toBe("ordered");
  });

  it("omits supplier_order_id when null is passed (e.g. supplier returned no id)", () => {
    const result = applyPOItemsToGoodsProgress(baseOrder, [
      { styleCode: "5026", color: "Black", size: "M" },
    ], null, NOW);
    expect(result.goods_progress["0-M"].supplier_order_id).toBeUndefined();
  });

  it("preserves unrelated checklist keys (step task checks, print_progress)", () => {
    const order = {
      ...baseOrder,
      checklist: {
        "Order Goods": { "Check inventory": { by: "Joe", at: NOW } },
        print_progress: { "0-M-0": { by: "Joe", at: NOW } },
      },
    };
    const result = applyPOItemsToGoodsProgress(order, [
      { styleCode: "5026", color: "Black", size: "M" },
    ], "8533", NOW);
    expect(result["Order Goods"]).toEqual({ "Check inventory": { by: "Joe", at: NOW } });
    expect(result.print_progress).toEqual({ "0-M-0": { by: "Joe", at: NOW } });
    expect(result.goods_progress["0-M"]?.status).toBe("ordered");
  });

  it("handles null/missing inputs without throwing", () => {
    expect(applyPOItemsToGoodsProgress(null, null, null, NOW))
      .toEqual({ goods_progress: {} });
    expect(applyPOItemsToGoodsProgress({}, [], null, NOW))
      .toEqual({ goods_progress: {} });
    expect(applyPOItemsToGoodsProgress(baseOrder, [{}], null, NOW))
      .toEqual({ goods_progress: {} });
  });
});
