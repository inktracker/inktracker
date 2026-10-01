// Request bodies for Stripe (pure, unit-tested). The stripeApi client
// form-encodes these nested objects.
//
// Model: Connect STANDARD accounts + direct charges. Each shop has its own
// Stripe account (merchant of record: its own dashboard, disputes,
// refunds); InkTracker creates the shop's Checkout Sessions ON that account
// and takes an application fee.

import { payinIdempotencyKey, buildPayinMetadata } from "./payinPlan.js";
import { platformFeeCents } from "./paymentsPricing.js";

/**
 * Only paying shops can sign up: payments are a paid-plan feature, and a
 * lapsed trial taking card payments is how platforms get burned.
 * Admin/comped count.
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

const dropUndefined = (o) => JSON.parse(JSON.stringify(o));

/**
 * POST /v1/accounts — a Standard account prefilled with what InkTracker
 * already knows, so Stripe's sign-up only asks for what we can't (owner
 * identity, tax id, bank). Never sends SSN/EIN: those go straight to Stripe.
 * `metadata.inktracker_shop_owner` lets a retry find an account whose save
 * failed instead of creating a second one.
 */
export function buildAccountCreate(profile, shopOwner) {
  const name = clean(profile?.shop_name || profile?.company_name || profile?.display_name, 100);
  return dropUndefined({
    type: "standard",
    country: "US",
    email: clean(shopOwner || profile?.email, 254),
    business_profile: {
      name,
      url: website(profile?.website),
      support_phone: clean(profile?.phone, 20),
      // 2759 = Commercial printing (screen printing, embroidery shops).
      mcc: "2759",
    },
    metadata: { inktracker_shop_owner: String(shopOwner ?? "") },
  });
}

/** POST /v1/account_links — Stripe-hosted sign-up, back to Account → Payments. */
export function buildAccountLink(accountId, appUrl) {
  const base = String(appUrl || "https://www.inktracker.app").replace(/\/$/, "");
  return {
    account: String(accountId),
    type: "account_onboarding",
    refresh_url: `${base}/Account?payments=refresh#payments`,
    return_url: `${base}/Account?payments=return#payments`,
  };
}

/**
 * POST /v1/checkout/sessions on the shop's account (Stripe-Account header):
 * one line for the LIVE QuickBooks balance, one payment method (card or
 * bank — each has its own fee), InkTracker's application fee, and our
 * metadata on the PaymentIntent (that's what webhooks carry back).
 * @returns {{ params: object, idempotencyKey: string, platformFeeCents: number }}
 */
export function buildCheckoutSession({ doc, docType, target, method, shopName, customer = {}, payPageUrl, attempt = 0, nowMs = Date.now() }) {
  const isInvoice = docType === "invoice";
  const docNumber = String((isInvoice ? doc?.invoice_id : doc?.quote_id) ?? "").slice(0, 40);
  const what = target.kind === "deposit" ? `Deposit for ${docNumber}` : target.kind === "balance" ? `Balance due on ${docNumber}` : (isInvoice ? `Invoice ${docNumber}` : `Order ${docNumber}`);
  const fee = platformFeeCents(method, target.amountCents);
  const { key, expiresAt } = payinIdempotencyKey({ quoteId: doc?.id, qbInvoiceId: target.qbInvoiceId, amountCents: target.amountCents, method, attempt, nowMs });
  const metadata = buildPayinMetadata({ quote: doc, target, docType });
  const email = clean(customer.email, 254);
  const validEmail = email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
  const back = String(payPageUrl);
  const join = back.includes("?") ? "&" : "?";
  const params = dropUndefined({
    mode: "payment",
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: target.amountCents,
        product_data: { name: `${what}${shopName ? ` · ${String(shopName).slice(0, 60)}` : ""}` },
      },
    }],
    payment_method_types: [method === "ach" ? "us_bank_account" : "card"],
    ...(method === "ach" ? { payment_method_options: { us_bank_account: { verification_method: "automatic" } } } : {}),
    payment_intent_data: {
      ...(fee > 0 ? { application_fee_amount: fee } : {}),
      description: what,
      metadata,
      // A new Stripe account doesn't email receipts by default; asking for
      // one per payment sends it regardless of the shop's settings.
      receipt_email: validEmail,
    },
    metadata,
    client_reference_id: String(doc?.id ?? ""),
    customer_email: validEmail,
    success_url: `${back}${join}paid=${method}`,
    cancel_url: back,
    expires_at: expiresAt,
  });
  return { params, idempotencyKey: key, platformFeeCents: fee };
}

/**
 * "Connect my existing Stripe account" (Connect OAuth for Standard
 * accounts). Stripe sends the owner back to Account → Payments with
 * ?payments=oauth&code=…&state=…; `state` is one-time and checked server-side.
 * The redirect URI must be registered in the platform's Connect settings.
 */
export function buildConnectOAuthUrl({ clientId, state, appUrl, shopOwner, shopName }) {
  const base = String(appUrl || "https://www.inktracker.app").replace(/\/$/, "");
  const q = new URLSearchParams({
    response_type: "code",
    client_id: String(clientId),
    scope: "read_write",
    state: String(state),
    redirect_uri: `${base}/Account?payments=oauth`,
  });
  if (shopOwner) q.set("stripe_user[email]", String(shopOwner));
  if (shopName) q.set("stripe_user[business_name]", String(shopName).slice(0, 100));
  return `https://connect.stripe.com/oauth/authorize?${q.toString()}`;
}
