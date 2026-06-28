import { describe, it, expect } from "vitest";
import { toCustomerFacingQuote, isBrokerQuote, customerFacingShopName, customerFacingTotals } from "../customerFacingQuote";

describe("customerFacingTotals — broker wholesale must never reach the end client", () => {
  const fb = { fallbackTax: 12, fallbackTotal: 162 };

  it("non-broker with a QB invoice → QB numbers are authoritative", () => {
    expect(customerFacingTotals({ qb_total: 200, qb_tax_amount: 15 }, { qbStale: false, ...fb }))
      .toEqual({ tax: 15, total: 200, isQbAuthoritative: true });
  });

  it("non-broker but qb is STALE → fall back to saved totals", () => {
    expect(customerFacingTotals({ qb_total: 200, qb_tax_amount: 15 }, { qbStale: true, ...fb }))
      .toEqual({ tax: 12, total: 162, isQbAuthoritative: false });
  });

  it("non-broker with no QB invoice → fall back", () => {
    expect(customerFacingTotals({}, fb)).toEqual({ tax: 12, total: 162, isQbAuthoritative: false });
  });

  it("BROKER quote with a QB invoice → NEVER uses qb_total (the leak fix)", () => {
    // qb_total here is the shop→broker wholesale ($646); the end client must
    // see the client total ($753 = fallbackTotal), never $646.
    expect(customerFacingTotals(
      { broker_id: "bo@x.com", qb_total: 646, qb_tax_amount: 50 },
      { qbStale: false, fallbackTax: 62, fallbackTotal: 753 },
    )).toEqual({ tax: 62, total: 753, isQbAuthoritative: false });
  });

  it("broker detection via broker_email also suppresses qb_total", () => {
    expect(customerFacingTotals(
      { broker_email: "bo@x.com", qb_total: 646 }, { fallbackTotal: 753 },
    ).isQbAuthoritative).toBe(false);
  });
});

describe("isBrokerQuote", () => {
  it("true when broker_id is set", () => {
    expect(isBrokerQuote({ broker_id: "bo@example.com" })).toBe(true);
  });
  it("true when broker_email is set", () => {
    expect(isBrokerQuote({ broker_email: "bo@example.com" })).toBe(true);
  });
  it("false when neither broker field is set", () => {
    expect(isBrokerQuote({ shop_owner: "shop@example.com" })).toBe(false);
  });
  it("false for null / undefined", () => {
    expect(isBrokerQuote(null)).toBe(false);
    expect(isBrokerQuote(undefined)).toBe(false);
  });
});

describe("toCustomerFacingQuote — broker quotes", () => {
  // Mirrors the 2026-05-26 bug: $646 broker price vs $753 client price
  // for Q-2026-OEVBS. The customer-facing surfaces (email body, payment
  // page) were showing the wrong number.
  const brokerQuote = {
    broker_id: "bo@example.com",
    subtotal:        646.00,
    tax:             0,
    total:           646.00,
    tax_rate:        0,
    client_subtotal: 753.00,
    client_tax:      0,
    client_total:    753.00,
    broker_tax_rate: 0,
    line_items: [
      {
        id: "li-1",
        _ppp:               12.92,
        _lineTotal:         646.00,
        _rushFee:           0,
        _client_ppp:        15.06,
        _client_lineTotal:  753.00,
        _client_rushFee:    0,
      },
    ],
  };

  it("BQ1 — top-level totals swap to client_* values", () => {
    const facing = toCustomerFacingQuote(brokerQuote);
    expect(facing.subtotal).toBe(753.00);
    expect(facing.tax).toBe(0);
    expect(facing.total).toBe(753.00);
  });

  it("BQ2 — line item stamps swap _client_* onto _* fields", () => {
    const facing = toCustomerFacingQuote(brokerQuote);
    expect(facing.line_items[0]._ppp).toBe(15.06);
    expect(facing.line_items[0]._lineTotal).toBe(753.00);
  });

  it("BQ3 — tax_rate swaps to broker_tax_rate", () => {
    const facing = toCustomerFacingQuote({ ...brokerQuote, broker_tax_rate: 8.25 });
    expect(facing.tax_rate).toBe(8.25);
  });

  it("BQ4 — returns a NEW object; saved row is not mutated", () => {
    const original = JSON.parse(JSON.stringify(brokerQuote));
    const facing = toCustomerFacingQuote(brokerQuote);
    expect(facing).not.toBe(brokerQuote);
    expect(facing.line_items[0]).not.toBe(brokerQuote.line_items[0]);
    expect(brokerQuote).toEqual(original); // unmodified
  });

  it("BQ5 — falls back to broker-side values when client_* is missing (legacy)", () => {
    // Legacy broker quote without client_* fields stamped — render
    // something instead of NaN/undefined.
    const legacy = {
      broker_id: "bo@example.com",
      subtotal: 500,
      tax: 0,
      total: 500,
      line_items: [{ id: "x", _ppp: 10, _lineTotal: 500 }],
    };
    const facing = toCustomerFacingQuote(legacy);
    expect(facing.total).toBe(500);
    expect(facing.subtotal).toBe(500);
    expect(facing.line_items[0]._ppp).toBe(10);
  });
});

