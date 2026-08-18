import { describe, it, expect } from "vitest";
import { toCustomerFacingQuote, isBrokerQuote } from "../customerFacingQuote.js";

describe("isBrokerQuote", () => {
  it("true when broker_id / broker_email present", () => {
    expect(isBrokerQuote({ broker_id: "b@x.com" })).toBe(true);
    expect(isBrokerQuote({ broker_email: "b@x.com" })).toBe(true);
  });
  it("false for a direct shop quote", () => {
    expect(isBrokerQuote({ shop_owner: "s@x.com" })).toBe(false);
    expect(isBrokerQuote(null)).toBe(false);
  });
});

describe("toCustomerFacingQuote", () => {
  it("is a no-op for non-broker quotes", () => {
    const q = { subtotal: 100, total: 108, line_items: [{ _ppp: 5 }] };
    expect(toCustomerFacingQuote(q)).toBe(q);
  });

  it("overwrites broker wholesale totals with the client-facing values (kills the leak)", () => {
    const q = {
      broker_id: "b@x.com",
      subtotal: 100,        // broker wholesale (cost)
      total: 108,
      tax: 8,
      client_subtotal: 130, // what the end client pays (retail)
      client_total: 140,
      client_tax: 10,
      broker_tax_rate: 7.5,
      tax_rate: 8.25,
      line_items: [{ _ppp: 5, _lineTotal: 50, _client_ppp: 6.5, _client_lineTotal: 65 }],
    };
    const out = toCustomerFacingQuote(q);
    // Standard fields now carry the RETAIL numbers — wholesale is gone from them.
    expect(out.subtotal).toBe(130);
    expect(out.total).toBe(140);
    expect(out.tax).toBe(10);
    expect(out.tax_rate).toBe(7.5);
    expect(out.line_items[0]._ppp).toBe(6.5);
    expect(out.line_items[0]._lineTotal).toBe(65);
    // Broker identity preserved (needed to show the broker as merchant of record).
    expect(out.broker_id).toBe("b@x.com");
  });

  it("falls back to broker-side values when client_* are missing (renders numbers, not zero)", () => {
    const q = { broker_id: "b@x.com", subtotal: 100, total: 108, line_items: [] };
    const out = toCustomerFacingQuote(q);
    expect(out.subtotal).toBe(100);
    expect(out.total).toBe(108);
  });
});

// ── Zero-fallback regression (broker audit 2026-08-17) ──────────────────────
// client_* columns are NOT NULL DEFAULT 0 with no backfill, so an unstamped
// broker quote carries 0, not NULL. `??` alone never fell back, and this
// helper handed callers $0 totals — createCheckoutSession then refused the
// charge ("Nothing to charge") or, worse, would have charged the fallback.
// The client-side port has this `> 0` gate; the server port was missing it.
describe("unstamped client totals fall back to broker totals", () => {
  const unstamped = {
    broker_id: "b@x.co",
    subtotal: 500, tax: 0, total: 500,
    client_subtotal: 0, client_tax: 0, client_total: 0,
    line_items: [],
  };
  it("keeps broker-side totals when client_total is the DEFAULT 0", () => {
    const out = toCustomerFacingQuote(unstamped);
    expect(out.total).toBe(500);
    expect(out.subtotal).toBe(500);
  });
  it("still swaps when client totals are genuinely stamped", () => {
    const out = toCustomerFacingQuote({
      ...unstamped, client_subtotal: 580, client_tax: 20, client_total: 600,
    });
    expect(out.total).toBe(600);
    expect(out.subtotal).toBe(580);
    expect(out.tax).toBe(20);
  });
  it("non-broker quotes pass through untouched regardless of client_* defaults", () => {
    const out = toCustomerFacingQuote({ total: 375, client_total: 0, line_items: [] });
    expect(out.total).toBe(375);
  });
});
