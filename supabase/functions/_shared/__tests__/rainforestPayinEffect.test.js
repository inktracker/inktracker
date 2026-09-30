import { describe, it, expect } from "vitest";
import {
  planPayinEffect,
  planQbApplication,
  statusAdvances,
  PAYIN_EVENT,
  REJECT,
} from "../rainforestPayinEffect.js";
import { buildQbPaymentBody } from "../rainforestQbBooks.js";

const account = { shop_owner: "joe@biotamfg.co", merchant_id: "mid_biota", enabled: true };
const quote = {
  id: "q-uuid",
  quote_id: "Q-2026-TGC4",
  shop_owner: "joe@biotamfg.co",
  qb_invoice_id: "3815",
  qb_deposit_invoice_id: null,
};
const ev = (over = {}) => ({
  kind: PAYIN_EVENT.SUCCEEDED,
  payinId: "pyi_1",
  merchantId: "mid_biota",
  amountCents: 228482,
  method: "card",
  occurredAt: "2026-10-02T17:00:00Z",
  metadata: {
    inktracker_quote_id: "q-uuid",
    quote_number: "Q-2026-TGC4",
    shop_owner: "joe@biotamfg.co",
    qb_invoice_id: "3815",
    pay_kind: "full",
  },
  ...over,
});
const plan = (over = {}) => planPayinEffect({ event: ev(), account, quote, ledger: null, platformFeeCents: 6832, ...over });

describe("statusAdvances — statuses only move forward", () => {
  it("allows progress, blocks regressions and same-rank flips", () => {
    expect(statusAdvances(null, "processing")).toBe(true);
    expect(statusAdvances("processing", "succeeded")).toBe(true);
    expect(statusAdvances("succeeded", "processing")).toBe(false);
    expect(statusAdvances("succeeded", "succeeded")).toBe(false);
    expect(statusAdvances("succeeded", "failed")).toBe(false);
    expect(statusAdvances("succeeded", "refunded")).toBe(true);
    expect(statusAdvances("disputed", "charged_back")).toBe(true);
    expect(statusAdvances("charged_back", "disputed")).toBe(false);
    expect(statusAdvances(null, "made_up")).toBe(false);
  });
});

describe("planPayinEffect — a matched successful payment", () => {
  it("records it and posts the QB Payment (QuickBooks' own webhook then runs the paid pipeline)", () => {
    const r = plan();
    expect(r.ok).toBe(true);
    expect(r.postQbPayment).toBe(true);
    expect(r.ledger).toMatchObject({
      processor_payin_id: "pyi_1",
      shop_owner: "joe@biotamfg.co",
      status: "succeeded",
      quote_id: "q-uuid",
      qb_invoice_id: "3815",
      pay_kind: "full",
      amount_cents: 228482,
      platform_fee_cents: 6832,
      method: "card",
    });
  });

  it("a replayed success is a no-op once QuickBooks has it", () => {
    const r = plan({ ledger: { status: "succeeded", qb_payment_id: "501" } });
    expect(r).toMatchObject({ ok: true, ledger: null, postQbPayment: false });
  });

  it("a replayed success RETRIES the QB post if it never landed", () => {
    const r = plan({ ledger: { status: "succeeded", qb_payment_id: null } });
    expect(r).toMatchObject({ ok: true, ledger: null, postQbPayment: true });
  });

  it("a late 'processing' after success changes nothing", () => {
    const r = plan({ event: ev({ kind: "processing" }), ledger: { status: "succeeded", qb_payment_id: "501" } });
    expect(r).toMatchObject({ ok: true, ledger: null, postQbPayment: false });
  });

  it("bank payment processing → recorded, NOT posted to QuickBooks yet", () => {
    const r = plan({ event: ev({ kind: "processing", method: "ach" }) });
    expect(r.ledger.status).toBe("processing");
    expect(r.postQbPayment).toBe(false);
  });

  it("deposit payments carry through as deposits", () => {
    const q = { ...quote, qb_invoice_id: null, qb_deposit_invoice_id: "3900" };
    const r = plan({ quote: q, event: ev({ metadata: { ...ev().metadata, qb_invoice_id: "3900", pay_kind: "deposit" } }) });
    expect(r.ok).toBe(true);
    expect(r.ledger).toMatchObject({ qb_invoice_id: "3900", pay_kind: "deposit" });
  });
});

