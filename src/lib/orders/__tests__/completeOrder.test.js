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

  it("the returned plan only contains the five expected side-effect slots", () => {
    const plan = buildOrderCompletionPlan(baseOrder, { today: TODAY, shopOwner: SHOP });
    expect(Object.keys(plan).sort()).toEqual([
      "brokerPerformanceCreate",
      "invoiceCreate",
      "invoiceLink",
      "orderUpdate",
      "shopPerformanceCreate",
    ]);
  });

  it("when no existing invoice: invoiceCreate is populated, invoiceLink is null", () => {
    const plan = buildOrderCompletionPlan(baseOrder, { today: TODAY, shopOwner: SHOP });
    expect(plan.invoiceCreate).not.toBeNull();
    expect(plan.invoiceLink).toBeNull();
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

describe("buildOrderCompletionPlan — existing invoice: link instead of create", () => {
  // Joe's 2026-05-12 dup bug: a quote was sent via QB (creating a
  // QB invoice + InkTracker invoice row with invoice_id = quote_id,
  // order_id = null) and then the order was completed, which
  // created a SECOND invoice row. Now the caller pre-fetches the
  // existing invoice and we link to it instead of duplicating.

  const existingInvoice = {
    id: "uuid-inv-from-qb",
    invoice_id: "Q-2026-VBII",
    shop_owner: SHOP,
    order_id: null,
    qb_invoice_id: "3616",
    total: 345.92,
  };

  it("returns invoiceLink (not invoiceCreate) when existingInvoice is provided", () => {
    const plan = buildOrderCompletionPlan(baseOrder, {
      today: TODAY,
      shopOwner: SHOP,
      existingInvoice,
    });
    expect(plan.invoiceCreate).toBeNull();
    expect(plan.invoiceLink).toEqual({
      id: "uuid-inv-from-qb",
      patch: { order_id: baseOrder.order_id },
    });
  });

  it("invoiceLink only sets order_id on the existing invoice (doesn't touch other fields)", () => {
    const plan = buildOrderCompletionPlan(baseOrder, {
      today: TODAY,
      shopOwner: SHOP,
      existingInvoice,
    });
    // Existing invoice already has its own totals + customer + qb_invoice_id
    // — we don't overwrite any of that. Just link to the order.
    expect(Object.keys(plan.invoiceLink.patch)).toEqual(["order_id"]);
  });

  it("orderUpdate still fires when linking (the order still becomes Completed)", () => {
    const plan = buildOrderCompletionPlan(baseOrder, {
      today: TODAY,
      shopOwner: SHOP,
      existingInvoice,
    });
    expect(plan.orderUpdate).toEqual({
      id: baseOrder.id,
      patch: { status: "Completed", completed_date: TODAY },
    });
  });

  it("broker + shop performance rows still fire (analytics rollup is independent)", () => {
    const plan = buildOrderCompletionPlan(
      { ...baseOrder, broker_id: "broker-1" },
      { today: TODAY, shopOwner: SHOP, existingInvoice },
    );
    expect(plan.brokerPerformanceCreate).not.toBeNull();
    expect(plan.shopPerformanceCreate).not.toBeNull();
    expect(plan.shopPerformanceCreate.status).toBe("Completed");
  });

  it("ignores existingInvoice without an id (defensive — treats as no existing invoice)", () => {
    const plan = buildOrderCompletionPlan(baseOrder, {
      today: TODAY,
      shopOwner: SHOP,
      existingInvoice: { invoice_id: "Q-2026-VBII" /* no id */ },
    });
    expect(plan.invoiceCreate).not.toBeNull();
    expect(plan.invoiceLink).toBeNull();
  });

  it("invariant: exactly one of invoiceCreate / invoiceLink is populated (never both, never neither)", () => {
    // Without existing invoice
    const planFresh = buildOrderCompletionPlan(baseOrder, { today: TODAY, shopOwner: SHOP });
    expect(Boolean(planFresh.invoiceCreate) !== Boolean(planFresh.invoiceLink)).toBe(true);

    // With existing invoice
    const planLink = buildOrderCompletionPlan(baseOrder, {
      today: TODAY, shopOwner: SHOP, existingInvoice,
    });
    expect(Boolean(planLink.invoiceCreate) !== Boolean(planLink.invoiceLink)).toBe(true);
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
