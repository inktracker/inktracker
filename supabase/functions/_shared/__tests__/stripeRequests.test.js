import { describe, it, expect } from "vitest";
import { isPayingShop, buildAccountCreate, buildAccountLink, buildCheckoutSession, buildConnectOAuthUrl } from "../stripeRequests.js";
import { formEncode } from "../stripeForm.js";

describe("isPayingShop — payments are a paid-plan feature", () => {
  it("paying shops and admins only", () => {
    expect(isPayingShop({ subscription_tier: "shop", subscription_status: "active" })).toBe(true);
    expect(isPayingShop({ role: "admin" })).toBe(true);
    expect(isPayingShop({ subscription_tier: "trial", subscription_status: "active" })).toBe(false);
    expect(isPayingShop({ subscription_tier: "shop", subscription_status: "past_due" })).toBe(false);
    expect(isPayingShop(null)).toBe(false);
  });
});

describe("buildAccountCreate — a Standard account prefilled, never sensitive data", () => {
  const profile = { shop_name: "Biota Mfg", email: "joe@biotamfg.co", phone: "775-555-0100", website: "biotamfg.co", ssn: "x", ein: "y", tax_id: "z" };
  it("Standard, US, our metadata, printing MCC; website gets a scheme", () => {
    const b = buildAccountCreate(profile, "joe@biotamfg.co");
    expect(b).toEqual({
      type: "standard",
      country: "US",
      email: "joe@biotamfg.co",
      business_profile: { name: "Biota Mfg", url: "https://biotamfg.co", support_phone: "775-555-0100" },
      metadata: { inktracker_shop_owner: "joe@biotamfg.co" },
    });
  });
  it("never sends SSN/EIN/tax ids, even if the profile has them", () => {
    const s = JSON.stringify(buildAccountCreate(profile, "joe@biotamfg.co"));
    expect(s).not.toMatch(/ssn|ein|tax_id/i);
  });
  it("missing fields are left out, not sent empty", () => {
    expect(buildAccountCreate({}, "a@b.co").business_profile).toEqual({});
    // Stripe asks the business type itself; an mcc outside its list fails the create.
    expect(JSON.stringify(buildAccountCreate({ shop_name: "X" }, "a@b.co"))).not.toMatch(/mcc/);
  });
});

describe("buildAccountLink", () => {
  it("Stripe-hosted onboarding that returns to Account → Payments", () => {
    expect(buildAccountLink("acct_1", "https://www.inktracker.app/")).toEqual({
      account: "acct_1",
      type: "account_onboarding",
      refresh_url: "https://www.inktracker.app/Account?payments=refresh#payments",
      return_url: "https://www.inktracker.app/Account?payments=return#payments",
    });
  });
});

