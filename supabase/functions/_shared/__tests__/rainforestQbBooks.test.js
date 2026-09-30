import { describe, it, expect } from "vitest";
import {
  pickQbPaymentMethod,
  buildQbPaymentBody,
  buildQbDepositBody,
  planReversal,
  findBookedPayment,
} from "../rainforestQbBooks.js";

// Biota's real QuickBooks payment methods (pulled 2026-09-30).
const BIOTA_METHODS = [
  { Id: "1", Name: "Cash", Type: "NON_CREDIT_CARD" },
  { Id: "2", Name: "Check", Type: "NON_CREDIT_CARD" },
  { Id: "3", Name: "Credit Card", Type: "CREDIT_CARD" },
  { Id: "7", Name: "ACH", Type: "NON_CREDIT_CARD" },
  { Id: "8", Name: "QuickBooks Payments-Bank", Type: "NON_CREDIT_CARD" },
  { Id: "9", Name: "QuickBooks Payments-Credit Card", Type: "CREDIT_CARD" },
];

describe("pickQbPaymentMethod", () => {
  it("maps card → Credit Card and bank → ACH, never the QuickBooks Payments methods", () => {
    expect(pickQbPaymentMethod(BIOTA_METHODS, "card")).toEqual({ value: "3", name: "Credit Card" });
    expect(pickQbPaymentMethod(BIOTA_METHODS, "ach")).toEqual({ value: "7", name: "ACH" });
  });
  it("falls back to any non-QB-Payments credit-card type, else null", () => {
    expect(pickQbPaymentMethod([{ Id: "5", Name: "Amex", Type: "CREDIT_CARD" }], "card")).toEqual({ value: "5", name: "Amex" });
    expect(pickQbPaymentMethod([{ Id: "9", Name: "QuickBooks Payments-Credit Card", Type: "CREDIT_CARD" }], "card")).toBeNull();
    expect(pickQbPaymentMethod([], "ach")).toBeNull();
    expect(pickQbPaymentMethod(null, "card")).toBeNull();
  });
});

describe("buildQbPaymentBody", () => {
  const base = {
    qbInvoiceId: "3815",
    customerRefValue: "61",
    amountCents: 228482,
    payinId: "pyi_2abcDEFghiJKLmnoPQRstuVWX",
    txnDate: "2026-10-02",
    paymentMethodRef: { value: "3" },
    platformFeeCents: 6832,
  };

  it("posts the GROSS amount linked to the invoice, into Undeposited Funds", () => {
    const r = buildQbPaymentBody(base);
    expect(r.ok).toBe(true);
    expect(r.body.TotalAmt).toBe(2284.82);
    expect(r.body.Line).toEqual([{ Amount: 2284.82, LinkedTxn: [{ TxnId: "3815", TxnType: "Invoice" }] }]);
    expect(r.body.CustomerRef).toEqual({ value: "61" });
    expect(r.body.PaymentMethodRef).toEqual({ value: "3" });
    expect(r.body.DepositToAccountRef).toBeUndefined();
    expect(r.body.TxnDate).toBe("2026-10-02");
  });

  it("keeps the processor id for dedupe (ref num capped at QB's 21 chars) and in the memo in full", () => {
    const r = buildQbPaymentBody(base);
    expect(r.body.PaymentRefNum.length).toBeLessThanOrEqual(21);
    expect(base.payinId.endsWith(r.body.PaymentRefNum)).toBe(true);
    expect(r.body.PrivateNote).toContain(base.payinId);
    expect(r.body.PrivateNote).toContain("$68.32");
  });

  it("refuses rather than posting something wrong", () => {
    expect(buildQbPaymentBody({ ...base, qbInvoiceId: "" }).ok).toBe(false);
    expect(buildQbPaymentBody({ ...base, customerRefValue: null }).ok).toBe(false);
    expect(buildQbPaymentBody({ ...base, amountCents: 0 }).ok).toBe(false);
    expect(buildQbPaymentBody({ ...base, amountCents: 12.5 }).ok).toBe(false);
    expect(buildQbPaymentBody({ ...base, payinId: "" }).ok).toBe(false);
    expect(buildQbPaymentBody({ ...base, txnDate: "10/02/2026" }).ok).toBe(false);
  });

  it("omits the payment method when the shop has none to map", () => {
    expect(buildQbPaymentBody({ ...base, paymentMethodRef: null }).body.PaymentMethodRef).toBeUndefined();
  });
});