describe("toCustomerFacingQuote — non-broker quotes", () => {
  it("BQ6 — non-broker quote is returned unchanged", () => {
    const regular = {
      shop_owner: "shop@example.com",
      subtotal: 500,
      tax: 40,
      total: 540,
      tax_rate: 8,
      line_items: [{ id: "x", _ppp: 10, _lineTotal: 500 }],
    };
    const facing = toCustomerFacingQuote(regular);
    // For non-broker quotes the function short-circuits and returns the
    // same reference — saves a clone and keeps reasoning simple.
    expect(facing).toBe(regular);
  });
});

describe("toCustomerFacingQuote — defensive", () => {
  it("BQ7 — null / undefined returns input unchanged", () => {
    expect(toCustomerFacingQuote(null)).toBe(null);
    expect(toCustomerFacingQuote(undefined)).toBe(undefined);
  });
});

// ─────────────────────────────────────────────────────────────────────
// customerFacingShopName — the brand the end client sees
// ─────────────────────────────────────────────────────────────────────

describe("customerFacingShopName (CFSN)", () => {
  it("CFSN1 — direct shop quote → shopName as-is", () => {
    expect(customerFacingShopName({
      quote: { shop_owner: "shop@x.com" },
      shopName: "Print Shop",
      fallback: "Shop",
    })).toBe("Print Shop");
  });

  it("CFSN2 — direct shop quote with empty shopName → fallback", () => {
    expect(customerFacingShopName({
      quote: { shop_owner: "shop@x.com" },
      shopName: "",
      fallback: "Shop",
    })).toBe("Shop");
  });

  it("CFSN3 — broker quote with broker_company → broker_company wins", () => {
    // The 2026-05-31 case: end client sees the broker, not the shop.
    expect(customerFacingShopName({
      quote: {
        shop_owner: "shop@x.com",
        broker_id: "b1",
        broker_email: "broker@x.com",
        broker_company: "BrokerCo",
        broker_name: "Jane Doe",
      },
      shopName: "Print Shop",
      fallback: "Shop",
    })).toBe("BrokerCo");
  });

  it("CFSN4 — broker quote without broker_company → broker_name", () => {
    expect(customerFacingShopName({
      quote: {
        broker_id: "b1",
        broker_name: "Jane Doe",
      },
      shopName: "Print Shop",
      fallback: "Shop",
    })).toBe("Jane Doe");
  });

  it("CFSN5 — broker quote with all broker fields blank → falls to shopName, NOT fallback", () => {
    // Defensive: better to show the print shop's name than "Shop" if
    // the broker entity is mis-configured. Operator can fix later.
    expect(customerFacingShopName({
      quote: {
        broker_id: "b1",
        broker_company: "",
        broker_name: "",
      },
      shopName: "Print Shop",
      fallback: "Shop",
    })).toBe("Print Shop");
  });

  it("CFSN6 — broker quote with everything blank → fallback (last resort)", () => {
    expect(customerFacingShopName({
      quote: { broker_id: "b1" },
      shopName: "",
      fallback: "Shop",
    })).toBe("Shop");
  });

  it("CFSN7 — non-broker quote ignores stale broker_* fields", () => {
    // A quote that USED to be a broker quote but was unlinked: id and
    // email are clear, but the company name might linger. Don't surface
    // a name from a dissolved broker relationship.
    expect(customerFacingShopName({
      quote: {
        shop_owner: "shop@x.com",
        broker_company: "Stale BrokerCo",
        broker_name: "Stale Name",
      },
      shopName: "Print Shop",
      fallback: "Shop",
    })).toBe("Print Shop");
  });

  it("CFSN8 — broker gate uses broker_email alone (no broker_id needed)", () => {
    expect(customerFacingShopName({
      quote: {
        broker_email: "broker@x.com",
        broker_name: "Jane Doe",
      },
      shopName: "Print Shop",
      fallback: "Shop",
    })).toBe("Jane Doe");
  });

  it("CFSN9 — null quote → just shopName / fallback (no crash)", () => {
    expect(customerFacingShopName({
      quote: null, shopName: "Print Shop", fallback: "Shop",
    })).toBe("Print Shop");
    expect(customerFacingShopName({
      quote: null, shopName: "", fallback: "Shop",
    })).toBe("Shop");
  });

  it("CFSN10 — fallback defaults to 'Shop' when caller omits it", () => {
    expect(customerFacingShopName({ quote: null, shopName: "" })).toBe("Shop");
  });

  it("CFSN11 — fallback is caller-supplied so different surfaces can have different defaults", () => {
    // /QuotePayment uses "Shop", email uses "Your Shop", body templates
    // use "the shop". Caller picks the in-context default.
    expect(customerFacingShopName({ quote: null, shopName: "", fallback: "Your Shop" }))
      .toBe("Your Shop");
    expect(customerFacingShopName({ quote: null, shopName: "", fallback: "the shop" }))
      .toBe("the shop");
  });
});
