import { describe, it, expect } from "vitest";
import { planPayoutDeposit, PAYOUT_PLAN } from "../payoutPlan.js";
import { payoutItemsFromBalanceTransactions } from "../stripeWebhookAdapter.js";

// Fixtures are Stripe balance transactions (GET /v1/balance_transactions?payout=…
// with data.source + data.source.payment_intent expanded), run through the
// adapter so the plan is tested against the real shape.
const account = { qb_bank_account_id: "35", qb_fee_account_id: "88" };
const po = (over = {}) => ({ id: "po_1", status: "paid", amountCents: 0, createdAt: "2026-10-03T12:00:00Z", ...over });
const ours = { inktracker_doc_type: "quote", inktracker_quote_id: "q-uuid" };
const charge = (pi, gross, fee, md = ours) => ({
  id: `txn_${pi}`, type: "charge", amount: gross, fee, net: gross - fee,
  source: { id: `ch_${pi}`, object: "charge", payment_intent: { id: pi, metadata: md } },
});
const bankPayment = (pi, gross, fee) => ({ ...charge(pi, gross, fee), type: "payment", source: { id: `py_${pi}`, payment_intent: { id: pi, metadata: ours } } });
const payoutRow = (amt) => ({ id: "txn_po", type: "payout", amount: -amt, fee: 0, source: "po_1" });
const items = (bts) => payoutItemsFromBalanceTransactions(bts);
const ledger = (entries) => new Map(entries.map(([id, qb, amt, inv = "3815"]) => [id, { qb_payment_id: qb, amount_cents: amt, qb_invoice_id: inv }]));
const NOW = new Date("2026-10-04T12:00:00Z");

