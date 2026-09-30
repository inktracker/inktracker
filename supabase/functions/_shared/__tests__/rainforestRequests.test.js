import { describe, it, expect } from "vitest";
import { isPayingShop, buildMerchantCreate, buildOnboardingSession, buildPaymentSession, buildPayinConfig } from "../rainforestRequests.js";

describe("isPayingShop — Rainforest discourages trial accounts", () => {
  it("paid, admin and comped shops qualify; trials and lapsed don't", () => {
    expect(isPayingShop({ role: "admin" })).toBe(true);
    expect(isPayingShop({ role: "shop", subscription_tier: "shop", subscription_status: "active" })).toBe(true);
    expect(isPayingShop({ role: "shop", subscription_tier: "shop", subscription_status: "trialing" })).toBe(false);
    expect(isPayingShop({ role: "shop", subscription_tier: "trial" })).toBe(false);
    expect(isPayingShop({ role: "shop", subscription_tier: "shop", subscription_status: "past_due" })).toBe(false);
    expect(isPayingShop(null)).toBe(false);
  });
});

describe("buildMerchantCreate — prefill what we know, never sensitive data", () => {
  it("maps the shop profile", () => {
    const b = buildMerchantCreate({ shop_name: "Biota Mfg", email: "joe@biotamfg.co", phone: "775-555-0142", website: "biotamfg.co", address: "123 Commercial Row", city: "Reno", state: "NV", zip: "89501" });
    expect(b).toEqual({
      name: "Biota Mfg",
      dba_name: "Biota Mfg",
      email: "joe@biotamfg.co",
      phone_number: "775-555-0142",
      website: "https://biotamfg.co",
      address: { address_line_1: "123 Commercial Row", city: "Reno", state: "NV", postal_code: "89501", country: "US" },
      metadata: { inktracker_shop_owner: "joe@biotamfg.co" },
    });
  });
  it("drops what's missing; short names skip the statement descriptor", () => {
    const b = buildMerchantCreate({ shop_name: "Ink", email: "a@b.co" });
    expect(b.dba_name).toBeUndefined();
    expect(b.address).toBeUndefined();
    expect(b.website).toBeUndefined();
    expect(Object.keys(b)).not.toContain("tax_id");
  });
});

describe("sessions are least-privilege and one-merchant", () => {
  it("onboarding + payment sessions are constrained to the merchant", () => {
    expect(buildOnboardingSession("mid_1").statements).toEqual([{ permissions: ["group#merchant_onboarding_component"], constraints: { merchant: { merchant_id: "mid_1" } } }]);
    expect(buildPaymentSession("mid_1").statements[0].permissions).toEqual(["group#payment_component"]);
    expect(JSON.stringify([buildOnboardingSession("m"), buildPaymentSession("m")])).not.toContain("group#all");
    expect(buildPaymentSession("m").ttl).toBeLessThanOrEqual(86400);
  });
});

describe("buildPayinConfig", () => {
  it("invoice payments carry the invoice number and doc type", () => {
    const cfg = buildPayinConfig({
      merchantId: "mid_1",
      doc: { id: "inv-uuid", invoice_id: "INV-2026-0042", shop_owner: "joe@biotamfg.co" },
      docType: "invoice",
      target: { ok: true, kind: "full", qbInvoiceId: "3815", amountCents: 164300 },
      liveInvoice: { TotalAmt: 1643, TxnTaxDetail: { TotalTax: 0 }, BillAddr: { PostalCode: "96150" }, Line: [] },
      customer: { name: "Tahoe Gift Co" },
    });
    expect(cfg).toMatchObject({
      merchant_id: "mid_1", amount: 164300, currency_code: "USD",
      billing_contact: { name: "Tahoe Gift Co", postal_code: "96150", country: "US" },
      metadata: { inktracker_doc_type: "invoice", inktracker_quote_id: "inv-uuid", quote_number: "INV-2026-0042" },
      level_2_3: { order_number: "INV-2026-0042", tax_amount: 0 },
      risk_data: { external_ref: "INV-2026-0042" },
    });
  });
});
