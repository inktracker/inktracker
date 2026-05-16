// End-to-end "numbers match" assertion across the full revenue
// pipeline: Quote → Order → Invoice.
//
// Each link has its own unit tests. This file pins the CONTRACT
// BETWEEN LINKS — what the customer was promised in the email
// flows verbatim through every downstream artifact. If anything
// breaks the chain (a future refactor changes effectiveQuoteTotals,
// buildOrderFromQuote drops a field, buildOrderCompletionPlan
// recomputes, etc) these tests fail loud at PR time.

import { describe, it, expect } from "vitest";
import { buildOrderFromQuote } from "../orders/buildOrderFromQuote.js";
import { buildOrderCompletionPlan } from "../orders/completeOrder.js";
import { effectiveQuoteTotals } from "../quotes/effectiveTotals.js";

const SHOP = "shop@example.test";
const NOW = new Date("2026-05-15T12:00:00Z").getTime();
const TODAY = "2026-05-15";

function savedQuote(overrides = {}) {
  // A quote AFTER send — totals stamped on the row at editor save
  // time. This is the only state the chain ever sees in production:
  // the customer doesn't see a draft, the order doesn't get built
  // from one.
  return {
    id: "q-uuid-1",
    quote_id: "Q-2026-CHAIN",
    customer_id: "cust-1",
    customer_name: "Acme Co",
    customer_email: "buyer@acme.test",
    date: "2026-05-10",
    due_date: "2026-05-25",
    line_items: [
      {
        id: "li-1",
        style: "1717",
        garmentCost: "4.62",
        garmentColor: "Black",
        sizes: { M: "50" },
        imprints: [{ id: "imp-1", location: "Front", colors: 1, technique: "Screen Print" }],
        _ppp: 11.00,
        _lineTotal: 550.00,
        _rushFee: 0,
      },
    ],
    rush_rate: 0,
    extras: {},
    discount: 0,
    discount_type: "percent",
    tax_rate: 8.25,
    paid: false,
    deposit_paid: false,
    // The numbers customers actually saw / paid:
    subtotal: 550.00,
    tax: 45.38,
    total: 595.38,
    ...overrides,
  };
}

describe("Chain integrity: Quote → Order → Invoice", () => {
  it("CI1 — saved quote totals carry to the order verbatim", () => {
    const quote = savedQuote();
    const order = buildOrderFromQuote(quote, { userEmail: SHOP, now: NOW });
    expect(order.subtotal).toBe(quote.subtotal);
    expect(order.tax).toBe(quote.tax);
    expect(order.total).toBe(quote.total);
  });

  it("CI2 — order totals carry to the generated invoice verbatim", () => {
    const quote = savedQuote();
    const order = buildOrderFromQuote(quote, { userEmail: SHOP, now: NOW });
    const plan = buildOrderCompletionPlan(
      { ...order, id: "order-uuid-1" },
      { today: TODAY, shopOwner: SHOP, invoiceId: "INV-TEST" },
    );
    expect(plan.invoiceCreate.subtotal).toBe(quote.subtotal);
    expect(plan.invoiceCreate.tax).toBe(quote.tax);
    expect(plan.invoiceCreate.total).toBe(quote.total);
  });

  it("CI3 — full chain: quote total === invoice total (the bottom-line contract)", () => {
    // This is the assertion the shop owner cares about. If this
    // fails, the cash collected via Stripe doesn't match the AR
    // booked in QB. It's the entire reason "numbers match" is the
    // highest-stakes invariant in CLAUDE.md.
    const quote = savedQuote();
    const order = buildOrderFromQuote(quote, { userEmail: SHOP, now: NOW });
    const plan = buildOrderCompletionPlan(
      { ...order, id: "order-uuid-1" },
      { today: TODAY, shopOwner: SHOP, invoiceId: "INV-TEST" },
    );
    expect(plan.invoiceCreate.total).toBe(quote.total);
  });

  it("CI4 — chain holds for broker quotes (tax_rate=0, broker pricing)", () => {
    const quote = savedQuote({
      broker_id: "broker@x.test",
      broker_name: "Broker Inc",
      tax_rate: 0,
      subtotal: 480,
      tax: 0,
      total: 480, // broker-marked-up totals saved on the quote
    });
    const order = buildOrderFromQuote(quote, { userEmail: SHOP, now: NOW });
    const plan = buildOrderCompletionPlan(
      { ...order, id: "order-uuid-1" },
      { today: TODAY, shopOwner: SHOP, invoiceId: "INV-BROKER" },
    );
    expect(order.total).toBe(480);
    expect(order.tax_rate).toBe(0);
    expect(plan.invoiceCreate.total).toBe(480);
  });

  it("CI5 — chain holds with rush + discount + tax saved on the quote", () => {
    // Worst-case shape: every fee/discount bucket exercised, then
    // the totals stamped on the row. The chain must preserve every
    // dollar of every bucket.
    const quote = savedQuote({
      rush_rate: 0.15,
      discount: 5,
      discount_type: "percent",
      tax_rate: 8.25,
      subtotal: 800,
      tax: 62.70,
      total: 862.70,
    });
    const order = buildOrderFromQuote(quote, { userEmail: SHOP, now: NOW });
    const plan = buildOrderCompletionPlan(
      { ...order, id: "order-uuid-1" },
      { today: TODAY, shopOwner: SHOP, invoiceId: "INV-WORST" },
    );
    expect(plan.invoiceCreate.subtotal).toBe(800);
    expect(plan.invoiceCreate.tax).toBe(62.70);
    expect(plan.invoiceCreate.total).toBe(862.70);
  });

  it("CI6 — pricing config changing between send and convert does NOT change order total", () => {
    // The drift scenario in the wild: shop sends a quote, customer
    // pays $595.38 via Stripe link. Two weeks later the shop edits
    // their pricing config (raises markups). Today's live recompute
    // of the same quote would produce a different total. The order
    // must STILL show $595.38 — what the customer paid.
    //
    // We simulate "pricing config has drifted" by feeding a quote
    // whose live recompute would produce a different number than
    // the saved total. effectiveQuoteTotals must pick saved.
    const quote = savedQuote({
      subtotal: 999.00, // saved value (customer-paid)
      tax: 0,
      total: 999.00,
      // Line items would compute to ~$595 live — but we trust saved.
    });
    const order = buildOrderFromQuote(quote, { userEmail: SHOP, now: NOW });
    expect(order.total).toBe(999.00);

    // Bonus: confirm effectiveQuoteTotals reports 'saved' so any
    // future regression where the chain falls back to live would
    // be visible at this assertion.
    expect(effectiveQuoteTotals(quote).source).toBe("saved");
  });

  it("CI7 — when an existing invoice is linked (not generated), no new total math runs at all", () => {
    // The dedup path: handleComplete found an existing invoice (e.g.
    // the SendQuoteModal QB push already created one and the sync
    // pulled it back). Plan should LINK the existing invoice to
    // the order, NOT generate a new one with potentially-different
    // numbers. The link path is the safest because it never re-
    // computes anything.
    const quote = savedQuote();
    const order = buildOrderFromQuote(quote, { userEmail: SHOP, now: NOW });
    const existing = { id: "inv-existing-uuid", total: quote.total };
    const plan = buildOrderCompletionPlan(
      { ...order, id: "order-uuid-1" },
      { today: TODAY, shopOwner: SHOP, existingInvoice: existing },
    );
    expect(plan.invoiceCreate).toBe(null);
    expect(plan.invoiceLink).toEqual({
      id: "inv-existing-uuid",
      patch: { order_id: order.order_id },
    });
  });
});
