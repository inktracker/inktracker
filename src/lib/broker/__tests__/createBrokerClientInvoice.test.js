import { describe, it, expect, vi, beforeEach } from "vitest";

// Use the REAL toCustomerFacingQuote (so the client-pricing swap is exercised),
// stub buildQBInvoicePayload to echo the lines it was handed so the test can
// assert it received CLIENT-priced lines, not wholesale.
vi.mock("@/components/shared/pricing", () => ({
  buildQBInvoicePayload: (q) => ({
    lines: (q.line_items || []).map((li) => ({ amount: li._lineTotal || 0 })),
    taxPercent: Number(q.tax_rate) || 0,
    discountPercent: 0, discountAmount: 0, depositAmount: 0,
  }),
}));

import { createBrokerClientInvoice } from "../createBrokerClientInvoice";

const session = { access_token: "tok" };

function mockBase44(invokeResult, freshRow) {
  const invoke = vi.fn(async () => invokeResult ?? {
    data: { qbInvoiceId: "BQB-1", qbDocNumber: "Q-2026-9", paymentLink: "https://broker-pay" },
  });
  const quoteUpdate = vi.fn(async (id, patch) => ({ id, ...patch }));
  // Quote.get is the authoritative pre-create re-read. Default: a fresh row with
  // no invoice id (not yet invoiced). Pass `freshRow` to simulate a concurrent
  // invoice that landed after the in-memory object was captured.
  const quoteGet = vi.fn(async (id) => (freshRow !== undefined ? freshRow : { id }));
  return {
    b: { functions: { invoke }, entities: { Quote: { update: quoteUpdate, get: quoteGet } } },
    invoke, quoteUpdate, quoteGet,
  };
}

// A broker quote carrying BOTH price sets. Client price is higher than wholesale.
const brokerQuote = {
  id: "q1", quote_id: "Q-2026-9", shop_owner: "shop@x.com",
  broker_id: "ethan@ttr.com", broker_email: "ethan@ttr.com",
  customer_name: "Acme Co", customer_email: "buyer@acme.com", customer_company: "Acme Co",
  broker_tax_rate: 7,
  line_items: [
    { _ppp: 10, _lineTotal: 500, _client_ppp: 14, _client_lineTotal: 700 },
    { _ppp: 8,  _lineTotal: 200, _client_ppp: 11, _client_lineTotal: 275 },
  ],
  client_total: 1043, client_subtotal: 975, client_tax: 68,
};

describe("createBrokerClientInvoice — guards", () => {
  it("skips a non-broker quote", async () => {
    const { b } = mockBase44();
    expect((await createBrokerClientInvoice({ base44: b, quote: { id: "q", line_items: [] }, session })).skipped)
      .toBe("not_a_broker_quote");
  });
  it("skips when already invoiced (idempotent)", async () => {
    const { b } = mockBase44();
    const r = await createBrokerClientInvoice({ base44: b, quote: { ...brokerQuote, qb_broker_client_invoice_id: "X" }, session });
    expect(r.skipped).toBe("already_invoiced");
  });
  it("errors (never throws) when not signed in", async () => {
    const { b } = mockBase44();
    const r = await createBrokerClientInvoice({ base44: b, quote: brokerQuote, session: {} });
    expect(r.ok).toBe(false);
  });

  it("refuses when the quote has no client pricing (would bill wholesale)", async () => {
    // Legacy/partial broker row: client_total is 0, so toCustomerFacingQuote
    // would fall back to wholesale. Must NOT invoice the client at wholesale.
    const { b, invoke } = mockBase44();
    const noClient = { ...brokerQuote, client_total: 0, client_subtotal: 0 };
    const r = await createBrokerClientInvoice({ base44: b, quote: noClient, session });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no client pricing/i);
    expect(invoke).not.toHaveBeenCalled(); // never reached QB
  });

  it("refuses a partially-stamped quote (a line missing client pricing would bill wholesale)", async () => {
    // client_total > 0 but one qty-bearing line lacks _client_ppp/_client_lineTotal.
    const { b, invoke } = mockBase44();
    const partial = {
      ...brokerQuote,
      line_items: [
        { sizes: { M: 10 }, _ppp: 10, _lineTotal: 500, _client_ppp: 14, _client_lineTotal: 700 },
        { sizes: { L: 5 }, _ppp: 8, _lineTotal: 200 }, // no client stamp
      ],
    };
    const r = await createBrokerClientInvoice({ base44: b, quote: partial, session });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/missing client pricing/i);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("re-reads the DB and skips a duplicate when the passed object is STALE", async () => {
    // The in-memory quote has no invoice id (stale), but the DB row already
    // carries one (a concurrent/earlier send). The pre-create re-read wins and
    // no second invoice is created.
    const { b, invoke } = mockBase44(undefined, { id: "q1", qb_broker_client_invoice_id: "BQB-EXISTS" });
    const r = await createBrokerClientInvoice({ base44: b, quote: brokerQuote, session });
    expect(r.skipped).toBe("already_invoiced");
    expect(r.qbInvoiceId).toBe("BQB-EXISTS");
    expect(invoke).not.toHaveBeenCalled(); // no duplicate created
  });
});

