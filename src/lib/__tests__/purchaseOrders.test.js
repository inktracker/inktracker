import { describe, it, expect } from "vitest";
import {
  poSubtotal,
  freightProgress,
  mergeItem,
  removeItem,
  updateItemQty,
  validateForSubmit,
  buildSubmitPayload,
} from "../purchaseOrders.js";

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
    ship_to: { address1: "100 Main", city: "Reno", zip: "89501", countryCode: "US" },
    items: [{ sku: "X", quantity: 5 }],
  };

  it("accepts a valid PO", () => {
    expect(validateForSubmit(valid)).toEqual([]);
  });

  it("flags missing reference", () => {
    expect(validateForSubmit({ ...valid, reference: "" })).toContain(
      "PO reference (your internal name / PO number) is required",
    );
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

describe("buildSubmitPayload", () => {
  it("produces the AS Colour /v1/orders shape", () => {
    const out = buildSubmitPayload({
      reference: "PO-1",
      shipping_method: "Ground",
      notes: "rush please",
      courier_instructions: "side door",
      ship_to: { address1: "100 Main", city: "Reno", zip: "89501", countryCode: "US" },
      items: [
        { sku: "A", warehouse: "USA", quantity: 5 },
        { sku: "B", quantity: 3 },
      ],
    });
    expect(out).toEqual({
      reference: "PO-1",
      shippingMethod: "Ground",
      orderNotes: "rush please",
      courierInstructions: "side door",
      shippingAddress: { address1: "100 Main", city: "Reno", zip: "89501", countryCode: "US" },
      items: [
        { sku: "A", warehouse: "USA", quantity: 5 },
        { sku: "B", warehouse: "", quantity: 3 },
      ],
    });
  });
});
