import { describe, it, expect } from "vitest";
import { resolvePaidQuoteUpdate, isPaymentAccountAuthorized } from "../stripePaymentEffect.js";

describe("resolvePaidQuoteUpdate (Stripe payment → quote status)", () => {
  it("full payment on an un-converted quote → Approved and Paid + deposit_paid", () => {
    expect(resolvePaidQuoteUpdate({ status: "Sent", isDeposit: false }))
      .toEqual({ status: "Approved and Paid", deposit_paid: true });
  });

  it("deposit on an un-converted quote → Approved (balance still owed) + deposit_paid", () => {
    expect(resolvePaidQuoteUpdate({ status: "Sent", isDeposit: true }))
      .toEqual({ status: "Approved", deposit_paid: true });
  });

  it("already 'Converted to Order' → only stamps deposit_paid (never rewinds the pipeline)", () => {
    expect(resolvePaidQuoteUpdate({ status: "Converted to Order", isDeposit: false }))
      .toEqual({ deposit_paid: true });
    expect(resolvePaidQuoteUpdate({ status: "Converted to Order", isDeposit: true }).status).toBeUndefined();
  });

  it("has a converted_order_id (even if status lagged) → only deposit_paid, no status write", () => {
    const upd = resolvePaidQuoteUpdate({ status: "Approved", converted_order_id: "ORD-1", isDeposit: false });
    expect(upd).toEqual({ deposit_paid: true });
  });
});

describe("isPaymentAccountAuthorized (Connect: money receiver must own the quote's shop)", () => {
  it("no connected account on the event → allowed (nothing to check here)", () => {
    expect(isPaymentAccountAuthorized({ sessionAccount: undefined, shopAccount: "acct_shop" })).toBe(true);
    expect(isPaymentAccountAuthorized({ sessionAccount: "", shopAccount: null })).toBe(true);
  });

  it("connected account matches the shop's stripe account → allowed", () => {
    expect(isPaymentAccountAuthorized({ sessionAccount: "acct_X", shopAccount: "acct_X" })).toBe(true);
  });

  it("connected account present but shop has none → REJECTED (the cross-shop attack)", () => {
    expect(isPaymentAccountAuthorized({ sessionAccount: "acct_X", shopAccount: null })).toBe(false);
    expect(isPaymentAccountAuthorized({ sessionAccount: "acct_X", shopAccount: undefined })).toBe(false);
  });

  it("connected account differs from the shop's account → REJECTED", () => {
    expect(isPaymentAccountAuthorized({ sessionAccount: "acct_A", shopAccount: "acct_B" })).toBe(false);
  });
});
