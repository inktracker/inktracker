import { describe, it, expect } from "vitest";
import {
  depositDocNumber,
  isDepositDocNumber,
  computeDepositAmount,
  shouldMintDepositInvoice,
  buildDepositInvoiceBody,
  DEPOSIT_SETTLE,
  decideDepositSettlement,
  paymentsLinkedToInvoice,
  buildPaymentRelinkBody,
  buildDepositPaidPatch,
  isDepositInvoicePaid,
} from "../qbDeposit.js";

describe("depositDocNumber", () => {
  it("appends -DEP within QBO's 21-char DocNumber cap", () => {
    expect(depositDocNumber("Q-2026-AB12")).toBe("Q-2026-AB12-DEP");
    expect(depositDocNumber("Q-2026-AB12").length).toBeLessThanOrEqual(21);
  });
  it("clamps pathological ids so the suffix always fits", () => {
    const doc = depositDocNumber("X".repeat(40));
    expect(doc.length).toBe(21);
    expect(doc.endsWith("-DEP")).toBe(true);
  });
});

describe("isDepositDocNumber (pullInvoices skip contract)", () => {
  it("matches the base and DocNumber-collision revisions", () => {
    expect(isDepositDocNumber("Q-2026-AB12-DEP")).toBe(true);
    expect(isDepositDocNumber("Q-2026-AB12-DEP-r2")).toBe(true);
  });
  it("never matches ordinary invoices or -rN revisions", () => {
    expect(isDepositDocNumber("Q-2026-AB12")).toBe(false);
    expect(isDepositDocNumber("Q-2026-AB12-r2")).toBe(false);
    expect(isDepositDocNumber("")).toBe(false);
    expect(isDepositDocNumber(null)).toBe(false);
  });
});

describe("computeDepositAmount — snapshot-first", () => {
  it("the snapshot wins over pct-derivation (order edits change the remainder, not the deposit)", () => {
    expect(computeDepositAmount({ deposit_amount: 125.5, deposit_pct: 50, total: 1000 })).toBe(125.5);
  });
  it("falls back to total × pct for pre-snapshot rows", () => {
    expect(computeDepositAmount({ deposit_pct: 50, total: 999.99 })).toBe(500.0);
    expect(computeDepositAmount({ deposit_pct: 25, total: 100 })).toBe(25);
  });
  it("clamps pct into [0,100] and returns 0 when nothing is requested", () => {
    expect(computeDepositAmount({ deposit_pct: 150, total: 100 })).toBe(100);
    expect(computeDepositAmount({ deposit_pct: 0, total: 100 })).toBe(0);
    expect(computeDepositAmount({})).toBe(0);
    expect(computeDepositAmount(null)).toBe(0);
  });
});

describe("shouldMintDepositInvoice", () => {
  it("true only for an unpaid requested deposit", () => {
    expect(shouldMintDepositInvoice({ deposit_pct: 50, total: 100, deposit_paid: false })).toBe(true);
    expect(shouldMintDepositInvoice({ deposit_pct: 50, total: 100, deposit_paid: true })).toBe(false);
    expect(shouldMintDepositInvoice({ deposit_pct: 0, total: 100 })).toBe(false);
    expect(shouldMintDepositInvoice(null)).toBe(false);
  });
});

describe("buildDepositInvoiceBody", () => {
  const body = buildDepositInvoiceBody({
    qbCustomerId: "42", docNumber: "Q-1-DEP", itemId: "7", amount: 250.005,
    quoteId: "Q-1", depositPct: 50, billEmail: "c@x.com", txnDate: "2026-08-12",
  });
  it("one NON-taxed line — the deposit is a prepayment, tax lands on the final invoice", () => {
    expect(body.Line).toHaveLength(1);
    expect(body.Line[0].SalesItemLineDetail.TaxCodeRef.value).toBe("NON");
  });
  it("amount rounded to cents on both Amount and UnitPrice", () => {
    expect(body.Line[0].Amount).toBe(250.01);
    expect(body.Line[0].SalesItemLineDetail.UnitPrice).toBe(250.01);
  });
  it("online payment enabled + due on receipt (same as the main create path)", () => {
    expect(body.AllowOnlineCreditCardPayment).toBe(true);
    expect(body.AllowOnlineACHPayment).toBe(true);
    expect(body.DueDate).toBe("2026-08-12");
  });
  it("omits BillEmail when none provided", () => {
    const noEmail = buildDepositInvoiceBody({ qbCustomerId: "1", docNumber: "D", itemId: "2", amount: 10, quoteId: "Q", txnDate: "2026-08-12" });
    expect(noEmail.BillEmail).toBeUndefined();
  });
});

