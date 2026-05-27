import { describe, it, expect } from "vitest";
import { toCustomerFacingQuote, isBrokerQuote } from "../customerFacingQuote";

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
