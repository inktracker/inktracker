import { describe, it, expect } from "vitest";
import {
  resolveCheckoutTarget,
  isQBPaymentLink,
} from "../resolveCheckoutTarget";

describe("isQBPaymentLink", () => {
  it("accepts payments.intuit.com URLs", () => {
    expect(isQBPaymentLink("https://payments.intuit.com/payment/xyz123")).toBe(true);
  });

  it("accepts payments.quickbooks.intuit.com URLs", () => {
    expect(
      isQBPaymentLink("https://payments.quickbooks.intuit.com/i/abc")
    ).toBe(true);
  });

  it("rejects the legacy connect.intuit.com login fallback URL", () => {
    expect(
      isQBPaymentLink(
        "https://connect.intuit.com/portal/asei/CommerceNetwork/consumer/view-invoice?businessId=42&invoiceId=99"
      )
    ).toBe(false);
  });

  it("rejects the QBO web app URL (login required)", () => {
    expect(
      isQBPaymentLink("https://app.qbo.intuit.com/app/invoice?txnId=42")
    ).toBe(false);
  });

  it("rejects Intuit SSO URLs", () => {
    expect(
      isQBPaymentLink("https://accounts.intuit.com/signin?continue=…")
    ).toBe(false);
  });

  it("rejects null/undefined/empty/non-URL inputs", () => {
    expect(isQBPaymentLink(null)).toBe(false);
    expect(isQBPaymentLink(undefined)).toBe(false);
    expect(isQBPaymentLink("")).toBe(false);
    expect(isQBPaymentLink("not-a-url")).toBe(false);
    expect(isQBPaymentLink(42)).toBe(false);
  });

  it("rejects unrelated hosts even with https", () => {
    expect(isQBPaymentLink("https://evil.example.com/payment")).toBe(false);
  });
});

describe("resolveCheckoutTarget", () => {
  it("routes to QB when qb_payment_link is a real payment URL", () => {
    const r = resolveCheckoutTarget({
      qb_payment_link: "https://payments.intuit.com/payment/xyz",
    });
    expect(r.provider).toBe("qb");
    expect(r.url).toBe("https://payments.intuit.com/payment/xyz");
  });

  it("routes to Stripe when qb_payment_link is the broken connect.intuit.com fallback", () => {
    const r = resolveCheckoutTarget({
      qb_payment_link:
        "https://connect.intuit.com/portal/asei/CommerceNetwork/consumer/view-invoice?businessId=42&invoiceId=99",
    });
    expect(r.provider).toBe("stripe");
    expect(r.url).toBeNull();
  });

  it("routes to Stripe when qb_payment_link is missing", () => {
    expect(resolveCheckoutTarget({}).provider).toBe("stripe");
    expect(resolveCheckoutTarget({ qb_payment_link: null }).provider).toBe("stripe");
    expect(resolveCheckoutTarget(null).provider).toBe("stripe");
  });

  it("routes to Stripe when qb_payment_link points at the QBO login app", () => {
    const r = resolveCheckoutTarget({
      qb_payment_link: "https://app.qbo.intuit.com/app/invoice?txnId=42",
    });
    expect(r.provider).toBe("stripe");
  });
});