describe("planPayinEffect — never trust the metadata alone", () => {
  it("unknown merchant → nothing written, ops alerted", () => {
    const r = plan({ account: null });
    expect(r).toMatchObject({ ok: false, reject: REJECT.UNKNOWN_MERCHANT, ledger: null, postQbPayment: false });
    expect(r.alertOps).toMatch(/no shop owns/);
    expect(plan({ account: { ...account, merchant_id: "mid_other" } }).reject).toBe(REJECT.UNKNOWN_MERCHANT);
  });

  it("metadata claiming another shop → recorded against the merchant's shop, not posted, shop alerted", () => {
    const r = plan({ event: ev({ metadata: { ...ev().metadata, shop_owner: "other@shop.com" } }) });
    expect(r.reject).toBe(REJECT.SHOP_MISMATCH);
    expect(r.postQbPayment).toBe(false);
    expect(r.ledger).toMatchObject({ shop_owner: "joe@biotamfg.co", quote_id: null, status: "succeeded" });
    expect(r.notify.title).toMatch(/needs matching/);
  });

  it("quote belonging to another shop → rejected", () => {
    expect(plan({ quote: { ...quote, shop_owner: "other@shop.com" } }).reject).toBe(REJECT.SHOP_MISMATCH);
  });

  it("quote deleted → money still recorded + shop told", () => {
    const r = plan({ quote: null });
    expect(r.reject).toBe(REJECT.QUOTE_NOT_FOUND);
    expect(r.ledger.status).toBe("succeeded");
    expect(r.notify.body).toMatch(/NOT recorded in QuickBooks/);
  });

  it("quote re-invoiced since the customer opened the page → not posted to the wrong invoice", () => {
    const r = plan({ quote: { ...quote, qb_invoice_id: "4000" } });
    expect(r.reject).toBe(REJECT.INVOICE_MISMATCH);
    expect(r.postQbPayment).toBe(false);
  });

  it("failed events on unmatched quotes are logged without a shop alert", () => {
    const r = plan({ quote: null, event: ev({ kind: "failed" }) });
    expect(r.notify).toBeNull();
  });

  it("junk events are refused", () => {
    expect(plan({ event: ev({ amountCents: 0 }) }).reject).toBe(REJECT.BAD_EVENT);
    expect(plan({ event: ev({ kind: "bogus" }) }).reject).toBe(REJECT.BAD_EVENT);
    expect(plan({ event: ev({ payinId: "" }) }).reject).toBe(REJECT.BAD_EVENT);
  });
});

describe("planPayinEffect — bad news reaches the shop", () => {
  it("failed bank payment → alert", () => {
    const r = plan({ event: ev({ kind: "failed", method: "ach" }), ledger: { status: "processing" } });
    expect(r.ledger.status).toBe("failed");
    expect(r.notify.title).toMatch(/Bank payment didn't go through/);
    expect(r.postQbPayment).toBe(false);
  });

  it("returned bank payment after success → alert, invoice NOT auto-un-paid", () => {
    const r = plan({ event: ev({ kind: "returned", method: "ach" }), ledger: { status: "succeeded", qb_payment_id: "501" } });
    expect(r.ledger.status).toBe("returned");
    expect(r.notify.severity).toBe("alert");
    expect(r.postQbPayment).toBe(false);
  });

  it("partial refund reports the refunded amount, not the whole payment", () => {
    const r = plan({ event: ev({ kind: "partially_refunded", reversalCents: 5000 }), ledger: { status: "succeeded", qb_payment_id: "501" } });
    expect(r.notify.title).toBe("Refund issued: $50.00 on Q-2026-TGC4");
  });

  it("dispute → alert with what to do", () => {
    const r = plan({ event: ev({ kind: "disputed" }), ledger: { status: "succeeded", qb_payment_id: "501" } });
    expect(r.notify.title).toMatch(/disputed/);
  });
});

describe("overpayment (two payments raced)", () => {
  it("applies up to the balance; the rest stays a customer credit in QuickBooks", () => {
    expect(planQbApplication({ amountCents: 228482, liveBalanceCents: 228482 })).toEqual({ ok: true, applyCents: 228482, unappliedCents: 0, overpaid: false });
    expect(planQbApplication({ amountCents: 228482, liveBalanceCents: 0 })).toEqual({ ok: true, applyCents: 0, unappliedCents: 228482, overpaid: true });
    expect(planQbApplication({ amountCents: 1.5, liveBalanceCents: 0 }).ok).toBe(false);
  });

  it("the QB Payment for a fully-overpaid invoice is an unapplied credit, flagged in the memo", () => {
    const r = buildQbPaymentBody({
      qbInvoiceId: "3815", customerRefValue: "61", amountCents: 228482, applyCents: 0,
      payinId: "pyi_2", txnDate: "2026-10-02",
    });
    expect(r.ok).toBe(true);
    expect(r.body.TotalAmt).toBe(2284.82);
    expect(r.body.Line).toEqual([]);
    expect(r.body.PrivateNote).toMatch(/OVERPAID \$2284\.82/);
    expect(buildQbPaymentBody({ qbInvoiceId: "1", customerRefValue: "1", amountCents: 100, applyCents: 101, payinId: "p", txnDate: "2026-10-02" }).ok).toBe(false);
  });
});
