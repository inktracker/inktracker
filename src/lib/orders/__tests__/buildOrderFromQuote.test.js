import { describe, it, expect } from "vitest";
import {
  buildOrderFromQuote,
  buildQuoteConvertedPatch,
  generateOrderId,
} from "../buildOrderFromQuote";

const NOW = new Date("2026-05-12T12:00:00.000Z").getTime();

function baseQuote(overrides = {}) {
  return {
    id: "q-uuid-1",
    quote_id: "Q-2026-ABC12",
    customer_id: "cust-1",
    customer_name: "Acme Co",
    customer_email: "acme@example.com",
    job_title: "Summer tees",
    date: "2026-05-10",
    due_date: "2026-05-25",
    line_items: [
      {
        id: "li-1",
        style: "1717",
        brand: "Comfort Colors",
        garmentCost: "4.62",
        garmentColor: "Black",
        sizes: { M: "50" },
        imprints: [{ id: "imp-1", location: "Front", colors: 1, technique: "Screen Print" }],
      },
    ],
    notes: "Rush job",
    rush_rate: 0,
    extras: {},
    discount: 0,
    discount_type: "percent",
    tax_rate: 8.25,
    paid: false,
    deposit_paid: false,
    selected_artwork: [{ id: "art-1" }],
    ...overrides,
  };
}

describe("generateOrderId", () => {
  it("produces an ORD- prefixed id with year and a 5-char base36 suffix", () => {
    const id = generateOrderId(NOW);
    expect(id).toMatch(/^ORD-2026-[A-Z0-9]{5}$/);
  });

  it("is deterministic for a given now", () => {
    expect(generateOrderId(NOW)).toBe(generateOrderId(NOW));
  });
});

describe("buildOrderFromQuote — the audit-trail invariants", () => {
  it("sets quote_id from quote.quote_id (so OrderDetailModal can link back)", () => {
    const order = buildOrderFromQuote(baseQuote(), { userEmail: "shop@x.com", now: NOW });
    expect(order.quote_id).toBe("Q-2026-ABC12");
  });

  it("carries deposit_paid forward — does NOT reset to false", () => {
    const q = baseQuote({ deposit_paid: true });
    const order = buildOrderFromQuote(q, { userEmail: "shop@x.com", now: NOW });
    expect(order.deposit_paid).toBe(true);
  });

  it("carries customer_email forward (defends against later customer renames)", () => {
    const order = buildOrderFromQuote(baseQuote(), { userEmail: "shop@x.com", now: NOW });
    expect(order.customer_email).toBe("acme@example.com");
  });

  it("emits empty string (not undefined) when source fields are missing", () => {
    const order = buildOrderFromQuote(
      { customer_id: "c-1", customer_name: "X", line_items: [] },
      { userEmail: "shop@x.com", now: NOW },
    );
    expect(order.quote_id).toBe("");
    expect(order.customer_email).toBe("");
    expect(order.deposit_paid).toBe(false);
  });
});

describe("buildOrderFromQuote — broker quotes", () => {
  function brokerQuote(overrides = {}) {
    return baseQuote({
      broker_id: "broker@example.com",
      broker_name: "Broker Inc",
      broker_company: "Broker Inc",
      ...overrides,
    });
  }

  it("uses broker name as the order's customer_name", () => {
    const order = buildOrderFromQuote(brokerQuote(), { userEmail: "shop@x.com", now: NOW });
    expect(order.customer_name).toBe("Broker Inc");
    expect(order.broker_client_name).toBe("Acme Co");
  });

  it("zeroes out tax_rate (broker markup absorbs tax)", () => {
    const order = buildOrderFromQuote(brokerQuote({ tax_rate: 8.25 }), {
      userEmail: "shop@x.com",
      now: NOW,
    });
    expect(order.tax_rate).toBe(0);
  });

  it("falls back through broker_name → broker_company → broker_id → customer_name", () => {
    const order = buildOrderFromQuote(
      baseQuote({ broker_id: "b@x.com", broker_name: "", broker_company: "" }),
      { userEmail: "shop@x.com", now: NOW },
    );
    expect(order.customer_name).toBe("b@x.com");
  });

  it("non-broker quote: broker_client_name is empty string", () => {
    const order = buildOrderFromQuote(baseQuote(), { userEmail: "shop@x.com", now: NOW });
    expect(order.broker_client_name).toBe("");
    expect(order.tax_rate).toBe(8.25);
  });
});

