import { describe, it, expect } from "vitest";
import {
  buildOrderCompletionPlan,
  COMPLETED_ORDER_STATUS,
} from "../completeOrder";

const TODAY = "2026-05-12";
const SHOP = "shop@example.com";

const baseOrder = {
  id: "uuid-order-1",
  order_id: "ORD-2026-D6YDZ",
  customer_id: "uuid-cust-1",
  customer_name: "Tyler Colton",
  shop_owner: SHOP,
  subtotal: 384.35,
  tax: 0,
  total: 345.92,
  line_items: [{ id: "li-1", style: "AL2100" }],
  notes: "rush",
  rush_rate: 0.2,
  extras: { dye: true },
  discount: 10,
  tax_rate: 0,
};

describe("buildOrderCompletionPlan — invariant: NEVER deletes the order", () => {
  // The whole reason this helper exists. Joe's invoices on 2026-05-12
  // showed "Order not found" for every completed order because the
  // old Production.jsx handleComplete called Order.delete(). This
  // test is the contract.
  it("returns NO delete action — not orderDelete, not delete, not any 'delete*' key", () => {
    const plan = buildOrderCompletionPlan(baseOrder, { today: TODAY, shopOwner: SHOP });
    const keys = Object.keys(plan);
    for (const key of keys) {
      expect(key.toLowerCase()).not.toMatch(/delete|remove|destroy|drop/);
    }
  });

  it("the returned plan only contains the four expected side effects", () => {
    const plan = buildOrderCompletionPlan(baseOrder, { today: TODAY, shopOwner: SHOP });
    expect(Object.keys(plan).sort()).toEqual([
      "brokerPerformanceCreate",
      "invoiceCreate",
      "orderUpdate",
      "shopPerformanceCreate",
    ]);
  });

  it("orderUpdate is a PATCH not a deletion — sets status='Completed' and completed_date", () => {
    const plan = buildOrderCompletionPlan(baseOrder, { today: TODAY, shopOwner: SHOP });
    expect(plan.orderUpdate.id).toBe(baseOrder.id);
    expect(plan.orderUpdate.patch).toEqual({
      status: "Completed",
      completed_date: TODAY,
    });
  });
});

describe("buildOrderCompletionPlan — invoiceCreate shape", () => {
  it("carries the order's order_id as the FK so View Order works after completion", () => {
    const plan = buildOrderCompletionPlan(baseOrder, { today: TODAY, shopOwner: SHOP });
    expect(plan.invoiceCreate.order_id).toBe(baseOrder.order_id);
  });

  it("inherits customer + money fields from the order", () => {
    const plan = buildOrderCompletionPlan(baseOrder, { today: TODAY, shopOwner: SHOP });
    expect(plan.invoiceCreate).toMatchObject({
      shop_owner: SHOP,
      customer_id: baseOrder.customer_id,
      customer_name: baseOrder.customer_name,
      subtotal: baseOrder.subtotal,
      tax: baseOrder.tax,
      total: baseOrder.total,
      line_items: baseOrder.line_items,
      notes: baseOrder.notes,
      rush_rate: baseOrder.rush_rate,
      extras: baseOrder.extras,
      discount: baseOrder.discount,
      tax_rate: baseOrder.tax_rate,
      paid: false,
      status: "Sent",
    });
  });

  it("calculates a 30-day due date from today", () => {
    const plan = buildOrderCompletionPlan(baseOrder, { today: "2026-05-12", shopOwner: SHOP });
    expect(plan.invoiceCreate.due).toBe("2026-06-11");
  });

  it("uses the override invoiceId when supplied (for deterministic tests)", () => {
    const plan = buildOrderCompletionPlan(baseOrder, {
      today: TODAY,
      shopOwner: SHOP,
      invoiceId: "INV-CUSTOM-123",
    });
    expect(plan.invoiceCreate.invoice_id).toBe("INV-CUSTOM-123");
  });

  it("generates an INV- prefixed id when invoiceId is omitted", () => {
    const plan = buildOrderCompletionPlan(baseOrder, { today: TODAY, shopOwner: SHOP });
    expect(plan.invoiceCreate.invoice_id).toMatch(/^INV-\d{4}-[A-Z0-9]{5}$/);
  });

  it("handles missing money fields by defaulting to 0 (no NaN to the database)", () => {
    const sparse = { ...baseOrder, subtotal: undefined, tax: null, total: undefined };
    const plan = buildOrderCompletionPlan(sparse, { today: TODAY, shopOwner: SHOP });
    expect(plan.invoiceCreate.subtotal).toBe(0);
    expect(plan.invoiceCreate.tax).toBe(0);
    expect(plan.invoiceCreate.total).toBe(0);
  });
});