describe("createBrokerClientInvoice — happy path", () => {
  beforeEach(() => vi.clearAllMocks());

  it("invoices the END CLIENT at CLIENT price with the broker's tax, stores on broker-client cols", async () => {
    const { b, invoke, quoteUpdate } = mockBase44();
    const r = await createBrokerClientInvoice({ base44: b, quote: brokerQuote, session });
    expect(r.ok).toBe(true);
    expect(r.qbInvoiceId).toBe("BQB-1");

    const p = invoke.mock.calls[0][1];
    expect(p.action).toBe("createInvoice");
    // CLIENT lines (700 + 275 = 975), NOT wholesale (500 + 200 = 700).
    expect(p.invoicePayload.lines.reduce((s, l) => s + l.amount, 0)).toBe(975);
    // The broker's client tax rate (7), not the shop's tax_rate.
    expect(p.invoicePayload.taxPercent).toBe(7);
    // Tax goes in "self" mode with the broker's exact client tax amount, so it
    // lands correctly even on a free/non-AST QuickBooks (the Truman case:
    // AST returns $0 → planSelfTax pushes the exact tax as its own line and the
    // TOTAL still matches). taxAmount = clientFacing.tax = client_tax (68).
    expect(p.taxMode).toBe("self");
    expect(p.taxAmount).toBe(68);
    // Customer = the end client, with NO id / qb_customer_id (fresh dedup in broker realm).
    expect(p.customer.email).toBe("buyer@acme.com");
    expect(p.customer).not.toHaveProperty("id");
    expect(p.customer).not.toHaveProperty("qb_customer_id");
    // brokerClientInvoice is set SERVER-SIDE (by role), not by the client.
    expect(p).not.toHaveProperty("brokerClientInvoice");

    // Stored on the quote's broker-client columns, never qb_invoice_id.
    const patch = quoteUpdate.mock.calls[0][1];
    expect(patch.qb_broker_client_invoice_id).toBe("BQB-1");
    expect(patch.qb_broker_client_payment_link).toBe("https://broker-pay");
    expect(patch).not.toHaveProperty("qb_invoice_id");
  });

  it("a 0% broker tax rate still sends self-mode with taxAmount 0 (qbSync then applies no tax)", async () => {
    // broker_tax_rate 0 (e.g. the broker left tax off, or a tax-exempt client).
    // We still pass taxMode:"self"/taxAmount:0 — qbSync's couldSelf gate
    // (taxPercent > 0) short-circuits to the no-tax plan, so nothing is added.
    const { b, invoke } = mockBase44();
    const noTax = { ...brokerQuote, broker_tax_rate: 0, client_tax: 0, client_subtotal: 975, client_total: 975 };
    const r = await createBrokerClientInvoice({ base44: b, quote: noTax, session });
    expect(r.ok).toBe(true);
    const p = invoke.mock.calls[0][1];
    expect(p.taxMode).toBe("self");
    expect(p.taxAmount).toBe(0);
    expect(p.invoicePayload.taxPercent).toBe(0);
  });

  it("fail-open (never throws) when qbSync returns an error — send still proceeds", async () => {
    const { b } = mockBase44({ data: { error: "QuickBooks not connected." } });
    const r = await createBrokerClientInvoice({ base44: b, quote: brokerQuote, session });
    expect(r).toEqual({ ok: false, error: "QuickBooks not connected." });
  });
});