describe("buildOrderFromQuote — order defaults", () => {
  it("sets status to 'Art Approval' (start of the pipeline)", () => {
    const order = buildOrderFromQuote(baseQuote(), { userEmail: "shop@x.com", now: NOW });
    expect(order.status).toBe("Art Approval");
  });

  it("defaults discount_type to percent when missing", () => {
    const q = baseQuote({ discount_type: undefined });
    const order = buildOrderFromQuote(q, { userEmail: "shop@x.com", now: NOW });
    expect(order.discount_type).toBe("percent");
  });

  it("preserves explicit discount_type='flat'", () => {
    const q = baseQuote({ discount_type: "flat" });
    const order = buildOrderFromQuote(q, { userEmail: "shop@x.com", now: NOW });
    expect(order.discount_type).toBe("flat");
  });

  it("computes subtotal/tax/total via calcQuoteTotals (single source of truth)", () => {
    const order = buildOrderFromQuote(baseQuote(), { userEmail: "shop@x.com", now: NOW });
    expect(typeof order.subtotal).toBe("number");
    expect(typeof order.tax).toBe("number");
    expect(typeof order.total).toBe("number");
    expect(order.total).toBeGreaterThan(0);
  });

  it("survives a null quote (no crash, sane shape)", () => {
    const order = buildOrderFromQuote(null, { userEmail: "shop@x.com", now: NOW });
    expect(order.status).toBe("Art Approval");
    expect(order.quote_id).toBe("");
    expect(order.shop_owner).toBe("shop@x.com");
  });
});

describe("buildOrderFromQuote — numbers-match contract (saved totals win over live recompute)", () => {
  // The customer-facing source of truth is what the email said: the
  // saved quote.total at send time. If the shop changes pricing
  // config (or anything in the live calc chain) between send and
  // convert, a fresh recompute will diverge from what the customer
  // actually paid. The order MUST inherit the saved customer-facing
  // total, not a stale-config recompute.

  it("uses saved quote.total when present, NOT a recompute that disagrees", () => {
    // Saved total $999 reflects what was emailed + what the customer
    // paid via Stripe. If we recomputed and got $850, the order would
    // show $850 and the invoice would too — but the cash collected
    // was $999. That's a $149 reconciliation gap.
    const quote = baseQuote({
      // line_items here would live-compute to ~$XX, but the SAVED
      // total $999 reflects the customer-facing price the shop sent.
      subtotal: 923,
      tax: 76,
      total: 999,
    });
    const order = buildOrderFromQuote(quote, { userEmail: "shop@x.com", now: NOW });
    expect(order.total).toBe(999);
    expect(order.subtotal).toBe(923);
    expect(order.tax).toBe(76);
  });

  it("falls back to live recompute when saved totals are missing (new quotes)", () => {
    // First conversion of a quote that was created and converted in
    // one session may not yet have saved totals on the row. The
    // live calc must still produce a sensible answer.
    const quote = baseQuote();
    delete quote.subtotal;
    delete quote.tax;
    delete quote.total;
    const order = buildOrderFromQuote(quote, { userEmail: "shop@x.com", now: NOW });
    expect(order.total).toBeGreaterThan(0);
    expect(typeof order.subtotal).toBe("number");
  });

  it("treats total=0 as 'no saved total' (falls back to live calc)", () => {
    // A blank/draft quote may have total=0 but still have line items.
    // Pinning 0 would shortcut the live calc and produce $0 orders,
    // which is exactly the blank-quote bug class.
    const quote = baseQuote({ total: 0, subtotal: 0, tax: 0 });
    const order = buildOrderFromQuote(quote, { userEmail: "shop@x.com", now: NOW });
    expect(order.total).toBeGreaterThan(0);
  });

  it("broker quotes still respect saved totals (tax_rate forced to 0 separately)", () => {
    // Broker quotes have their own pricing path but the saved-totals
    // contract is the same — what was emailed wins.
    const quote = baseQuote({
      broker_id: "broker@x.com",
      broker_name: "Broker Inc",
      tax_rate: 8.25,           // ignored on output (broker rule)
      subtotal: 500,
      tax: 0,                   // brokers don't charge tax
      total: 500,
    });
    const order = buildOrderFromQuote(quote, { userEmail: "shop@x.com", now: NOW });
    expect(order.total).toBe(500);
    expect(order.tax_rate).toBe(0);     // broker rule still applies
  });
});

describe("buildQuoteConvertedPatch — preserve the original quote", () => {
  it("returns the patch used to mark a quote as converted (never deleted)", () => {
    const patch = buildQuoteConvertedPatch("ORD-2026-XYZ12", { now: NOW });
    expect(patch).toEqual({
      status: "Converted to Order",
      converted_order_id: "ORD-2026-XYZ12",
      converted_at: "2026-05-12T12:00:00.000Z",
    });
  });

  it("invariant: status is always 'Converted to Order' (not 'Approved' or anything else)", () => {
    // Contract: this status keeps the row out of the active 'Approved' filter
    // but still visible under 'All' for audit lookup.
    const patch = buildQuoteConvertedPatch("ORD-1", { now: NOW });
    expect(patch.status).toBe("Converted to Order");
  });
});
