// Request bodies for Stripe (pure, unit-tested). The stripeApi client
// form-encodes these nested objects.
//
// Model: Connect STANDARD accounts + direct charges. Each shop has its own
// Stripe account (merchant of record: its own dashboard, disputes,
// refunds); InkTracker creates the shop's Checkout Sessions ON that account
// and takes an application fee.

import { payinIdempotencyKey, buildPayinMetadata } from "./payinPlan.js";
import { platformFeeCents, maxCustomerFeeCents } from "./paymentsPricing.js";

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
      // No mcc: Stripe rejects codes outside its own list (2759 failed live,
      // 2026-10-01) and asks the shop its business type during sign-up.
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

const docLabel = (doc, docType, target) => {
  const isInvoice = docType === "invoice";
  const docNumber = String((isInvoice ? doc?.invoice_id : doc?.quote_id) ?? "").slice(0, 40);
  return target.kind === "deposit" ? `Deposit for ${docNumber}` : target.kind === "balance" ? `Balance due on ${docNumber}` : (isInvoice ? `Invoice ${docNumber}` : `Order ${docNumber}`);
};

const validFee = (feeCents, target) =>
  Number.isInteger(feeCents) && feeCents > 0 && feeCents <= maxCustomerFeeCents(target.amountCents) ? feeCents : 0;

const validEmailOf = (customer) => {
  const email = clean(customer?.email, 254);
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
};

/**
 * POST /v1/checkout/sessions on the shop's account (Stripe-Account header):
 * one line for the LIVE QuickBooks balance (plus a line for the shop's fee
 * when the customer pays one), one payment method, InkTracker's application
 * fee, and our metadata on the PaymentIntent (that's what webhooks carry
 * back). Card payments with a surcharge don't come here — the fee depends on
 * the card, so they use buildCardPaymentIntent.
 * @returns {{ params: object, idempotencyKey: string, platformFeeCents: number, chargeCents: number }}
 */
export function buildCheckoutSession({ doc, docType, target, method, feeCents = 0, shopName, customer = {}, payPageUrl, attempt = 0, nowMs = Date.now() }) {
  const what = docLabel(doc, docType, target);
  const fee = validFee(feeCents, target);
  const chargeCents = target.amountCents + fee;
  const appFee = platformFeeCents(method, chargeCents);
  const { key, expiresAt } = payinIdempotencyKey({ quoteId: doc?.id, qbInvoiceId: target.qbInvoiceId, amountCents: chargeCents, method, attempt, nowMs });
  const metadata = {
    ...buildPayinMetadata({ quote: doc, target, docType }),
    ...(fee ? { customer_fee_cents: String(fee) } : {}),
  };
  const validEmail = validEmailOf(customer);
  const back = String(payPageUrl);
  const join = back.includes("?") ? "&" : "?";
  const line = (name, cents) => ({ quantity: 1, price_data: { currency: "usd", unit_amount: cents, product_data: { name } } });
  const params = dropUndefined({
    mode: "payment",
    line_items: [
      line(`${what}${shopName ? ` · ${String(shopName).slice(0, 60)}` : ""}`, target.amountCents),
      // Its own line on Stripe's page and receipt.
      ...(fee ? [line(method === "ach" ? "Bank payment fee" : "Card processing fee", fee)] : []),
    ],
    payment_method_types: [method === "ach" ? "us_bank_account" : "card"],
    ...(method === "ach" ? { payment_method_options: { us_bank_account: { verification_method: "automatic" } } } : {}),
    payment_intent_data: {
      ...(appFee > 0 ? { application_fee_amount: appFee } : {}),
      description: what,
      metadata,
      // A new Stripe account doesn't email receipts by default; asking for
      // one per payment sends it regardless of the shop's settings.
      receipt_email: validEmail,
    },
    metadata,
    client_reference_id: String(doc?.id ?? ""),
    customer_email: validEmail,
    // Stripe fills in {CHECKOUT_SESSION_ID}; the page confirms it (paidStatus).
    success_url: `${back}${join}paid=${method}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: back,
    expires_at: expiresAt,
  });
  return { params, idempotencyKey: key, platformFeeCents: appFee, chargeCents };
}

/**
 * POST /v1/payment_intents on the shop's account for a CARD payment entered
 * on InkTracker's own pay page (Stripe's card form, ConfirmationToken). The
 * surcharge is known only once the card is (credit vs debit), so the
 * customer sees it and clicks Pay before this is sent. Sent with
 * STRIPE_SURCHARGE_API_VERSION when there's a surcharge: Stripe records it
 * as the surcharge (its own line on the receipt) and refuses one the card
 * can't carry.
 * @returns {{ params: object, idempotencyKey: string, platformFeeCents: number, chargeCents: number }}
 */
export function buildCardPaymentIntent({ doc, docType, target, confirmationToken, surchargeCents = 0, customer = {}, payPageUrl }) {
  const what = docLabel(doc, docType, target);
  const fee = validFee(surchargeCents, target);
  const chargeCents = target.amountCents + fee;
  const appFee = platformFeeCents("card", chargeCents);
  const metadata = {
    ...buildPayinMetadata({ quote: doc, target, docType }),
    ...(fee ? { customer_fee_cents: String(fee) } : {}),
  };
  const back = String(payPageUrl);
  const join = back.includes("?") ? "&" : "?";
  const params = dropUndefined({
    amount: chargeCents,
    currency: "usd",
    confirm: true,
    confirmation_token: String(confirmationToken),
    payment_method_types: ["card"],
    ...(appFee > 0 ? { application_fee_amount: appFee } : {}),
    ...(fee ? { amount_details: { surcharge: { amount: fee, enforce_validation: "enabled" } } } : {}),
    description: what,
    metadata,
    receipt_email: validEmailOf(customer),
    // Where the bank's card check (3-D Secure) sends the customer back;
    // Stripe adds ?payment_intent=pi_… and the page confirms it (paidStatus).
    return_url: `${back}${join}paid=card`,
  });
  // One PaymentIntent per card entry: the same token can't pay twice.
  return { params, idempotencyKey: `it-card:${String(confirmationToken)}:${chargeCents}`, platformFeeCents: appFee, chargeCents };
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
