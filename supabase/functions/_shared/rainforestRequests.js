// Request bodies for the Rainforest API (pure, unit-tested). API version
// 2024-10-16; field names from the OpenAPI spec (docs/rainforest-payments.md).

import { payinIdempotencyKey, buildPayinMetadata, buildLevel23 } from "./rainforestPayinPlan.js";

export const RAINFOREST_API_VERSION = "2024-10-16";

// Component sessions: short-lived, least-privilege, one merchant only
// (Rainforest's production review rejects group#all or unconstrained ones).
const ONBOARDING_TTL_S = 60 * 60;
const PAYMENT_TTL_S = 30 * 60;

/**
 * Rainforest discourages trial/free accounts signing up for payments (they're
 * usually declined), so only paying shops can start. Admin/comped count.
 */
export function isPayingShop(profile) {
  if (!profile) return false;
  if (profile.role === "admin") return true;
  return profile.subscription_tier === "shop" && profile.subscription_status === "active";
}

const clean = (v, max) => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : undefined;
};

function website(v) {
  const s = String(v ?? "").trim();
  if (!s) return undefined;
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

/**
 * POST /v1/merchants — prefilled with what InkTracker already knows, so the
 * onboarding form only asks for what we can't (owners' SSN/DOB, tax id, bank).
 * Never sends SSN or tax ID: those go straight into Rainforest's form.
 */
export function buildMerchantCreate(profile) {
  const name = clean(profile?.shop_name || profile?.company_name || profile?.display_name, 100) ?? "Print shop";
  const dba = clean(profile?.shop_name || profile?.company_name, 16);
  const body = {
    name,
    // dba_name drives the card statement descriptor "RF *{DBA}" (≥5 chars).
    ...(dba && dba.length >= 5 ? { dba_name: dba } : {}),
    email: clean(profile?.email, 254),
    phone_number: clean(profile?.phone, 20),
    website: website(profile?.website),
    // Spec says `address`; the doc examples say `billing_contact`. Verify in
    // sandbox (docs/rainforest-payments.md, doc inconsistency #1).
    address: (profile?.address || profile?.city || profile?.zip) ? {
      address_line_1: clean(profile?.address, 100),
      city: clean(profile?.city, 50),
      state: clean(profile?.state, 2),
      postal_code: clean(profile?.zip, 10),
      country: "US",
    } : undefined,
    // No metadata: the merchant schema has none. The shop is recognised by
    // name + this email (findOurMerchant).
  };
  return JSON.parse(JSON.stringify(body)); // drop undefined
}

export function buildOnboardingSession(merchantId) {
  return {
    ttl: ONBOARDING_TTL_S,
    statements: [{
      permissions: ["group#merchant_onboarding_component"],
      constraints: { merchant: { merchant_id: String(merchantId) } },
    }],
  };
}

export function buildPaymentSession(merchantId) {
  return {
    ttl: PAYMENT_TTL_S,
    statements: [{
      permissions: ["group#payment_component"],
      constraints: { merchant: { merchant_id: String(merchantId) } },
    }],
  };
}

/**
 * POST /v1/payin_configs for one payment. `doc` is the quote or invoice row
 * (see choosePayTarget), `target` its pay target, `liveInvoice` the QB
 * invoice being paid. The amount is the LIVE QuickBooks balance.
 */
export function buildPayinConfig({ merchantId, doc, docType, target, liveInvoice, customer = {}, shopPostalCode = null, attempt = 0 }) {
  const docNumber = docType === "invoice" ? doc?.invoice_id : doc?.quote_id;
  const name = clean(customer.name, 100);
  const email = clean(customer.email, 254);
  const postal = clean(liveInvoice?.BillAddr?.PostalCode, 10);
  return JSON.parse(JSON.stringify({
    merchant_id: String(merchantId),
    idempotency_key: payinIdempotencyKey({ quoteId: doc?.id, qbInvoiceId: target.qbInvoiceId, amountCents: target.amountCents, attempt }),
    amount: target.amountCents,
    currency_code: "USD",
    // Prefilled so the form doesn't ask again (card needs postal code, bank
    // needs a name); the customer can still change them.
    billing_contact: (name || email || postal) ? { name, email, postal_code: postal, country: postal ? "US" : undefined } : undefined,
    metadata: buildPayinMetadata({ quote: doc, target, docType }),
    level_2_3: buildLevel23({ docNumber, target, liveInvoice, shopPostalCode }),
    risk_data: { external_ref: String(docNumber ?? "").slice(0, 100) },
  }));
}
