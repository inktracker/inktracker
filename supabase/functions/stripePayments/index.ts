// InkTracker payments (Stripe Connect). Supabase Edge Function.
//
// Signed-in shop actions (acts on the SHOP OWNER's row; brokers refused):
//   status           → which way this shop's customers pay + setup progress
//   startOnboarding  → OWNER, paying plan only: create the shop's Stripe
//                      account (Standard, prefilled) once, then a
//                      Stripe-hosted sign-up link
//   connectExisting  → OWNER: "I already have a Stripe account" (Connect OAuth)
//   finishConnect    → OWNER: back from Stripe with ?code&state → link it
//   refreshStatus    → re-read the account from Stripe (after sign-up returns)
//   qbAccounts       → the shop's QuickBooks bank / expense accounts to pick from
//   saveQbAccounts   → map payout bank account + fee expense account (owner/manager)
//   setEnabled       → switch InkTracker payments on/off (OWNER only)
//
// Public (customer) action, no sign-in, token-gated like the quote page:
//   payRail          → { docType, id, token } → { rail } only (page load)
//   payinSession     → { docType: "quote"|"invoice", id, token, method:
//                      "card"|"ach" } → a Stripe Checkout URL for the LIVE
//                      QuickBooks balance, or a reason it can't be paid here
//   cardQuote        → { …, confirmationToken } → the card's surcharge, for a
//                      shop that passes fees on (the card is entered on our
//                      page so credit vs debit is known BEFORE paying)
//   cardPay          → { …, confirmationToken, expectTotalCents } → charge it
//   paidStatus       → { …, sessionId | paymentIntentId } → did it really pay
//
// Refunds and disputes happen in the shop's own Stripe dashboard (Standard
// accounts have the full dashboard), so there's nothing to embed here.
//
// Dormant by default: with STRIPE_PAYMENTS_ENABLED unset, status reports the
// QuickBooks rail, startOnboarding/setEnabled refuse, and payinSession
// answers { rail: "qb" } so the page keeps using QuickBooks.

import { createClient } from "npm:@supabase/supabase-js@2.102.1";
import { loadProfileWithSecrets, loadShopProfileForUser } from "../_shared/profileSecrets.ts";
import { paymentsOpenFor, loadPaymentRail, RAIL, stripeKeyMode } from "../_shared/paymentRail.js";
import {
  buildStatusPayload,
  canViewPayments,
  canMapQbAccounts,
  canTogglePayments,
  checkCanEnable,
  checkCanDisable,
  validateQbAccountMapping,
  qbAccountChoices,
  onboardingStage,
  canStartOver,
} from "../_shared/paymentsAccount.js";
import { isPayingShop, buildAccountCreate, buildAccountLink, buildCheckoutSession, buildCardPaymentIntent, buildConnectOAuthUrl } from "../_shared/stripeRequests.js";
import { accountStatusFields, readStripeList } from "../_shared/stripeWebhookAdapter.js";
import { choosePayTarget, NOT_PAYABLE } from "../_shared/payinPlan.js";
import { normalizePayMethod, customerFeeSettings, customerFeeCents, customerFeeNote, normalizeBankFeePct, cardFormKeyOk, effectiveCustomerFees, surchargeBannedState, acceptedMethods } from "../_shared/paymentsPricing.js";
import { getShopQb, qbListAccounts, qbGetInvoice, type QbConn } from "../_shared/qbShopClient.ts";
import { insertShopNotification } from "../_shared/notifications.js";
import { stripeApi, StripeError, STRIPE_SURCHARGE_API_VERSION, type StripeApi } from "../_shared/stripeApi.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: CORS });
}

