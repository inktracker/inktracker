import { describe, it, expect } from "vitest";
import { orderAlreadyHasPo, orderPoReference } from "../autoPoFromOrder";

describe("orderAlreadyHasPo — idempotency guard", () => {
  const order = { id: "uuid-1", order_id: "ORD-2026-XYZ" };

  it("true when a per-order PO links it via source_order_id", () => {
    expect(orderAlreadyHasPo(order, [{ status: "draft", source_order_id: "uuid-1" }])).toBe(true);
  });

  it("true when a consolidated PO covers it via source_order_ids", () => {
    expect(orderAlreadyHasPo(order, [{ status: "submitted", source_order_ids: ["uuid-9", "uuid-1"] }])).toBe(true);
  });

  it("false when the only linked PO is cancelled (archived merge source)", () => {
    expect(orderAlreadyHasPo(order, [{ status: "cancelled", source_order_id: "uuid-1" }])).toBe(false);
  });

  it("false when no PO references the order", () => {
    expect(orderAlreadyHasPo(order, [{ status: "draft", source_order_id: "uuid-2" }])).toBe(false);
    expect(orderAlreadyHasPo(order, [])).toBe(false);
    expect(orderAlreadyHasPo(order, null)).toBe(false);
  });

  it("false when the order has no id", () => {
    expect(orderAlreadyHasPo({}, [{ source_order_id: undefined }])).toBe(false);
  });
});

describe("orderPoReference", () => {
  const order = { id: "0123456789abcdef", order_id: "ORD-2026-XYZ" };

  it("uses the order_id for a single-supplier order", () => {
    expect(orderPoReference(order, "AS Colour", false)).toBe("ORD-2026-XYZ");
  });

  it("suffixes a supplier code when the order spans multiple suppliers", () => {
    expect(orderPoReference(order, "AS Colour", true)).toBe("ORD-2026-XYZ-AC");
    expect(orderPoReference(order, "S&S Activewear", true)).toBe("ORD-2026-XYZ-SS");
    expect(orderPoReference(order, "SanMar", true)).toBe("ORD-2026-XYZ-SM");
  });

  it("caps at 20 characters (AS Colour limit)", () => {
    const long = { order_id: "ORD-2026-VERYLONGREFERENCE" };
    expect(orderPoReference(long, "AS Colour", true).length).toBeLessThanOrEqual(20);
  });

  it("falls back to a short order-id slug when there's no order_id", () => {
    expect(orderPoReference({ id: "0123456789abcdef" }, "AS Colour", false)).toBe("Order 01234567");
  });
});