describe("decideDepositSettlement", () => {
  it("paid (or partially paid) → MOVE_AND_VOID with the collected amount", () => {
    expect(decideDepositSettlement({ TotalAmt: 500, Balance: 0 }))
      .toEqual({ action: DEPOSIT_SETTLE.MOVE_AND_VOID, collected: 500 });
    expect(decideDepositSettlement({ TotalAmt: 500, Balance: 200 }))
      .toEqual({ action: DEPOSIT_SETTLE.MOVE_AND_VOID, collected: 300 });
  });
  it("untouched → VOID_UNPAID", () => {
    expect(decideDepositSettlement({ TotalAmt: 500, Balance: 500 }).action).toBe(DEPOSIT_SETTLE.VOID_UNPAID);
  });
  it("voided (TotalAmt 0) or missing → ALREADY_GONE (retry landed)", () => {
    expect(decideDepositSettlement({ TotalAmt: 0, Balance: 0 }).action).toBe(DEPOSIT_SETTLE.ALREADY_GONE);
    expect(decideDepositSettlement(null).action).toBe(DEPOSIT_SETTLE.ALREADY_GONE);
  });
  it("sub-cent residue reads as unpaid, not collected", () => {
    expect(decideDepositSettlement({ TotalAmt: 500, Balance: 499.995 }).action).toBe(DEPOSIT_SETTLE.VOID_UNPAID);
  });
});

describe("paymentsLinkedToInvoice", () => {
  const pay = (id, txnId) => ({ Id: id, Line: [{ Amount: 1, LinkedTxn: [{ TxnType: "Invoice", TxnId: txnId }] }] });
  it("filters by LinkedTxn invoice id, string/number tolerant", () => {
    const found = paymentsLinkedToInvoice([pay("1", "9"), pay("2", "8"), pay("3", 9)], "9");
    expect(found.map((p) => p.Id)).toEqual(["1", "3"]);
  });
  it("ignores non-invoice LinkedTxns and malformed payments", () => {
    const weird = { Id: "4", Line: [{ LinkedTxn: [{ TxnType: "CreditMemo", TxnId: "9" }] }] };
    expect(paymentsLinkedToInvoice([weird, {}, null], "9")).toEqual([]);
  });
});

describe("buildPaymentRelinkBody", () => {
  const payment = {
    Id: "55", SyncToken: "2", TotalAmt: 250,
    Line: [
      { Amount: 250, LinkedTxn: [{ TxnType: "Invoice", TxnId: "100" }] },
      { Amount: 0, LinkedTxn: [{ TxnType: "Invoice", TxnId: "999" }] },
    ],
  };
  it("re-points only the deposit invoice's lines; other applications untouched", () => {
    const body = buildPaymentRelinkBody(payment, "100", "200");
    expect(body.Line[0].LinkedTxn[0].TxnId).toBe("200");
    expect(body.Line[1].LinkedTxn[0].TxnId).toBe("999");
    expect(body.sparse).toBe(false);
    expect(body.Id).toBe("55");
    expect(body.SyncToken).toBe("2");
  });
  it("returns null when nothing points at the deposit invoice (no pointless QB write)", () => {
    expect(buildPaymentRelinkBody(payment, "777", "200")).toBeNull();
  });
});

describe("buildDepositPaidPatch", () => {
  it("flips the flags and snapshots what QB actually collected", () => {
    const p = buildDepositPaidPatch({ collected: 250.004, nowIso: "2026-08-12T00:00:00Z" });
    expect(p).toEqual({
      deposit_paid: true,
      deposit_paid_at: "2026-08-12T00:00:00Z",
      payment_status: "Deposit Paid",
      deposit_amount: 250,
    });
  });
  it("omits the snapshot when QB reports zero collected (never zero out a real snapshot)", () => {
    const p = buildDepositPaidPatch({ collected: 0, nowIso: "t" });
    expect(p.deposit_amount).toBeUndefined();
  });
});

describe("isDepositInvoicePaid", () => {
  it("same balance-zero contract as the rest of the app", () => {
    expect(isDepositInvoicePaid({ TotalAmt: 100, Balance: 0 })).toBe(true);
    expect(isDepositInvoicePaid({ TotalAmt: 100, Balance: 50 })).toBe(false);
    expect(isDepositInvoicePaid({ TotalAmt: 0, Balance: 0 })).toBe(false);
    expect(isDepositInvoicePaid({ TotalAmt: 100 })).toBe(false);
    expect(isDepositInvoicePaid(null)).toBe(false);
  });
});