function safeEquals(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const PAY_SESSION_REUSE_MS = 90 * 1000;
// After a payment goes through, refuse another one for the same document for
// this long (Stripe's webhook normally lands in seconds).
const JUST_PAID_MS = 10 * 60 * 1000;

/** Remember that this document was just paid (see preparePay). Best effort. */
async function markJustPaid(admin: Any, docId: string, paymentRef: string) {
  try {
    await admin.from("processor_pay_sessions")
      .upsert({ doc_id: docId, response: { paidMarker: true, paymentRef }, created_at: new Date().toISOString() }, { onConflict: "doc_id" });
  } catch (err) {
    console.error("[stripePayments] couldn't mark document paid:", (err as Error)?.message);
  }
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Deps = {
  admin: Any;
  getUser: (token: string) => Promise<Any>;
  env: (k: string) => string | undefined;
  stripe: StripeApi;
  qb: {
    connect: (shopOwner: string) => Promise<QbConn | null>;
    listAccounts: (c: QbConn) => Promise<Any[]>;
    getInvoice: (c: QbConn, id: string) => Promise<Any | null>;
  };
};

/**
 * The shop's payments row, as seen under the Stripe key in use. An account
 * made under the OTHER mode (a test-mode account once the live key is in)
 * doesn't exist here: treat it as not set up (the owner sets up again)
 * rather than as a live account that "disappeared".
 */
async function loadAccount(admin: Any, shopOwner: string, live: boolean) {
  const { data, error } = await admin
    .from("processor_accounts")
    .select("shop_owner, merchant_id, merchant_status, merchant_application_id, merchant_application_status, enabled, processor_used_at, plan_lapsed_at, qb_bank_account_id, qb_fee_account_id, stripe_livemode, oauth_state, oauth_state_at, customer_fees_enabled, customer_fees_ack_at, bank_fee_pct, accept_card, accept_bank")
    .eq("shop_owner", shopOwner)
    .maybeSingle();
  if (error) throw new Error(`Couldn't read payment settings: ${error.message}`);
  if (data && typeof data.stripe_livemode === "boolean" && data.stripe_livemode !== live) {
    return { ...data, merchant_id: null, merchant_status: null, merchant_application_status: null, enabled: false, customer_fees_enabled: false, modeMismatch: true };
  }
  return data ?? null;
}

const OAUTH_STATE_TTL_MS = 30 * 60 * 1000;

// Reset whenever a shop's Stripe account changes (new account, reconnect, or
// test → live): passing fees on must be confirmed again for the new account.
const FEES_OFF = { customer_fees_enabled: false, customer_fees_ack_at: null };

// Customer-facing reasons, in plain words. Never a raw error.
const CUSTOMER_REASON: Record<string, string> = {
  [NOT_PAYABLE.PAID]: "This invoice is already paid. Thank you!",
  [NOT_PAYABLE.DEPOSIT_PAID_AWAITING_FINAL]: "Your deposit is paid. The shop will send the final invoice when your order is ready.",
  [NOT_PAYABLE.STALE]: "This quote changed after it was invoiced. The shop needs to update the invoice before you can pay online. Please contact the shop.",
  [NOT_PAYABLE.NO_INVOICE]: "Online payment isn't set up for this yet. Please contact the shop.",
  [NOT_PAYABLE.BROKER]: "Online payment isn't available here. Please contact the shop.",
  [NOT_PAYABLE.BAD_AMOUNT]: "Online payment isn't available right now. Please contact the shop.",
  in_flight: "A payment is already being processed for this invoice. Bank payments take a few business days to clear.",
  tax_hold: "The shop is updating the sales tax on this invoice. Please check back soon or contact the shop.",
  no_bank: "Bank payment isn't available for this shop right now. Please pay by card, or contact the shop.",
  card_form_off: "Card payment isn't available right now. Please refresh the page and try again.",
  card_not_accepted: "This shop takes bank transfer only. Please pay by bank transfer.",
  bank_not_accepted: "This shop takes card payments only. Please pay by card.",
};

/** Load a quote/invoice for the public pay page, token-checked. */
async function loadPublicDoc(admin: Any, body: Any) {
  const docType = body.docType === "invoice" ? "invoice" : "quote";
  const id = String(body.id ?? "");
  if (!UUID_RE.test(id)) return null;
  const table = docType === "invoice" ? "invoices" : "quotes";
  const cols = docType === "invoice"
    ? "id, invoice_id, shop_owner, status, total, qb_total, tax, qb_invoice_id, qb_deposit_invoice_id, deposit_amount, deposit_pct, deposit_paid, broker_id, public_token, customer_name, paid, qb_tax_hold"
    // company + job_title: the test-mode TEST/DEMO check must see the same
    // fields qbSync sees, or the two disagree on which way the customer pays.
    : "id, quote_id, shop_owner, status, total, qb_total, tax, qb_invoice_id, qb_deposit_invoice_id, deposit_amount, deposit_pct, deposit_paid, broker_id, broker_email, public_token, customer_name, customer_email, company, job_title, paid, qb_tax_hold";
  const { data: doc } = await admin.from(table).select(cols).eq("id", id).maybeSingle();
  // Same answer for "no such doc" and "wrong token" — don't confirm ids exist.
  if (!doc || !safeEquals(String(body.token ?? ""), String(doc.public_token ?? ""))) return null;
  return { doc, docType };
}

/** What the pay page shows at the top (never internal fields). */
async function loadDisplay(admin: Any, doc: Any, docType: string) {
  const { data: shopProfile } = await admin.from("profiles").select("shop_name, logo_url, zip").eq("email", doc.shop_owner).maybeSingle();
  return {
    display: {
      shopName: shopProfile?.shop_name ?? null,
      logoUrl: shopProfile?.logo_url ?? null,
      docNumber: docType === "invoice" ? doc.invoice_id : doc.quote_id,
      customerName: doc.customer_name ?? null,
    },
    shopZip: shopProfile?.zip ?? null,
  };
}

/**
 * Public: which way this document is paid, plus what the page shows.
 * Database reads only — no Stripe or QuickBooks calls — because email
 * link scanners prefetch these pages; the payment session is only opened
 * when a person clicks Pay (payinSession).
 */
async function payRail(body: Any, deps: Deps) {
  const found = await loadPublicDoc(deps.admin, body);
  if (!found) return json({ error: "Not found" }, 404);
  const { doc, docType } = found;
  const rail = await loadPaymentRail(deps.admin, doc.shop_owner, {
    envEnabled: paymentsOpenFor(deps.env("STRIPE_PAYMENTS_ENABLED"), deps.env("STRIPE_PAYMENTS_SHOPS"), doc.shop_owner),
    broker: Boolean(doc.broker_id || doc.broker_email),
    keyMode: stripeKeyMode(deps.env("STRIPE_CONNECT_SECRET_KEY")) ?? (deps.stripe.live ? "live" : "test"),
    doc,
  });
  if (rail !== RAIL.PROCESSOR) return json({ rail: "qb" });
  const { display } = await loadDisplay(deps.admin, doc, docType);
  const account = await loadAccount(deps.admin, doc.shop_owner, deps.stripe.live);
  return json({ rail: "processor", display, paid: Boolean(doc.paid), pricing: methodPrices(doc, account, deps, display.shopName) });
}

/**
 * A Stripe account we created for this shop in an earlier attempt whose save
 * failed (found by our metadata). Never create a second one.
 */
async function findOurAccount(deps: Deps, shopOwner: string) {
  let startingAfter: string | null = null;
  for (let page = 0; page < 20; page++) {
    const { items, hasMore, lastId } = readStripeList(await deps.stripe.get("/v1/accounts", { limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) }));
    const hit = items.find((a: Any) => String(a?.metadata?.inktracker_shop_owner ?? "").toLowerCase() === shopOwner.toLowerCase());
    if (hit?.id) return hit;
    if (!hasMore || !lastId) return null;
    startingAfter = lastId;
  }
  return null;
}

const appUrl = (deps: Deps) => (deps.env("PUBLIC_APP_URL") ?? "https://www.inktracker.app").replace(/\/$/, "");

/**
 * Stripe.js settings for the card form on our pay page, or null when this
 * shop doesn't surcharge (card payers then use Stripe Checkout as before).
 * The publishable key is the PLATFORM's (public by design); the shop's
 * account id makes Stripe.js work on the shop's own account.
 */
function cardFormConfig(account: Any, deps: Deps) {
  if (!acceptedMethods(account).card) return null;
  const fees = customerFeeSettings(account);
  if (!fees.enabled || !(fees.cardPct > 0) || !account?.merchant_id) return null;
  const pk = deps.env("STRIPE_CONNECT_PUBLISHABLE_KEY") ?? "";
  if (!cardFormKeyOk(pk, deps.stripe.live)) {
    console.error("[stripePayments] STRIPE_CONNECT_PUBLISHABLE_KEY missing or wrong mode; card surcharge is off");
    return null;
  }
  return { publishableKey: pk, accountId: String(account.merchant_id) };
}

/**
 * What the pay page shows on its card / bank buttons. From InkTracker's
 * copy of the QuickBooks total (no QuickBooks call on page load — link
 * scanners open these pages); payment always charges the LIVE balance, and
 * the page says so. Exact amounts only for a plain full payment: deposits and
 * balances are worked out when the customer pays.
 */
function methodPrices(doc: Any, account: Any, deps: Deps, displayShopName: string | null = null) {
  const cardForm = cardFormConfig(account, deps);
  // No card form → no card surcharge (Checkout can't tell credit from debit).
  const fees = effectiveCustomerFees(account, { cardFormReady: Boolean(cardForm) });
  const accepts = acceptedMethods(account);
  const base = { fees, accepts, note: customerFeeNote(fees, { shopName: displayShopName, accepts }), cardForm, shopName: displayShopName };
  const plain = !doc.deposit_paid && !(Number(doc.deposit_amount) > 0) && !(Number(doc.deposit_pct) > 0);
  const totalCents = Math.round(Number(doc.qb_total ?? doc.total) * 100);
  if (!plain || !Number.isInteger(totalCents) || totalCents <= 0) return base;
  return {
    ...base,
    invoiceCents: totalCents,
    creditFeeCents: customerFeeCents({ balanceCents: totalCents, method: "card", funding: "credit", settings: fees }),
    bankFeeCents: customerFeeCents({ balanceCents: totalCents, method: "ach", settings: fees }),
  };
}

/** Where the customer comes back to after Checkout (the same pay page). */
function payPageUrl(deps: Deps, doc: Any, docType: string) {
  const base = appUrl(deps);
  return docType === "invoice"
    ? `${base}/invoicepayment?id=${encodeURIComponent(doc.id)}&token=${encodeURIComponent(doc.public_token)}`
    : `${base}/QuotePayment?id=${encodeURIComponent(doc.id)}&token=${encodeURIComponent(doc.public_token)}`;
}

type Ready = { doc: Any; docType: string; account: Any; display: Any };

/**
 * The checks every customer payment action makes: right document + token,
 * Stripe rail, payable status, no payment already in flight, QuickBooks
 * reachable. Returns a Response to send back, or what the caller needs.
 */
async function preparePay(body: Any, deps: Deps, opts: { throttleMethod?: string } = {}): Promise<Response | Ready> {
  const { admin } = deps;
  const found = await loadPublicDoc(admin, body);
  if (!found) return json({ error: "Not found" }, 404);
  const { doc, docType } = found;

  const envEnabled = paymentsOpenFor(deps.env("STRIPE_PAYMENTS_ENABLED"), deps.env("STRIPE_PAYMENTS_SHOPS"), doc.shop_owner);
  const broker = Boolean(doc.broker_id || doc.broker_email);
  const rail = await loadPaymentRail(admin, doc.shop_owner, {
    envEnabled,
    broker,
    keyMode: stripeKeyMode(deps.env("STRIPE_CONNECT_SECRET_KEY")) ?? (deps.stripe.live ? "live" : "test"),
    doc,
  });
  if (rail !== RAIL.PROCESSOR) return json({ rail: "qb" });
  // Tax-mismatch hold: QuickBooks computed a different tax than the shop
  // billed. The QB rail mints no link in this state; neither do we.
  if (doc.qb_tax_hold) {
    return json({ rail: "processor", payable: false, reason: "tax_hold", message: CUSTOMER_REASON.tax_hold });
  }
  if (docType === "quote" && ["Draft", "Declined"].includes(String(doc.status))) {
    return json({ rail: "processor", payable: false, message: "This quote isn't ready to pay yet. Please contact the shop." });
  }

  const account = await loadAccount(admin, doc.shop_owner, deps.stripe.live);
  if (!account?.merchant_id) return json({ rail: "qb" });

  const { display } = await loadDisplay(admin, doc, docType);

  // A payment already in flight for this document (bank payment clearing, or
  // a card payment not yet in QuickBooks) → don't open a second one.
  const invoiceIds = [doc.qb_invoice_id, doc.qb_deposit_invoice_id].filter(Boolean).map(String);
  if (invoiceIds.length) {
    const { data: inflight } = await admin.from("processor_payments")
      .select("processor_payin_id, status, qb_payment_id")
      .eq("shop_owner", doc.shop_owner)
      .in("qb_invoice_id", invoiceIds)
      .in("status", ["processing", "succeeded"])
      .is("qb_payment_id", null);
    if (inflight?.length) return json({ rail: "processor", payable: false, reason: "in_flight", message: CUSTOMER_REASON.in_flight, display });
  }

  const { data: recent } = await admin.from("processor_pay_sessions")
    .select("response, created_at").eq("doc_id", doc.id).maybeSingle();
  const recentAge = recent ? Date.now() - new Date(recent.created_at).getTime() : Infinity;
  // Just paid (card on this page, or back from Checkout): the payment record
  // arrives from Stripe a few seconds later, so the in-flight check above
  // can't see it yet. Don't take a second payment in that window.
  if (recent?.response?.paidMarker && recentAge < JUST_PAID_MS) {
    return json({ rail: "processor", payable: false, reason: "in_flight", message: CUSTOMER_REASON.in_flight, display });
  }
  // Throttle: the same document + method asked again within 90s gets the
  // checkout we just made — no QuickBooks or Stripe calls.
  if (opts.throttleMethod && recent?.response?.method === opts.throttleMethod && recentAge < PAY_SESSION_REUSE_MS) {
    return json(recent.response);
  }

  return { doc, docType, account, display };
}

/**
 * The LIVE QuickBooks amount to pay, and how many payments it already had.
 * This is the only QuickBooks call on the customer's side: callers make
 * every cheaper check first (a pay link hammered with junk must not use up
 * the shop's QuickBooks rate limit).
 */
async function liveTarget(deps: Deps, r: Ready): Promise<{ error: Response } | { target: Any; attempt: number }> {
  const { doc } = r;
  const conn = await deps.qb.connect(doc.shop_owner);
  if (!conn) return { error: json({ rail: "processor", payable: false, reason: "qb_unavailable", message: CUSTOMER_REASON[NOT_PAYABLE.BAD_AMOUNT], display: r.display }) };
  const [liveFinal, liveDeposit] = await Promise.all([
    doc.qb_invoice_id ? deps.qb.getInvoice(conn, String(doc.qb_invoice_id)) : Promise.resolve(null),
    doc.qb_deposit_invoice_id && !doc.qb_invoice_id ? deps.qb.getInvoice(conn, String(doc.qb_deposit_invoice_id)) : Promise.resolve(null),
  ]);
  // Deposit invoices only exist when the deposit path minted one, so the
  // server can always route to them (the frontend kill switch hides the UI).
  const target = choosePayTarget({ quote: doc, depositsEnabled: true, liveFinal, liveDeposit });
  if (!target.ok) return { error: json({ rail: "processor", payable: false, reason: target.reason, message: CUSTOMER_REASON[target.reason] ?? CUSTOMER_REASON[NOT_PAYABLE.BAD_AMOUNT], display: r.display }) };
  // Payments already made against this QB invoice: a balance reopened by a
  // refund or return must get a fresh Checkout, not the old one.
  const { data: prior } = await deps.admin.from("processor_payments")
    .select("processor_payin_id")
    .eq("shop_owner", doc.shop_owner)
    .eq("qb_invoice_id", String(target.qbInvoiceId));
  return { target, attempt: prior?.length ?? 0 };
}

/** Public: a Stripe Checkout for a quote or invoice, in the chosen method. */
async function payinSession(body: Any, deps: Deps) {
  const method = normalizePayMethod(body.method) ?? "card";
  const ready = await preparePay(body, deps, { throttleMethod: method });
  if (ready instanceof Response) return ready;
  const { doc, docType, account, display } = ready;
  // The shop chose which ways it takes payment.
  if (!acceptedMethods(account)[method]) {
    const reason = method === "ach" ? "bank_not_accepted" : "card_not_accepted";
    return json({ rail: "processor", payable: false, reason, message: CUSTOMER_REASON[reason], display });
  }
  const live = await liveTarget(deps, ready);
  if ("error" in live) return live.error;
  const { target, attempt } = live;

  // The shop's bank fee, on its own line. (A card surcharge depends on the
  // card, so surcharging shops take cards on our own page: cardQuote/cardPay.)
  const feeCents = method === "ach" ? customerFeeCents({ balanceCents: target.amountCents, method, settings: customerFeeSettings(account) }) : 0;
  const built = buildCheckoutSession({
    doc,
    docType,
    target,
    feeCents,
    method,
    shopName: display.shopName,
    customer: { email: doc.customer_email },
    payPageUrl: payPageUrl(deps, doc, docType),
    attempt,
  });
  let session: Any;
  try {
    session = await deps.stripe.post("/v1/checkout/sessions", built.params, { account: account.merchant_id, idempotencyKey: built.idempotencyKey });
  } catch (err) {
    const e = err as Any;
    // The shop's Stripe account hasn't turned on bank (ACH) payments.
    if (method === "ach" && e?.status === 400 && /us_bank_account|payment method type/i.test(String(e?.message))) {
      return json({ rail: "processor", payable: false, reason: "no_bank", message: CUSTOMER_REASON.no_bank, display });
    }
    // An account / API version that doesn't know wallet_options: once more
    // without it (Link showing beats no checkout at all).
    if (e?.status === 400 && /wallet_options/i.test(String(e?.message))) {
      const { wallet_options: _drop, ...rest } = built.params as Any;
      console.error("[stripePayments] wallet_options refused; checkout shows Link:", String(e?.message).slice(0, 200));
      session = await deps.stripe.post("/v1/checkout/sessions", rest, { account: account.merchant_id, idempotencyKey: `${built.idempotencyKey}:nolink` });
    } else if (e?.status === 400 && /idempotent|idempotency/i.test(String(e?.message))) {
      // A key reused with different params (e.g. the shop changed the
      // customer's email mid-window) → once more under a fresh key.
      session = await deps.stripe.post("/v1/checkout/sessions", built.params, { account: account.merchant_id, idempotencyKey: `${built.idempotencyKey}:r${Date.now()}` });
    } else {
      throw err;
    }
  }
  if (!session?.url) throw new Error("Stripe returned no checkout URL");
  const response = {
    rail: "processor",
    payable: true,
    method,
    kind: target.kind,
    invoiceCents: target.amountCents,
    feeCents,
    amountCents: built.chargeCents,
    checkoutUrl: session.url,
    display,
  };
  await deps.admin.from("processor_pay_sessions")
    .upsert({ doc_id: doc.id, response, created_at: new Date().toISOString() }, { onConflict: "doc_id" });
  return json(response);
}

const CTOKEN_RE = /^ctoken_[A-Za-z0-9_]+$/;

/**
 * The card behind a ConfirmationToken (made by Stripe's card form on our pay
 * page, on the shop's account), or null if Stripe doesn't know the token.
 * Read BEFORE QuickBooks, so a made-up token costs one Stripe call.
 */
async function readCard(deps: Deps, account: Any, confirmationToken: string) {
  let ct: Any;
  try {
    ct = await deps.stripe.get(`/v1/confirmation_tokens/${encodeURIComponent(confirmationToken)}`, undefined, { account: account.merchant_id });
  } catch (err) {
    if ((err as Any)?.status === 404 || (err as Any)?.status === 400) return null;
    throw err;
  }
  const card = ct?.payment_method_preview?.card ?? null;
  return card ? { funding: String(card.funding ?? "unknown"), brand: card.brand ?? null, last4: card.last4 ?? null } : null;
}

/** The surcharge a card carries on this amount: credit → the shop's 2.99%; debit, prepaid or unknown → none. */
function cardPricing(account: Any, target: Any, card: { funding: string; brand: string | null; last4: string | null }) {
  const surchargeCents = customerFeeCents({ balanceCents: target.amountCents, method: "card", funding: card.funding, settings: customerFeeSettings(account) });
  return { ...card, invoiceCents: target.amountCents, surchargeCents, totalCents: target.amountCents + surchargeCents };
}

const CARD_UNREADABLE = { rail: "processor", payable: false, reason: "card_unreadable", message: "That card couldn't be read. Please enter it again." };

/** Customer-facing words for a card the bank turned down. */
function declineMessage(err: Any) {
  const m = String(err?.message ?? "").replace(/^Stripe \w+ \S+ → \d+: /, "");
  return m && m.length < 200 ? m : "Your card was declined. Try another card or pay by bank transfer.";
}

/**
 * Public, step 1 of a card payment on our page: the customer entered a card;
 * show what it will cost (the surcharge, if it's a credit card) before they
 * click Pay. Nothing is charged here.
 */
async function cardQuote(body: Any, deps: Deps) {
  const confirmationToken = String(body.confirmationToken ?? "");
  if (!CTOKEN_RE.test(confirmationToken)) return json({ error: "Not found" }, 404);
  const ready = await preparePay(body, deps);
  if (ready instanceof Response) return ready;
  if (!acceptedMethods(ready.account).card) return json({ rail: "processor", payable: false, reason: "card_not_accepted", message: CUSTOMER_REASON.card_not_accepted, display: ready.display });
  if (!cardFormConfig(ready.account, deps)) return json({ rail: "processor", payable: false, reason: "card_form_off", message: CUSTOMER_REASON.card_form_off, display: ready.display });
  const card = await readCard(deps, ready.account, confirmationToken);
  if (!card) return json(CARD_UNREADABLE);
  const live = await liveTarget(deps, ready);
  if ("error" in live) return live.error;
  return json({ rail: "processor", payable: true, method: "card", kind: live.target.kind, ...cardPricing(ready.account, live.target, card) });
}

/**
 * Public, step 2: charge the card. The amount is worked out again from the
 * LIVE balance; if it no longer matches what the customer was shown, nothing
 * is charged and the page shows the new amount to confirm.
 */
async function cardPay(body: Any, deps: Deps) {
  const confirmationToken = String(body.confirmationToken ?? "");
  if (!CTOKEN_RE.test(confirmationToken)) return json({ error: "Not found" }, 404);
  const ready = await preparePay(body, deps);
  if (ready instanceof Response) return ready;
  const { doc, docType, account } = ready;
  if (!acceptedMethods(account).card) return json({ rail: "processor", payable: false, reason: "card_not_accepted", message: CUSTOMER_REASON.card_not_accepted, display: ready.display });
  if (!cardFormConfig(account, deps)) return json({ rail: "processor", payable: false, reason: "card_form_off", message: CUSTOMER_REASON.card_form_off, display: ready.display });
  const card = await readCard(deps, account, confirmationToken);
  if (!card) return json(CARD_UNREADABLE);
  const live = await liveTarget(deps, ready);
  if ("error" in live) return live.error;
  const price = cardPricing(account, live.target, card);
  if (Number(body.expectTotalCents) !== price.totalCents) {
    return json({ rail: "processor", payable: true, method: "card", changed: true, kind: live.target.kind, ...price });
  }

  const build = (surchargeCents: number) => buildCardPaymentIntent({
    doc, docType, target: live.target, confirmationToken, surchargeCents,
    customer: { email: doc.customer_email },
    payPageUrl: payPageUrl(deps, doc, docType),
  });
  let built = build(price.surchargeCents);
  let pi: Any;
  try {
    pi = await deps.stripe.post("/v1/payment_intents", built.params, {
      account: account.merchant_id,
      idempotencyKey: built.idempotencyKey,
      ...(price.surchargeCents > 0 ? { version: STRIPE_SURCHARGE_API_VERSION } : {}),
    });
  } catch (err) {
    const e = err as Any;
    // Declined card (402): Stripe's message is written for the cardholder.
    if (e?.status === 402) return json({ rail: "processor", payable: true, declined: true, message: declineMessage(e) });
    // Stripe won't take the surcharge on this card (its rules, the preview
    // isn't on for this account, or the preview API version was retired):
    // charge the invoice without it — never more than the customer agreed
    // to — and tell the shop. A retired version must not stop card payments.
    if (price.surchargeCents > 0 && e?.status === 400 && /surcharge|api version|stripe-version/i.test(String(e?.message))) {
      console.error(`[stripePayments] surcharge refused for ${account.merchant_id}; charging without it: ${String(e?.message).slice(0, 300)}`);
      // Never silent: if Stripe stops taking surcharges, every credit card
      // would quietly go through at the plain price. The shop hears about it
      // (and the 6am health check counts these notices).
      await insertShopNotification(deps.admin, {
        shopOwner: doc.shop_owner,
        eventType: "surcharge_refused",
        severity: "warning",
        title: `Credit card surcharge not applied: ${docType === "invoice" ? doc.invoice_id : doc.quote_id}`,
        body: `Stripe didn't accept the $${(price.surchargeCents / 100).toFixed(2)} surcharge on this card, so your customer was charged the plain amount and you paid the card fee. If this keeps happening, contact InkTracker support.`,
        metadata: { processor: "stripe", merchant_id: account.merchant_id, reason: String(e?.message ?? "").slice(0, 300) },
      });
      built = build(0);
      try {
        pi = await deps.stripe.post("/v1/payment_intents", built.params, { account: account.merchant_id, idempotencyKey: built.idempotencyKey });
      } catch (e2) {
        if ((e2 as Any)?.status === 402) return json({ rail: "processor", payable: true, declined: true, message: declineMessage(e2) });
        throw e2;
      }
    } else {
      throw err;
    }
  }
  const charged = Number(pi?.amount) || built.chargeCents;
  const base = { rail: "processor", payable: true, method: "card", paymentIntentId: pi?.id ?? null, amountCents: charged, surchargeCents: charged - live.target.amountCents };
  if (pi?.status === "succeeded" || pi?.status === "processing") {
    await markJustPaid(deps.admin, doc.id, String(pi.id));
    return json({ ...base, state: pi.status === "succeeded" ? "paid" : "processing" });
  }
  // The card's bank wants to check it's really them (3-D Secure): the page
  // finishes it with Stripe.js. The client secret only ever goes to the
  // person paying.
  if (pi?.status === "requires_action") return json({ ...base, requiresAction: true, clientSecret: pi.client_secret });
  return json({ rail: "processor", payable: true, declined: true, message: declineMessage({ message: pi?.last_payment_error?.message }) });
}

/**
 * Public: did this Checkout really pay? The pay page asks when Stripe sends
 * the customer back (?paid=…&session_id=…) so "Payment received" is never
 * shown on the strength of a URL anyone can type. The session must be on
 * the shop's own account AND belong to this document.
 */
async function paidStatus(body: Any, deps: Deps) {
  const found = await loadPublicDoc(deps.admin, body);
  if (!found) return json({ error: "Not found" }, 404);
  const { doc } = found;
  const account = await loadAccount(deps.admin, doc.shop_owner, deps.stripe.live);
  if (!account?.merchant_id) return json({ confirmed: false });
  // A card paid on our own page (after the bank's card check, Stripe sends
  // the customer back with ?payment_intent=pi_…).
  const piId = String(body.paymentIntentId ?? "");
  if (/^pi_[A-Za-z0-9]+$/.test(piId)) {
    let pi: Any;
    try {
      pi = await deps.stripe.get(`/v1/payment_intents/${encodeURIComponent(piId)}`, undefined, { account: account.merchant_id });
    } catch {
      return json({ confirmed: false });
    }
    if (String(pi?.metadata?.inktracker_quote_id ?? "") !== String(doc.id)) return json({ confirmed: false });
    if (pi?.status === "succeeded" || pi?.status === "processing") {
      await markJustPaid(deps.admin, doc.id, piId);
      return json({ confirmed: true, state: pi.status === "succeeded" ? "paid" : "processing" });
    }
    return json({ confirmed: false, failed: pi?.status === "requires_payment_method" });
  }
  const sessionId = String(body.sessionId ?? "");
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) return json({ confirmed: false });
  let cs: Any;
  try {
    cs = await deps.stripe.get(`/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, undefined, { account: account.merchant_id });
  } catch {
    return json({ confirmed: false });
  }
  if (String(cs?.client_reference_id ?? "") !== String(doc.id) || cs?.status !== "complete") return json({ confirmed: false });
  await markJustPaid(deps.admin, doc.id, sessionId);
  // Card: paid now. Bank: submitted, clears in days.
  return json({ confirmed: true, state: cs.payment_status === "paid" ? "paid" : "processing" });
}

export async function handle(req: Request, deps: Deps) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "status");

  if (action === "payinSession") return payinSession(body, deps);
  if (action === "cardQuote") return cardQuote(body, deps);
  if (action === "cardPay") return cardPay(body, deps);
  if (action === "payRail") return payRail(body, deps);
  if (action === "paidStatus") return paidStatus(body, deps);

  const token = body.accessToken || req.headers.get("Authorization")?.replace("Bearer ", "") || "";
  if (!token) return json({ error: "Unauthorized" }, 401);
  const user = await deps.getUser(token);
  if (!user) return json({ error: "Unauthorized" }, 401);

  const admin = deps.admin;
  const viewer = await loadProfileWithSecrets(admin, { auth_id: user.id });
  if (!canViewPayments(viewer)) return json({ error: "Not available for this account." }, 403);
  const { profile: shop } = await loadShopProfileForUser(admin, user.id);
  if (!shop?.email) return json({ error: "Shop not found" }, 404);
  const shopOwner = String(shop.email);
  const envEnabled = paymentsOpenFor(deps.env("STRIPE_PAYMENTS_ENABLED"), deps.env("STRIPE_PAYMENTS_SHOPS"), shopOwner);
  const live = deps.stripe.live;
  const account = await loadAccount(admin, shopOwner, live);
  const clientId = deps.env("STRIPE_CONNECT_CLIENT_ID") ?? "";
  const status = async () => {
    const acct = await loadAccount(admin, shopOwner, live);
    return json({
      ...buildStatusPayload({ envEnabled, account: acct, viewer }),
      payingPlan: isPayingShop(shop),
      // Test-mode key: the card says so, and only TEST/DEMO documents use
      // Stripe (paymentRail.isTestDocument), so testing never touches a real
      // customer.
      testMode: !live,
      // "I already have a Stripe account" needs the platform's Connect client id.
      canConnectExisting: Boolean(clientId) && canTogglePayments(viewer) && (!acct?.merchant_id || canStartOver(acct)),
      // Card surcharges need InkTracker's card form (publishable key set).
      cardSurchargeReady: Boolean(cardFormConfig({ ...acct, customer_fees_enabled: true }, deps)),
      // The note quotes, invoices and emails carry (empty when fees are off).
      customerFeeNote: customerFeeNote(effectiveCustomerFees(acct, { cardFormReady: Boolean(cardFormConfig(acct, deps)) }), { shopName: shop.shop_name, accepts: acceptedMethods(acct) }),
      acceptedMethods: acceptedMethods(acct),
      // Card surcharges are banned in some states: the owner can't turn them on there.
      surchargeBannedIn: surchargeBannedState(shop.state),
    });
  };

  if (action === "status") return status();

  if (action === "startOnboarding") {
    if (!canTogglePayments(viewer)) return json({ error: "Only the shop owner can sign up for payments." }, 403);
    if (!envEnabled) return json({ error: "InkTracker payments aren't available yet." }, 400);
    if (!isPayingShop(shop)) return json({ error: "InkTracker payments are available on a paid plan." }, 403);
    // The platform client id is what lets InkTracker disconnect this account
    // later (a shop deleting InkTracker must not leave us with access to its
    // Stripe). No account comes into being without it.
    if (!clientId) {
      console.error("[stripePayments] STRIPE_CONNECT_CLIENT_ID is not set; refusing sign-up");
      return json({ error: "InkTracker payments aren't available yet." }, 400);
    }
    // A closed account (rejected / disconnected), or one from the other
    // Stripe mode, is replaced with a new one.
    const startOver = canStartOver(account) || Boolean(account?.modeMismatch);
    let accountId = startOver ? null : (account?.merchant_id ?? null);
    if (onboardingStage(account) === "active") return json({ error: "Your Stripe account is already set up." }, 400);
    if (!accountId) {
      // One account per shop: claim creation first so two clicks (or two
      // tabs) can't create two accounts.
      const nowIso = new Date().toISOString();
      if (!account) {
        await admin.from("processor_accounts").upsert({ shop_owner: shopOwner }, { onConflict: "shop_owner", ignoreDuplicates: true });
      }
      const { data: claimed } = await admin.from("processor_accounts")
        .update({ merchant_creating_at: nowIso })
        .eq("shop_owner", shopOwner)
        .or(`merchant_creating_at.is.null,merchant_creating_at.lt."${new Date(Date.now() - 2 * 60 * 1000).toISOString()}"`)
        .select("shop_owner, merchant_id");
      if (!claimed?.length) return json({ error: "Sign-up is already opening. Try again in a moment." }, 409);
      if (claimed[0].merchant_id && !startOver) {
        await admin.from("processor_accounts").update({ merchant_creating_at: null }).eq("shop_owner", shopOwner);
        return json({ error: "Sign-up is ready. Click Continue sign-up." }, 409);
      }
      // An account from an earlier attempt whose save failed? Adopt it —
      // never create a second account for the same shop. (Not when starting
      // over: the old one is the closed account being replaced.)
      let acct: Any;
      try {
        acct = startOver ? null : await findOurAccount(deps, shopOwner);
        if (!acct) {
          // Keyed per 10 minutes: a double-click gets the same account, but a
          // create that FAILED (e.g. Connect not switched on yet) isn't
          // replayed for 24h once it's fixed. Older orphans are adopted above.
          const windowKey = Math.floor(Date.now() / (10 * 60 * 1000));
          acct = await deps.stripe.post("/v1/accounts", buildAccountCreate(shop, shopOwner), {
            idempotencyKey: `it-acct:${shopOwner}:${startOver ? "new" : "first"}:${windowKey}`,
          });
        }
      } catch (err) {
        // Nothing was saved: release the claim so the owner can retry now.
        await admin.from("processor_accounts").update({ merchant_creating_at: null }).eq("shop_owner", shopOwner);
        throw err;
      }
      accountId = acct?.id;
      if (!accountId) throw new Error("Stripe returned no account id");
      const patch = {
        shop_owner: shopOwner,
        // A new Stripe account (or test → live) starts with fees OFF: card
        // surcharging needs the owner's confirmation (incl. notice to Stripe)
        // for THIS account, not one given for the sandbox.
        ...(startOver ? { enabled: false, enabled_at: null, onboarded_at: null, ...FEES_OFF } : {}),
        merchant_id: accountId,
        merchant_application_id: null,
        stripe_livemode: live,
        ...accountStatusFields(acct),
        merchant_creating_at: null,
        updated_at: new Date().toISOString(),
      };
      let saved = false;
      for (let i = 0; i < 3 && !saved; i++) {
        const { error } = await admin.from("processor_accounts").upsert(patch, { onConflict: "shop_owner" });
        saved = !error;
      }
      // Claim stays set; the next attempt (after it goes stale) adopts this
      // account via findOurAccount instead of creating another.
      if (!saved) throw new Error(`Couldn't save the new Stripe account ${accountId}; the next sign-up attempt will pick it up`);
    }
    const link = await deps.stripe.post("/v1/account_links", buildAccountLink(accountId, appUrl(deps)));
    if (!link?.url) throw new Error("Stripe returned no sign-up link");
    return json({ url: link.url });
  }

  if (action === "connectExisting") {
    if (!canTogglePayments(viewer)) return json({ error: "Only the shop owner can connect a Stripe account." }, 403);
    if (!envEnabled) return json({ error: "InkTracker payments aren't available yet." }, 400);
    if (!isPayingShop(shop)) return json({ error: "InkTracker payments are available on a paid plan." }, 403);
    if (!clientId) return json({ error: "Connecting an existing Stripe account isn't available yet." }, 400);
    if (account?.merchant_id && !canStartOver(account)) {
      return json({ error: "This shop already has a Stripe account set up for InkTracker." }, 400);
    }
    const state = crypto.randomUUID();
    const { error } = await admin.from("processor_accounts").upsert({
      shop_owner: shopOwner, oauth_state: state, oauth_state_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }, { onConflict: "shop_owner" });
    if (error) return json({ error: `Couldn't start: ${error.message}` }, 500);
    return json({ url: buildConnectOAuthUrl({ clientId, state, appUrl: appUrl(deps), shopOwner, shopName: shop.shop_name }) });
  }

  if (action === "finishConnect") {
    if (!canTogglePayments(viewer)) return json({ error: "Only the shop owner can connect a Stripe account." }, 403);
    const code = String(body.code ?? "");
    const st = String(body.state ?? "");
    // One-time, unexpired, and issued to THIS shop — else someone could link
    // their Stripe account to another shop with a stolen redirect.
    const issued = account?.oauth_state ? String(account.oauth_state) : "";
    const fresh = account?.oauth_state_at && Date.now() - new Date(account.oauth_state_at).getTime() < OAUTH_STATE_TTL_MS;
    if (!code || !st || !issued || !safeEquals(st, issued) || !fresh) {
      return json({ error: "That Stripe connection link expired. Click \"I already have a Stripe account\" again." }, 400);
    }
    await admin.from("processor_accounts").update({ oauth_state: null, oauth_state_at: null }).eq("shop_owner", shopOwner);
    let tok: Any;
    try {
      tok = await deps.stripe.oauthToken(code);
    } catch (err) {
      console.error("[stripePayments] oauth token exchange failed:", (err as Error).message);
      return json({ error: "Stripe didn't confirm the connection. Try connecting again." }, 400);
    }
    const accountId = String(tok?.stripe_user_id ?? "");
    if (!accountId) return json({ error: "Stripe didn't confirm the connection. Try connecting again." }, 400);
    const { data: taken } = await admin.from("processor_accounts").select("shop_owner").eq("merchant_id", accountId).maybeSingle();
    if (taken && taken.shop_owner !== shopOwner) {
      return json({ error: "That Stripe account is already connected to another InkTracker shop." }, 409);
    }
    const acct = await deps.stripe.get(`/v1/accounts/${encodeURIComponent(accountId)}`);
    const fields = accountStatusFields(acct);
    const { error } = await admin.from("processor_accounts").upsert({
      shop_owner: shopOwner,
      merchant_id: accountId,
      merchant_application_id: null,
      stripe_livemode: live,
      enabled: false,
      enabled_at: null,
      ...FEES_OFF,
      ...fields,
      ...(fields.merchant_status === "active" ? { onboarded_at: new Date().toISOString() } : {}),
      updated_at: new Date().toISOString(),
    }, { onConflict: "shop_owner" });
    if (error) return json({ error: `Couldn't save: ${error.message}` }, 500);
    return status();
  }

  if (action === "refreshStatus") {
    if (!account?.merchant_id) return status();
    const acct = await deps.stripe.get(`/v1/accounts/${encodeURIComponent(account.merchant_id)}`);
    const fields = accountStatusFields(acct);
    const becameActive = fields.merchant_status === "active" && account.merchant_status !== "active";
    await admin.from("processor_accounts")
      .update({ ...fields, ...(becameActive ? { onboarded_at: new Date().toISOString() } : {}), updated_at: new Date().toISOString() })
      .eq("shop_owner", shopOwner);
    return status();
  }

  if (action === "qbAccounts") {
    if (!canMapQbAccounts(viewer)) return json({ error: "Only the owner or a manager can set this up." }, 403);
    const conn = await deps.qb.connect(shopOwner);
    if (!conn) return json({ error: "Connect QuickBooks first." }, 400);
    return json(qbAccountChoices(await deps.qb.listAccounts(conn)));
  }

  if (action === "saveQbAccounts") {
    if (!canMapQbAccounts(viewer)) return json({ error: "Only the owner or a manager can set this up." }, 403);
    const conn = await deps.qb.connect(shopOwner);
    if (!conn) return json({ error: "Connect QuickBooks first." }, 400);
    // Validate against the LIVE chart of accounts — never store an id the
    // browser made up.
    const v = validateQbAccountMapping({
      bankAccountId: body.bankAccountId,
      feeAccountId: body.feeAccountId,
      qbAccounts: await deps.qb.listAccounts(conn),
    });
    if (!v.ok) return json({ error: v.error }, 400);
    const { error } = await admin.from("processor_accounts").upsert({
      shop_owner: shopOwner,
      qb_bank_account_id: v.bankAccountId,
      qb_fee_account_id: v.feeAccountId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "shop_owner" });
    if (error) return json({ error: `Couldn't save: ${error.message}` }, 500);
    return status();
  }

  if (action === "setAcceptedMethods") {
    if (!canTogglePayments(viewer)) return json({ error: "Only the shop owner can change how customers pay." }, 403);
    if (!account) return json({ error: "Set up payments first." }, 400);
    const card = body.card === true;
    const bank = body.bank === true;
    if (!card && !bank) return json({ error: "Keep at least one way to pay turned on." }, 400);
    const { error } = await admin.from("processor_accounts")
      .update({ accept_card: card, accept_bank: bank, updated_at: new Date().toISOString() })
      .eq("shop_owner", shopOwner);
    if (error) return json({ error: `Couldn't save: ${error.message}` }, 500);
    return status();
  }

  if (action === "setCustomerFees") {
    if (!canTogglePayments(viewer)) return json({ error: "Only the shop owner can change processing fees." }, 403);
    if (!account) return json({ error: "Set up payments first." }, 400);
    const want = body.enabled === true;
    const banned = surchargeBannedState(shop.state);
    if (want && banned) return json({ error: `Card surcharges aren't allowed in ${banned}, so this can't be turned on for your shop.` }, 400);
    const bankPct = normalizeBankFeePct(body.bankFeePct ?? account.bank_fee_pct);
    if (bankPct === null) return json({ error: "Enter a bank fee from 0% to 1%." }, 400);
    // Card surcharges are the shop's legal call (some states ban or cap
    // them; Visa wants notice first). Turning it on needs the owner's okay.
    if (want && !account.customer_fees_enabled && body.acknowledged !== true) {
      return json({ error: "Confirm that card surcharges are allowed for your business first." }, 400);
    }
    const now = new Date().toISOString();
    const { error } = await admin.from("processor_accounts")
      .update({
        customer_fees_enabled: want,
        bank_fee_pct: bankPct,
        ...(want && !account.customer_fees_enabled ? { customer_fees_ack_at: now } : {}),
        updated_at: now,
      })
      .eq("shop_owner", shopOwner);
    if (error) return json({ error: `Couldn't save: ${error.message}` }, 500);
    return status();
  }

  if (action === "setEnabled") {
    const want = body.enabled === true;
    const gate = want ? checkCanEnable({ envEnabled, account, viewer, payingPlan: isPayingShop(shop) }) : checkCanDisable({ viewer });
    if (!gate.ok) return json({ error: gate.error }, want ? 400 : 403);
    if (!account && !want) return status();
    const now = new Date().toISOString();
    const { error } = await admin.from("processor_accounts")
      .update({
        enabled: want,
        enabled_at: want ? now : null,
        ...(want && !account?.processor_used_at ? { processor_used_at: now } : {}),
        updated_at: now,
      })
      .eq("shop_owner", shopOwner);
    if (error) return json({ error: `Couldn't save: ${error.message}` }, 500);
    return status();
  }

  return json({ error: `Unknown action: ${action}` }, 400);
}

if (import.meta.main) {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const env = (k: string) => Deno.env.get(k);
  Deno.serve(async (req) => {
    try {
      return await handle(req, {
        admin,
        getUser: async (token) => {
          const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
            global: { headers: { Authorization: `Bearer ${token}` } },
          });
          const { data: { user } } = await userClient.auth.getUser(token);
          return user ?? null;
        },
        env,
        stripe: stripeApi(env),
        qb: {
          connect: (shop) => getShopQb(admin, shop),
          listAccounts: qbListAccounts,
          getInvoice: qbGetInvoice,
        },
      });
    } catch (err) {
      console.error("[stripePayments]", err);
      // Stripe refused the request (4xx): say why, in Stripe's words, instead
      // of a bare server error. Its messages are written for end users.
      if (err instanceof StripeError && err.status >= 400 && err.status < 500) {
        const why = String(err.message).replace(/^Stripe \w+ \S+ → \d+: /, "").slice(0, 200);
        return json({ error: `Stripe couldn't do that: ${why}` }, 400);
      }
      return json({ error: "Something went wrong. Try again in a moment." }, 500);
    }
  });
}