describe("planPayoutDeposit (Stripe payouts)", () => {
  it("clean payout → QB deposit that equals the bank to the cent; fees = Stripe's + InkTracker's", () => {
    // $1,643 card: QB-matched all-in 2.99% = $49.13. $1,297 bank: 1% = $12.97.
    const bts = [charge("pi_1", 164300, 4913), bankPayment("pi_2", 129700, 1297), payoutRow(164300 + 129700 - 4913 - 1297)];
    const r = planPayoutDeposit({
      payout: po({ amountCents: 164300 + 129700 - 4913 - 1297 }),
      items: items(bts),
      ledgerByPayin: ledger([["pi_1", "501", 164300], ["pi_2", "502", 129700]]),
      account,
    });
    expect(r.plan).toBe(PAYOUT_PLAN.POST);
    expect(r.feeCents).toBe(6210);
    expect(r.body.DepositToAccountRef).toEqual({ value: "35" });
    expect(r.body.TxnDate).toBe("2026-10-03");
    expect(r.body.Line.reduce((s, l) => s + Math.round(l.Amount * 100), 0)).toBe(r.netCents);
    expect(r.payinIds).toEqual(["pi_1", "pi_2"]);
  });

  it("Stripe charges with no sale behind them (bank verification) fold into the fee line", () => {
    const r = planPayoutDeposit({
      payout: po({ amountCents: 100000 - 2990 - 150 }),
      items: items([charge("pi_1", 100000, 2990), { id: "txn_f", type: "stripe_fee", amount: -150, fee: 0, source: null }]),
      ledgerByPayin: ledger([["pi_1", "501", 100000]]),
      account,
    });
    expect(r.plan).toBe(PAYOUT_PLAN.POST);
    expect(r.feeCents).toBe(3140);
  });

  it("a sale the shop took in Stripe outside InkTracker → manual right away, named plainly", () => {
    const r = planPayoutDeposit({
      payout: po({ amountCents: 97010 + 4855 }),
      items: items([charge("pi_1", 100000, 2990), charge("pi_shop", 5000, 145, { order_id: "shopify-1001" })]),
      ledgerByPayin: ledger([["pi_1", "501", 100000]]),
      account,
    });
    expect(r.plan).toBe(PAYOUT_PLAN.MANUAL);
    expect(r.problems).toEqual(["A $50.00 sale taken in Stripe outside InkTracker."]);
  });

  it("a payment not in QuickBooks yet → wait (the sweep retries)", () => {
    const r = planPayoutDeposit({ payout: po({ amountCents: 97010 }), items: items([charge("pi_1", 100000, 2990)]), ledgerByPayin: ledger([["pi_1", null, 100000]]), account });
    expect(r).toEqual({ plan: PAYOUT_PLAN.WAIT, reason: "payment_not_yet_in_quickbooks" });
  });

  it("refunds, bank returns, disputes → manual with a plain breakdown", () => {
    const r = planPayoutDeposit({
      payout: po({ amountCents: 1000 }),
      items: items([
        charge("pi_1", 100000, 2990),
        { id: "txn_r", type: "refund", amount: -5000, fee: 0, source: { id: "re_1" } },
        { id: "txn_d", type: "adjustment", amount: 3000, fee: 0, source: { id: "du_1" } },
        { id: "txn_a", type: "payment_failure_refund", amount: -2000, fee: 0, source: { id: "pyr_1" } },
      ]),
      ledgerByPayin: ledger([["pi_1", "501", 100000]]),
      account,
    });
    expect(r.plan).toBe(PAYOUT_PLAN.MANUAL);
    expect(r.problems).toEqual(["A refund of $50.00.", "A dispute reversed in your favour ($30.00 back).", "A returned bank payment of $20.00."]);
    expect(r.notify.title).toBe("Payout of $10.00 needs recording in QuickBooks");
    expect(r.notify.metadata).toEqual({ processor: "stripe", payout_id: "po_1" });
  });

  it("amounts that don't add up, or accounts not mapped → manual, never a wrong entry", () => {
    const its = items([charge("pi_1", 100000, 2990)]);
    const led = ledger([["pi_1", "501", 100000]]);
    expect(planPayoutDeposit({ payout: po({ amountCents: 97009 }), items: its, ledgerByPayin: led, account }).plan).toBe(PAYOUT_PLAN.MANUAL);
    expect(planPayoutDeposit({ payout: po({ amountCents: 97010 }), items: its, ledgerByPayin: led, account: {} }).problems[0]).toMatch(/Setup needed/);
    expect(planPayoutDeposit({ payout: po({ amountCents: 97010 }), items: items([charge("pi_1", 99999, 2990)]), ledgerByPayin: led, account }).plan).toBe(PAYOUT_PLAN.MANUAL);
  });

  it("not paid yet → skip; unknown item types → manual", () => {
    expect(planPayoutDeposit({ payout: po({ status: "in_transit" }), items: [], ledgerByPayin: new Map(), account }).plan).toBe(PAYOUT_PLAN.SKIP);
    const r = planPayoutDeposit({ payout: po({ amountCents: 500 }), items: items([{ id: "t", type: "transfer", amount: 500, fee: 0 }]), ledgerByPayin: new Map(), account });
    expect(r.problems).toEqual(["An item Stripe labels transfer ($5.00)."]);
  });
});

describe("audit: waiting payouts have an end state", () => {
  const its = items([charge("pi_1", 100000, 2990)]);
  it("an InkTracker payment not in our ledger yet → WAIT (the backstop recovers it)", () => {
    expect(planPayoutDeposit({ payout: po({ amountCents: 97010, createdAt: "2026-10-03T12:00:00Z" }), items: its, ledgerByPayin: new Map(), account, now: NOW }).plan).toBe(PAYOUT_PLAN.WAIT);
  });
  it("still waiting after 5 days → the shop is asked to record it", () => {
    const r = planPayoutDeposit({ payout: po({ amountCents: 97010, createdAt: "2026-09-25T12:00:00Z" }), items: its, ledgerByPayin: ledger([["pi_1", null, 100000]]), account, now: NOW });
    expect(r.plan).toBe(PAYOUT_PLAN.MANUAL);
    expect(r.problems[0]).toMatch(/not yet recorded in QuickBooks/);
  });
  it("a payment that never matched an invoice → manual right away (it will never be booked)", () => {
    const r = planPayoutDeposit({ payout: po({ amountCents: 97010, createdAt: "2026-10-03T12:00:00Z" }), items: its, ledgerByPayin: ledger([["pi_1", null, 100000, null]]), account, now: NOW });
    expect(r.plan).toBe(PAYOUT_PLAN.MANUAL);
  });
});
