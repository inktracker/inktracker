import { describe, it, expect } from "vitest";
import {
  planPayinEffect,
  planQbApplication,
  statusAdvances,
  statusesBelow,
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

  it("card captured (processing) → posted right away, like QuickBooks Payments", () => {
    const r = plan({ event: ev({ kind: "processing", method: "card" }) });
    expect(r.ledger.status).toBe("processing");
    expect(r.postQbPayment).toBe(true);
  });

  it("card processing then succeeded → no second post once QuickBooks has it", () => {
    expect(plan({ ledger: { status: "processing", method: "card", qb_payment_id: "501" } }).postQbPayment).toBe(false);
    expect(plan({ ledger: { status: "processing", method: "card", qb_payment_id: null } }).postQbPayment).toBe(true);
  });

  it("card voided after it was booked → alert with the QB payment to delete, nothing auto-deleted", () => {
    const r = plan({ event: ev({ kind: "canceled" }), ledger: { status: "processing", method: "card", qb_payment_id: "501" } });
    expect(r.ledger.status).toBe("canceled");
    expect(r.postQbPayment).toBe(false);
    expect(r.notify.body).toMatch(/payment #501/);
  });

  it("bank payment processing → recorded, NOT posted to QuickBooks yet, shop told it's on the way", () => {
    const r = plan({ event: ev({ kind: "processing", method: "ach" }) });
    expect(r.ledger.status).toBe("processing");
    expect(r.postQbPayment).toBe(false);
    expect(r.notify).toMatchObject({ severity: "info", title: "Bank payment started: $2284.82 for Q-2026-TGC4" });
    // told once — a replayed processing event doesn't repeat it
    expect(plan({ event: ev({ kind: "processing", method: "ach" }), ledger: { status: "processing", method: "ach" } }).notify).toBeNull();
    // card processing is immediate — no "started" notice
    expect(plan({ event: ev({ kind: "processing", method: "card" }) }).notify).toBeNull();
  });

  it("deposit payments carry through as deposits", () => {
    const q = { ...quote, qb_invoice_id: null, qb_deposit_invoice_id: "3900" };
    const r = plan({ quote: q, event: ev({ metadata: { ...ev().metadata, qb_invoice_id: "3900", pay_kind: "deposit" } }) });
    expect(r.ok).toBe(true);
    expect(r.ledger).toMatchObject({ qb_invoice_id: "3900", pay_kind: "deposit" });
  });
});

