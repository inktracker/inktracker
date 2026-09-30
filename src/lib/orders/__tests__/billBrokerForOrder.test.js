import { describe, it, expect, vi, beforeEach } from "vitest";

// buildQBInvoicePayload at BROKER_MARKUP reads the broker line stamps — stub it
// so the test is about the orchestration (guards, payload shaping, write-back),
// not the pricing engine (covered elsewhere).
vi.mock("@/components/shared/pricing", () => ({
  BROKER_MARKUP: 1.2,
  buildQBInvoicePayload: (order) => ({
    lines: (order.line_items || []).map((li) => ({ amount: li._lineTotal || 0 })),
    discountPercent: 15,
    discountAmount: 0,
    discountType: "percent",
    taxPercent: 8.25,
    depositAmount: 0,
  }),
}));

import { billBrokerForOrder } from "../billBrokerForOrder";

const session = { access_token: "tok" };

function mockBase44({ invokeResult, customers = [], freshOrder } = {}) {
  const invoke = vi.fn(async () => invokeResult ?? { data: { qbInvoiceId: "QB-1", qbDocNumber: "ORD-2026-9", paymentLink: "https://pay" } });
  const orderUpdate = vi.fn(async (id, patch) => ({ id, ...patch }));
  const customerCreate = vi.fn(async (row) => ({ id: "cust-new", ...row }));
  // Order.get is the authoritative pre-bill re-read. Default: a fresh row with
  // no invoice id (not yet billed). Pass `freshOrder` to simulate a concurrent
  // bill that landed after the in-memory object was captured.
  const orderGet = vi.fn(async (id) => (freshOrder !== undefined ? freshOrder : { id }));
  return {
    b: {
      functions: { invoke },
      entities: {
        Customer: { filter: vi.fn(async () => customers), create: customerCreate },
        Order: { update: orderUpdate, get: orderGet },
      },
    },
    invoke, orderUpdate, customerCreate, orderGet,
  };
}

const brokerOrder = {
  id: "o1", order_id: "ORD-2026-9", shop_owner: "shop@x.com",
  broker_id: "ethan@ttr.com", broker_email: "ethan@ttr.com",
  broker_company: "TTR Supply", broker_name: "Ethan",
  line_items: [{ _ppp: 12, _lineTotal: 600 }, { _ppp: 8, _lineTotal: 200 }],
};

describe("billBrokerForOrder — guards", () => {
  it("skips a non-broker order", async () => {
    const { b } = mockBase44();
    const r = await billBrokerForOrder({ base44: b, order: { id: "o", line_items: [] }, session });
    expect(r).toEqual({ ok: false, skipped: "not_a_broker_order" });
  });

  it("skips an order already billed (idempotent)", async () => {
    const { b } = mockBase44();
    const r = await billBrokerForOrder({ base44: b, order: { ...brokerOrder, qb_broker_invoice_id: "QB-9" }, session });
    expect(r.skipped).toBe("already_billed");
  });

  it("errors (never throws) when not signed in", async () => {
    const { b } = mockBase44();
    const r = await billBrokerForOrder({ base44: b, order: brokerOrder, session: {} });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/signed in/i);
  });

  it("errors when the order has no line items", async () => {
    const { b } = mockBase44();
    const r = await billBrokerForOrder({ base44: b, order: { ...brokerOrder, line_items: [] }, session });
    expect(r.ok).toBe(false);
  });

  it("re-reads the DB and skips a duplicate when the passed order is STALE", async () => {
    // In-memory order has no invoice id (stale), but the DB row already carries
    // one (completion re-ran, or a retry after the idempotency window closed).
    // The pre-bill re-read wins — the broker is never billed twice.
    const { b, invoke } = mockBase44({ freshOrder: { id: "o1", qb_broker_invoice_id: "QB-EXISTS" } });
    const r = await billBrokerForOrder({ base44: b, order: brokerOrder, session });
    expect(r.skipped).toBe("already_billed");
    expect(r.qbInvoiceId).toBe("QB-EXISTS");
    expect(invoke).not.toHaveBeenCalled(); // no duplicate bill
  });
});

describe("billBrokerForOrder — happy path", () => {
  beforeEach(() => vi.clearAllMocks());

  it("bills the broker at wholesale, no tax, no discount, and stamps the order", async () => {
    const { b, invoke, orderUpdate, customerCreate } = mockBase44();
    const r = await billBrokerForOrder({ base44: b, order: brokerOrder, session });

    expect(r.ok).toBe(true);
    expect(r.qbInvoiceId).toBe("QB-1");

    // A broker customer was created (none existed) and tagged.
    expect(customerCreate).toHaveBeenCalledWith(expect.objectContaining({
      email: "ethan@ttr.com", company: "TTR Supply", is_broker_account: true, shop_owner: "shop@x.com",
    }));

    // The qbSync invoke carried billBroker + a zeroed-tax/discount payload.
    const payload = invoke.mock.calls[0][1];
    expect(payload.action).toBe("createInvoice");
    expect(payload.billBroker).toBe(true);
    expect(payload.noEmail).toBe(true);
    expect(payload.invoicePayload.taxPercent).toBe(0);
    expect(payload.invoicePayload.discountPercent).toBe(0);
    expect(payload.invoicePayload.discountAmount).toBe(0);
    // Wholesale lines came through (600 + 200).
    expect(payload.invoicePayload.lines.reduce((s, l) => s + l.amount, 0)).toBe(800);
    expect(payload.customer.tax_exempt).toBe(true);

    // The id/link landed on the ORDER's own broker columns, not qb_invoice_id.
    expect(orderUpdate).toHaveBeenCalledWith("o1", expect.objectContaining({
      qb_broker_invoice_id: "QB-1",
      qb_broker_payment_link: "https://pay",
    }));
    const patch = orderUpdate.mock.calls[0][1];
    expect(patch).not.toHaveProperty("qb_invoice_id");
  });

  it("reuses an existing broker customer instead of creating a duplicate", async () => {
    const { b, invoke, customerCreate } = mockBase44({
      customers: [{ id: "cust-9", email: "ethan@ttr.com", company: "TTR Supply", is_broker_account: true, qb_customer_id: "QBC-9" }],
    });
    const r = await billBrokerForOrder({ base44: b, order: brokerOrder, session });
    expect(r.ok).toBe(true);
    expect(customerCreate).not.toHaveBeenCalled();
    expect(invoke.mock.calls[0][1].customer.id).toBe("cust-9");
    expect(invoke.mock.calls[0][1].customer.qb_customer_id).toBe("QBC-9");
  });

  it("returns ok:false (never throws) when qbSync returns an error", async () => {
    const { b } = mockBase44({ invokeResult: { data: { error: "QB down" } } });
    const r = await billBrokerForOrder({ base44: b, order: brokerOrder, session });
    expect(r).toEqual({ ok: false, error: "QB down" });
  });
});