describe("buildCheckoutSession", () => {
  const doc = { id: "q-uuid", quote_id: "Q-2026-HKSO", shop_owner: "joe@biotamfg.co", public_token: "tok" };
  const target = { kind: "full", qbInvoiceId: "3815", amountCents: 112648 };
  const page = "https://www.inktracker.app/QuotePayment?id=q-uuid&token=tok";
  const now = Date.UTC(2026, 9, 1, 15, 5);

  it("card: one line for the live balance, InkTracker's fee, our metadata on the PaymentIntent", () => {
    const { params, idempotencyKey, platformFeeCents } = buildCheckoutSession({ doc, docType: "quote", target, method: "card", shopName: "Biota Mfg", customer: { email: "buyer@tahoegift.com" }, payPageUrl: page, nowMs: now });
    expect(platformFeeCents).toBe(71);
    expect(params.mode).toBe("payment");
    expect(params.line_items).toEqual([{ quantity: 1, price_data: { currency: "usd", unit_amount: 112648, product_data: { name: "Order Q-2026-HKSO · Biota Mfg" } } }]);
    expect(params.payment_method_types).toEqual(["card"]);
    expect(params.payment_intent_data.application_fee_amount).toBe(71);
    expect(params.payment_intent_data.metadata).toMatchObject({ inktracker_doc_type: "quote", inktracker_quote_id: "q-uuid", qb_invoice_id: "3815", pay_kind: "full" });
    expect(params.customer_email).toBe("buyer@tahoegift.com");
    // New Stripe accounts don't email receipts by default; ask per payment.
    expect(params.payment_intent_data.receipt_email).toBe("buyer@tahoegift.com");
    expect(params.success_url).toBe(`${page}&paid=card&session_id={CHECKOUT_SESSION_ID}`);
    expect(params.cancel_url).toBe(page);
    expect(idempotencyKey).toMatch(/^it-checkout:q-uuid:3815:112648:card:w\d+$/);
    expect(params.expires_at * 1000 - now).toBeGreaterThanOrEqual(60 * 60 * 1000);
  });

  it("bank: us_bank_account with automatic verification and the bank fee", () => {
    const { params } = buildCheckoutSession({ doc, docType: "quote", target: { ...target, amountCents: 129700 }, method: "ach", payPageUrl: page, nowMs: now });
    expect(params.payment_method_types).toEqual(["us_bank_account"]);
    expect(params.payment_method_options).toEqual({ us_bank_account: { verification_method: "automatic" } });
    expect(params.payment_intent_data.application_fee_amount).toBe(647);
    expect(params.success_url).toBe(`${page}&paid=ach&session_id={CHECKOUT_SESSION_ID}`);
  });

  it("no fee line when InkTracker's fee is 0 (small card payment); no bad email", () => {
    const { params } = buildCheckoutSession({ doc, docType: "quote", target: { ...target, amountCents: 5000 }, method: "card", customer: { email: "not-an-email" }, payPageUrl: page, nowMs: now });
    expect(params.payment_intent_data).not.toHaveProperty("application_fee_amount");
    expect(params).not.toHaveProperty("customer_email");
  });

  it("deposit / balance / invoice wording", () => {
    const name = (o) => buildCheckoutSession({ doc, docType: "quote", target: { ...target, ...o }, method: "card", payPageUrl: page, nowMs: now }).params.line_items[0].price_data.product_data.name;
    expect(name({ kind: "deposit" })).toBe("Deposit for Q-2026-HKSO");
    expect(name({ kind: "balance" })).toBe("Balance due on Q-2026-HKSO");
    const inv = buildCheckoutSession({ doc: { id: "i", invoice_id: "INV-2026-0042" }, docType: "invoice", target, method: "card", payPageUrl: page, nowMs: now });
    expect(inv.params.line_items[0].price_data.product_data.name).toBe("Invoice INV-2026-0042");
    expect(inv.params.metadata.inktracker_doc_type).toBe("invoice");
  });
});

describe("formEncode — Stripe's nested form format", () => {
  it("nests objects and arrays, skips undefined/null", () => {
    expect(formEncode({ a: { b: 1 }, list: [{ x: "y" }], tags: ["p", "q"], skip: undefined, nil: null, t: true }))
      .toBe("a%5Bb%5D=1&list%5B0%5D%5Bx%5D=y&tags%5B0%5D=p&tags%5B1%5D=q&t=true");
  });
  it("encodes metadata values safely", () => {
    expect(formEncode({ metadata: { note: "a&b=c" } })).toBe("metadata%5Bnote%5D=a%26b%3Dc");
  });
});

describe("buildConnectOAuthUrl — connect an existing Stripe account", () => {
  it("Standard OAuth with state, our redirect, and the shop prefilled", () => {
    const u = new URL(buildConnectOAuthUrl({ clientId: "ca_1", state: "st", appUrl: "https://www.inktracker.app", shopOwner: "joe@biotamfg.co", shopName: "Biota Mfg" }));
    expect(u.origin + u.pathname).toBe("https://connect.stripe.com/oauth/authorize");
    expect(Object.fromEntries(u.searchParams)).toEqual({
      response_type: "code", client_id: "ca_1", scope: "read_write", state: "st",
      redirect_uri: "https://www.inktracker.app/Account?payments=oauth",
      "stripe_user[email]": "joe@biotamfg.co", "stripe_user[business_name]": "Biota Mfg",
    });
  });
});