describe("buildOrderCompletionPlan — brokerPerformanceCreate", () => {
  it("is null when the order has no broker_id (direct shop sale)", () => {
    const plan = buildOrderCompletionPlan(baseOrder, { today: TODAY, shopOwner: SHOP });
    expect(plan.brokerPerformanceCreate).toBeNull();
  });

  it("is populated when broker_id is present", () => {
    const brokerOrder = { ...baseOrder, broker_id: "broker-1", broker_name: "Acme Reps" };
    const plan = buildOrderCompletionPlan(brokerOrder, { today: TODAY, shopOwner: SHOP });
    expect(plan.brokerPerformanceCreate).toEqual({
      broker_id: "broker-1",
      shop_owner: SHOP,
      order_id: baseOrder.order_id,
      customer_name: baseOrder.customer_name,
      date: TODAY,
      total: baseOrder.total,
    });
  });
});

describe("buildOrderCompletionPlan — shopPerformanceCreate", () => {
  it("is always present (the canonical analytics record)", () => {
    const plan = buildOrderCompletionPlan(baseOrder, { today: TODAY, shopOwner: SHOP });
    expect(plan.shopPerformanceCreate).toBeTruthy();
    expect(plan.shopPerformanceCreate.status).toBe("Completed");
    expect(plan.shopPerformanceCreate.total).toBe(baseOrder.total);
    expect(plan.shopPerformanceCreate.shop_owner).toBe(SHOP);
    expect(plan.shopPerformanceCreate.order_id).toBe(baseOrder.order_id);
  });

  it("carries the broker_id when present (so broker analytics roll up correctly)", () => {
    const brokerOrder = { ...baseOrder, broker_id: "broker-1" };
    const plan = buildOrderCompletionPlan(brokerOrder, { today: TODAY, shopOwner: SHOP });
    expect(plan.shopPerformanceCreate.broker_id).toBe("broker-1");
  });

  it("uses empty string (not null) for broker_id when missing — matches the existing schema", () => {
    const plan = buildOrderCompletionPlan(baseOrder, { today: TODAY, shopOwner: SHOP });
    expect(plan.shopPerformanceCreate.broker_id).toBe("");
  });
});

describe("buildOrderCompletionPlan — defensive guards", () => {
  it("throws when order is missing", () => {
    expect(() => buildOrderCompletionPlan(null, { today: TODAY, shopOwner: SHOP })).toThrow(
      /order required/,
    );
  });

  it("throws when order.id is missing — required for the update", () => {
    const noId = { ...baseOrder, id: undefined };
    expect(() => buildOrderCompletionPlan(noId, { today: TODAY, shopOwner: SHOP })).toThrow(
      /order\.id required/,
    );
  });

  it("throws when order.order_id is missing — invoice would orphan otherwise", () => {
    const noOrderId = { ...baseOrder, order_id: undefined };
    expect(() => buildOrderCompletionPlan(noOrderId, { today: TODAY, shopOwner: SHOP })).toThrow(
      /order\.order_id required/,
    );
  });

  it("throws when today is missing", () => {
    expect(() => buildOrderCompletionPlan(baseOrder, { shopOwner: SHOP })).toThrow(/today required/);
  });

  it("throws when shopOwner is missing — refuses to write tenant-less rows", () => {
    expect(() => buildOrderCompletionPlan(baseOrder, { today: TODAY })).toThrow(
      /shopOwner required/,
    );
  });
});

describe("buildOrderCompletionPlan — purity", () => {
  it("does not mutate the input order", () => {
    const snapshot = JSON.parse(JSON.stringify(baseOrder));
    buildOrderCompletionPlan(baseOrder, { today: TODAY, shopOwner: SHOP });
    expect(baseOrder).toEqual(snapshot);
  });

  it("returns the same plan shape for the same input (with invoiceId pinned)", () => {
    const opts = { today: TODAY, shopOwner: SHOP, invoiceId: "INV-PIN-001" };
    const a = buildOrderCompletionPlan(baseOrder, opts);
    const b = buildOrderCompletionPlan(baseOrder, opts);
    expect(a).toEqual(b);
  });
});

describe("COMPLETED_ORDER_STATUS export", () => {
  it("is exactly the string 'Completed' — matches the schema CHECK and the DB trigger", () => {
    expect(COMPLETED_ORDER_STATUS).toBe("Completed");
  });
});