describe("planPayinEffect — invoice documents", () => {
  it("an invoice payment links the ledger to the invoice row, not a quote", () => {
    const invoiceRow = { id: "inv-uuid", invoice_id: "INV-2026-0042", shop_owner: "joe@biotamfg.co", qb_invoice_id: "3815" };
    const r = plan({ quote: invoiceRow, event: ev({ metadata: { ...ev().metadata, inktracker_doc_type: "invoice", inktracker_quote_id: "inv-uuid" } }) });
    expect(r.ok).toBe(true);
    expect(r.ledger).toMatchObject({ invoice_id: "inv-uuid", quote_id: null });
    const fail = plan({ quote: invoiceRow, event: ev({ kind: "failed", method: "ach", metadata: { ...ev().metadata, inktracker_doc_type: "invoice" } }) });
    expect(fail.notify.title).toBe("Bank payment didn't go through: INV-2026-0042");
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

describe("review fixes: a linked ledger row is the authority", () => {
  const linked = { status: "succeeded", method: "card", qb_payment_id: "501", quote_id: "q-uuid", qb_invoice_id: "3900" };
  const settledQuote = { ...quote, qb_invoice_id: "4100", qb_deposit_invoice_id: null }; // deposit invoice voided at settlement

  it("refund after deposit settlement → still matched, shop told, links untouched", () => {
    const r = plan({ quote: settledQuote, ledger: linked, event: ev({ kind: "partially_refunded", reversalCents: 5000, metadata: { ...ev().metadata, qb_invoice_id: "3900" } }) });
    expect(r.ok).toBe(true);
    expect(r.notify.title).toMatch(/Refund issued: \$50\.00/);
    expect(r.ledger).not.toHaveProperty("quote_id");
    expect(r.ledger).not.toHaveProperty("qb_invoice_id");
  });

  it("dispute on a payment whose document moved → shop is ALWAYS told (deadline)", () => {
    const r = plan({ quote: settledQuote, ledger: linked, event: ev({ kind: "disputed", metadata: { ...ev().metadata, qb_invoice_id: "3900" } }) });
    expect(r.notify.title).toMatch(/disputed/);
  });

  it("card succeeded after settlement (booked at processing) → no false 'NOT recorded' alert", () => {
    const r = plan({ quote: settledQuote, ledger: { ...linked, status: "processing" }, event: ev({ metadata: { ...ev().metadata, qb_invoice_id: "3900" } }) });
    expect(r.ok).toBe(true);
    expect(r.notify).toBeNull();
    expect(r.postQbPayment).toBe(false);
  });

  it("a dispute on an UNMATCHED payment still notifies", () => {
    const r = plan({ quote: null, event: ev({ kind: "disputed" }) });
    expect(r.reject).toBe(REJECT.QUOTE_NOT_FOUND);
    expect(r.notify.title).toMatch(/disputed/);
  });

  it("a second partial refund notifies even though the status doesn't move", () => {
    const r = plan({ ledger: { ...linked, status: "partially_refunded" }, event: ev({ kind: "partially_refunded", reversalCents: 2500 }) });
    expect(r.ledger).toBeNull();
    expect(r.notify.title).toMatch(/\$25\.00/);
  });

  it("a trusted row recorded unmatched (no QB invoice) is never posted", () => {
    const r = plan({ ledger: { status: "processing", method: "card", quote_id: null, invoice_id: null, qb_payment_id: null, qb_invoice_id: null }, event: ev() });
    expect(r.postQbPayment).toBe(true); // not trusted (no links) → re-matched against the document
    const t = plan({ ledger: { status: "processing", method: "card", quote_id: "q-uuid", qb_invoice_id: null }, event: ev() });
    expect(t.postQbPayment).toBe(false);
  });
});

describe("statusesBelow (guarded forward-only update)", () => {
  it("lists only lower-ranked statuses", () => {
    expect(statusesBelow("succeeded").sort()).toEqual(["pending", "processing"]);
    expect(statusesBelow("processing")).toEqual(["pending"]);
    expect(statusesBelow("bogus")).toEqual([]);
  });
});

describe("audit: booking when events arrive out of order", () => {
  it("refund/dispute arriving before the payment was booked → still booked (money did come in)", () => {
    expect(plan({ event: ev({ kind: "partially_refunded", reversalCents: 100 }), ledger: { status: "processing", method: "ach", qb_invoice_id: "3815" } }).postQbPayment).toBe(true);
    expect(plan({ event: ev({ kind: "disputed" }), ledger: null }).postQbPayment).toBe(true);
    // succeeded arriving AFTER a refund (bank payment retried late)
    expect(plan({ event: ev({ method: "ach" }), ledger: { status: "partially_refunded", method: "ach" } }).postQbPayment).toBe(true);
  });
  it("never books on a void, failure or bounce, even if QuickBooks had been down", () => {
    expect(plan({ event: ev({ kind: "canceled" }), ledger: { status: "processing", method: "card" } }).postQbPayment).toBe(false);
    expect(plan({ event: ev({ kind: "failed", method: "ach" }), ledger: { status: "processing", method: "ach" } }).postQbPayment).toBe(false);
    expect(plan({ event: ev({ kind: "returned", method: "ach" }), ledger: { status: "processing", method: "ach" } }).postQbPayment).toBe(false);
  });
});