describe("buildQbDepositBody — the deposit must equal what hit the bank", () => {
  const ok = {
    bankAccountId: "35",
    feeAccountId: "88",
    txnDate: "2026-10-03",
    payoutId: "po_123",
    payments: [
      { qbPaymentId: "501", grossCents: 228482 },
      { qbPaymentId: "502", grossCents: 129700 },
    ],
    feeCents: 6832 + 1297,
    netCents: 228482 + 129700 - (6832 + 1297),
  };

  it("links each payment and books fees as one negative line", () => {
    const r = buildQbDepositBody(ok);
    expect(r.ok).toBe(true);
    expect(r.body.DepositToAccountRef).toEqual({ value: "35" });
    expect(r.body.Line).toEqual([
      { Amount: 2284.82, LinkedTxn: [{ TxnId: "501", TxnType: "Payment", TxnLineId: "0" }] },
      { Amount: 1297, LinkedTxn: [{ TxnId: "502", TxnType: "Payment", TxnLineId: "0" }] },
      { Amount: -81.29, DetailType: "DepositLineDetail", Description: "Processing fees — payout po_123", DepositLineDetail: { AccountRef: { value: "88" } } },
    ]);
    const sum = r.body.Line.reduce((s, l) => s + Math.round(l.Amount * 100), 0);
    expect(sum).toBe(ok.netCents);
  });

  it("REFUSES when payments − fees ≠ what hit the bank", () => {
    const r = buildQbDepositBody({ ...ok, netCents: ok.netCents - 1 });
    expect(r).toMatchObject({ ok: false, reason: "does_not_match_bank" });
  });

  it("includes signed adjustments (e.g. a refund) and still has to match the bank", () => {
    const withRefund = { ...ok, adjustments: [{ amountCents: -5000, accountId: "4", memo: "Refund Q-2026-TGC4" }], netCents: ok.netCents - 5000 };
    const r = buildQbDepositBody(withRefund);
    expect(r.ok).toBe(true);
    expect(r.body.Line.at(-1)).toMatchObject({ Amount: -50, Description: "Refund Q-2026-TGC4" });
    expect(buildQbDepositBody({ ...withRefund, netCents: ok.netCents }).reason).toBe("does_not_match_bank");
  });

  it("won't post until every payment in the payout is already in QuickBooks", () => {
    expect(buildQbDepositBody({ ...ok, payments: [{ qbPaymentId: null, grossCents: 100 }] }).reason).toBe("payment_not_yet_in_quickbooks");
  });

  it("needs the shop's bank and fee accounts mapped", () => {
    expect(buildQbDepositBody({ ...ok, bankAccountId: "" }).reason).toBe("no_bank_account_mapped");
    expect(buildQbDepositBody({ ...ok, feeAccountId: "" }).reason).toBe("no_fee_account_mapped");
  });

  it("zero fees → no fee line", () => {
    const r = buildQbDepositBody({ ...ok, feeCents: 0, netCents: 228482 + 129700 });
    expect(r.body.Line).toHaveLength(2);
  });

  it("refuses junk", () => {
    expect(buildQbDepositBody({ ...ok, payments: [] }).reason).toBe("no_payments");
    expect(buildQbDepositBody({ ...ok, feeCents: -1 }).reason).toBe("invalid_fee_or_net");
    expect(buildQbDepositBody({ ...ok, txnDate: "tomorrow" }).reason).toBe("invalid_date");
    expect(buildQbDepositBody({ ...ok, adjustments: [{ amountCents: 1 }] }).reason).toBe("invalid_adjustment");
  });
});

describe("planReversal", () => {
  it("refunds are informational; returns and lost chargebacks are alerts", () => {
    expect(planReversal({ kind: "refund", amountCents: 5000, payinId: "p", quoteNumber: "Q-1" }))
      .toMatchObject({ ok: true, ledgerStatus: "refunded", notify: { severity: "info" } });
    expect(planReversal({ kind: "ach_return", amountCents: 5000, payinId: "p", quoteNumber: "Q-1" }))
      .toMatchObject({ ok: true, ledgerStatus: "returned", notify: { severity: "alert" } });
    expect(planReversal({ kind: "chargeback_lost", amountCents: 5000, payinId: "p" }).notify.title)
      .toBe("Chargeback lost: $50.00 on a payment");
  });
  it("refuses unknown kinds and bad amounts", () => {
    expect(planReversal({ kind: "gift", amountCents: 1 }).ok).toBe(false);
    expect(planReversal({ kind: "refund", amountCents: 0 }).ok).toBe(false);
  });
});

describe("findBookedPayment", () => {
  it("matches by ref number (last 21 chars) or the full payin id in the memo", () => {
    const id = "pyi_2abcDEFghiJKLmnoPQRstuVWX";
    expect(findBookedPayment([{ Id: "1", PaymentRefNum: "x" }, { Id: "2", PaymentRefNum: id.slice(-21) }], id).Id).toBe("2");
    expect(findBookedPayment([{ Id: "3", PrivateNote: `Paid online via InkTracker (Rainforest payment ${id})` }], id).Id).toBe("3");
    expect(findBookedPayment([{ Id: "4", PaymentRefNum: "1234" }], id)).toBeNull();
    expect(findBookedPayment(null, id)).toBeNull();
    expect(findBookedPayment([{ Id: "5", PaymentRefNum: "" }], "")).toBeNull();
  });
});
