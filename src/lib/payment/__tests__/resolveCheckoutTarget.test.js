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

  it("accepts the real QBO share link on connect.intuit.com", () => {
    // The customer-facing payment link minted by POST /invoice/{id}/send.
    // Anonymous-pay capable — no Intuit login required.
    expect(
      isQBPaymentLink(
        "https://connect.intuit.com/portal/app/CommerceNetwork/view/scs-v1-abc123def456"
      )
    ).toBe(true);
  });

  it("accepts share-link with query string and fragment intact", () => {
    expect(
      isQBPaymentLink(
        "https://connect.intuit.com/portal/app/CommerceNetwork/view/scs-v1-abc?ref=email#receipt"
      )
    ).toBe(true);
  });

  it("rejects the legacy connect.intuit.com login fallback URL", () => {
    // The fabricated URL we used to construct before commit 5768c01 —
    // requires the customer to log in to their own Intuit account.
    expect(
      isQBPaymentLink(
        "https://connect.intuit.com/portal/asei/CommerceNetwork/consumer/view-invoice?businessId=42&invoiceId=99"
      )
    ).toBe(false);
  });

  it("rejects unknown connect.intuit.com paths (conservative default)", () => {
    // Anything on connect.intuit.com that isn't the known share-link
    // prefix is rejected. If QBO ever ships a new URL format we'll have
    // to whitelist it explicitly — better than silently routing customers
    // to a URL that may require a login.
    expect(
      isQBPaymentLink("https://connect.intuit.com/some/other/path")
    ).toBe(false);
    expect(
      isQBPaymentLink("https://connect.intuit.com/")
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

  it("routes to QB when qb_payment_link is the real connect.intuit.com share link", () => {
    const link = "https://connect.intuit.com/portal/app/CommerceNetwork/view/scs-v1-abc123";
    const r = resolveCheckoutTarget({ qb_payment_link: link });
    expect(r.provider).toBe("qb");
    expect(r.url).toBe(link);
  });

  it("routes to QB on the literal production-shape share link (regression guard)", () => {
    // Pinned verbatim from a 2026-05-18 prod test (quote Q-2026-89SU). If
    // this ever fails, the classifier diverged from what QBO actually emits.
    const link = "https://connect.intuit.com/portal/app/CommerceNetwork/view/scs-v1-7f190a8f3c6d403997092f7999a40c2d49c2c1b3acea4921ae25435d9673123aed8a7db05aae4f2aa78dfe6d08ed235d?locale=en_US&cta=v3invoicelink";
    const r = resolveCheckoutTarget({ qb_payment_link: link });
    expect(r.provider).toBe("qb");
    expect(r.url).toBe(link);
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

describe("Intuit short share links (format flip ~2026-08-06)", () => {
  it("accepts the new /t/scs-… short form", () => {
    expect(isQBPaymentLink("https://connect.intuit.com/t/scs-v1-abc123-1")).toBe(true);
  });
  it("still accepts the long CommerceNetwork form", () => {
    expect(isQBPaymentLink("https://connect.intuit.com/portal/app/CommerceNetwork/view/scs-v1-abc123")).toBe(true);
  });
  it("still rejects the legacy login-required portal path", () => {
    expect(isQBPaymentLink("https://connect.intuit.com/portal/asei/CommerceNetwork/consumer/view-invoice?x=1")).toBe(false);
  });
  it("rejects other /t/ paths that are not scs tokens", () => {
    expect(isQBPaymentLink("https://connect.intuit.com/t/login")).toBe(false);
  });
});
