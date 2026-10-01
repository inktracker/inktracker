// Stripe Connect webhook → InkTracker's neutral payment events (pure, tested).
//
// The endpoint is a CONNECT endpoint: every event comes from a shop's own
// Stripe account (`event.account`). A Standard account is the shop's whole
// Stripe account, so it can carry sales that have nothing to do with
// InkTracker (an online store, a terminal). Only PaymentIntents InkTracker
// created — they carry our metadata — are ours; everything else is ignored,
// never recorded or booked.
//
// SIGNATURES: header `Stripe-Signature: t=<unix>,v1=<hex>[,v1=…]`;
// v1 = HMAC-SHA256(secret, `${t}.${rawBody}`) as hex, keyed with the whole
// `whsec_…` string (stripe.com/docs/webhooks#verify-manually). Unverifiable
// → reject. Delivery is at-least-once; dedupe key = event.id.

import { PAYIN_EVENT } from "./payinEffect.js";
import { normalizePayMethod } from "./paymentsPricing.js";
import { PAYOUT_ITEM } from "./payoutPlan.js";

export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const toHex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Verify a Stripe webhook. Returns { ok:true } or { ok:false, reason }.
 * @param {object} a
 * @param {string} a.secret     endpoint signing secret ("whsec_…")
 * @param {string} a.rawBody    the EXACT request body text
 * @param {string|null} a.header Stripe-Signature header
 * @param {number} [a.nowSeconds]
 */
export async function verifyStripeSignature({ secret, rawBody, header, nowSeconds = Math.floor(Date.now() / 1000) }) {
  if (!secret || !String(secret).startsWith("whsec_")) return { ok: false, reason: "no_secret_configured" };
  if (!header) return { ok: false, reason: "missing_signature_header" };
  const parts = String(header).split(",").map((p) => p.trim().split("="));
  const t = parts.find(([k]) => k === "t")?.[1];
  const sigs = parts.filter(([k, v]) => k === "v1" && v).map(([, v]) => v);
  const ts = Number(t);
  if (!t || !Number.isInteger(ts)) return { ok: false, reason: "bad_timestamp" };
  if (!sigs.length) return { ok: false, reason: "no_v1_signature" };
  if (Math.abs(nowSeconds - ts) > SIGNATURE_TOLERANCE_SECONDS) return { ok: false, reason: "timestamp_out_of_tolerance" };
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(secret)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${rawBody}`)));
  return sigs.some((s) => constantTimeEqual(s, expected)) ? { ok: true } : { ok: false, reason: "signature_mismatch" };
}

/** Did InkTracker create this payment? (Our metadata rides on the PaymentIntent.) */
export function isOurs(metadata) {
  const md = metadata ?? {};
  return ["quote", "invoice"].includes(md.inktracker_doc_type) && Boolean(md.inktracker_quote_id);
}

const isoFromUnix = (u) => (Number.isFinite(Number(u)) && Number(u) > 0 ? new Date(Number(u) * 1000).toISOString() : null);
const idOf = (x) => (typeof x === "string" ? x : x?.id ?? null);

/** card | ach | null for a PaymentIntent. */
export function methodOfPaymentIntent(pi) {
  const charge = typeof pi?.latest_charge === "object" ? pi.latest_charge : null;
  return normalizePayMethod(charge?.payment_method_details?.type ?? pi?.payment_method_types?.[0]);
}

/**
 * Neutral event from a PaymentIntent (from a payment_intent.* webhook, or
 * the PaymentIntent re-fetched for a refund / dispute).
 * @param {string} kind       PAYIN_EVENT value
 * @param {object} pi         Stripe PaymentIntent
 * @param {string} accountId  connected account the money went to (event.account)
 */
export function paymentIntentToEvent(kind, pi, accountId, { reversalCents, occurredAt } = {}) {
  return {
    kind,
    payinId: pi?.id ?? null,
    merchantId: accountId ?? null,
    // The amount charged. (amount_received is 0 while a bank payment clears.)
    amountCents: Number(pi?.amount),
    method: methodOfPaymentIntent(pi),
    metadata: pi?.metadata ?? {},
    occurredAt: occurredAt ?? null,
    // When the customer paid — the QuickBooks date, even for a bank payment
    // that is only booked once it clears days later.
    paidAt: isoFromUnix(pi?.created),
    // Test or live money (never book test money into a shop's QuickBooks).
    ...(typeof pi?.livemode === "boolean" ? { livemode: pi.livemode } : {}),
    // InkTracker's fee as Stripe actually charged it (null on the
    // PaymentIntent = no fee), not re-derived from today's price table.
    ...(pi && "application_fee_amount" in pi ? { platformFeeCents: Number.isInteger(pi.application_fee_amount) ? pi.application_fee_amount : 0 } : {}),
    ...(Number.isInteger(reversalCents) ? { reversalCents } : {}),
  };
}

const PI_STATUS = {
  processing: PAYIN_EVENT.PROCESSING,
  succeeded: PAYIN_EVENT.SUCCEEDED,
  canceled: PAYIN_EVENT.CANCELED,
};

/** PaymentIntent status → neutral kind, for the nightly backstop. */
export function kindForPaymentIntentStatus(status) {
  return PI_STATUS[String(status ?? "")] ?? null;
}

/**
 * Route one Stripe event. Returns one of:
 *   { route: "payin", event }                                  → planPayinEffect
 *   { route: "fetch_payin", payinId, kind, reversalCents }     refunds/disputes:
 *        the handler GETs the PaymentIntent (authoritative amount + metadata,
 *        and whether it's ours) and builds the event from it. kind
 *        "dispute_opened" resolves to DISPUTED (card) or RETURNED (bank).
 *   { route: "merchant", merchantId }                          re-read the account
 *   { route: "deauthorized", merchantId }                      shop disconnected us
 *   { route: "payout", payoutId, status }                      paid → book; failed → alert
 *   { route: "dispute_won", payinId, amountCents }
 *   { route: "ignore", reason }
 */
export function routeStripeEvent(evt) {
  const type = String(evt?.type ?? "");
  const obj = evt?.data?.object ?? {};
  const account = evt?.account ?? null;
  if (!account) return { route: "ignore", reason: "platform_event" };
  const occurredAt = isoFromUnix(evt?.created);

  if (type.startsWith("payment_intent.")) {
    if (!isOurs(obj.metadata)) return { route: "ignore", reason: "not_inktracker" };
    if (type === "payment_intent.payment_failed") {
      // A declined card on Checkout is retried on the SAME PaymentIntent —
      // recording "failed" would block its later success. Only a bank
      // payment failing after it started is news.
      if (methodOfPaymentIntent(obj) !== "ach") return { route: "ignore", reason: "card_decline_retry" };
      return { route: "payin", event: paymentIntentToEvent(PAYIN_EVENT.FAILED, obj, account, { occurredAt }) };
    }
    const kind = PI_STATUS[type.slice("payment_intent.".length)];
    return kind
      ? { route: "payin", event: paymentIntentToEvent(kind, obj, account, { occurredAt }) }
      : { route: "ignore", reason: type };
  }

  if (type === "charge.refunded") {
    const total = Number(obj.amount_refunded);
    const before = Number(evt?.data?.previous_attributes?.amount_refunded ?? 0);
    const delta = Number.isInteger(total) ? total - (Number.isInteger(before) ? before : 0) : NaN;
    return {
      route: "fetch_payin",
      payinId: idOf(obj.payment_intent),
      kind: obj.refunded === true ? PAYIN_EVENT.REFUNDED : PAYIN_EVENT.PARTIALLY_REFUNDED,
      reversalCents: Number.isInteger(delta) && delta > 0 ? delta : undefined,
      merchantId: account,
    };
  }
  if (type === "charge.dispute.created") {
    const amt = Number(obj.amount);
    return { route: "fetch_payin", payinId: idOf(obj.payment_intent), kind: "dispute_opened", reversalCents: Number.isInteger(amt) ? amt : undefined, merchantId: account };
  }
  if (type === "charge.dispute.closed") {
    const amt = Number(obj.amount);
    if (obj.status === "lost") return { route: "fetch_payin", payinId: idOf(obj.payment_intent), kind: PAYIN_EVENT.CHARGED_BACK, reversalCents: Number.isInteger(amt) ? amt : undefined, merchantId: account };
    if (obj.status === "won") return { route: "dispute_won", payinId: idOf(obj.payment_intent), amountCents: Number.isInteger(amt) ? amt : undefined, merchantId: account };
    return { route: "ignore", reason: `charge.dispute.closed:${obj.status}` };
  }
  if (type === "payout.paid" || type === "payout.failed") {
    return { route: "payout", payoutId: obj.id ?? null, status: type === "payout.paid" ? "paid" : "failed", merchantId: account };
  }
  if (type === "account.updated") return { route: "merchant", merchantId: account };
  if (type === "account.application.deauthorized") return { route: "deauthorized", merchantId: account };
  return { route: "ignore", reason: type || "unknown" };
}

/**
 * processor_accounts status columns from a Stripe account object, in the
 * vocabulary paymentsAccount.onboardingStage reads:
 *   merchant_status: pending | onboarding | active | suspended | deactivated | canceled
 *   merchant_application_status: in_progress | needs_information | in_review | completed | declined
 */
export function accountStatusFields(acct) {
  if (!acct || acct.deleted) return { merchant_status: "canceled", merchant_application_status: "declined" };
  const reason = String(acct.requirements?.disabled_reason ?? "");
  const due = [...(acct.requirements?.currently_due ?? []), ...(acct.requirements?.past_due ?? [])].length > 0;
  const live = acct.charges_enabled === true && acct.payouts_enabled === true;
  if (reason.startsWith("rejected")) return { merchant_status: "deactivated", merchant_application_status: "declined" };
  if (live) return { merchant_status: "active", merchant_application_status: due ? "needs_information" : "completed" };
  if (["listed", "platform_paused", "under_review"].includes(reason) && acct.details_submitted) {
    return { merchant_status: reason === "under_review" ? "onboarding" : "suspended", merchant_application_status: "in_review" };
  }
  if (!acct.details_submitted) return { merchant_status: "pending", merchant_application_status: "in_progress" };
  if (due || reason.startsWith("requirements.past_due")) return { merchant_status: "onboarding", merchant_application_status: "needs_information" };
  return { merchant_status: "onboarding", merchant_application_status: "in_review" };
}

/**
 * Balance transactions of one payout (GET /v1/balance_transactions?payout=…
 * with expand[]=data.source and data.source.payment_intent) → neutral payout
 * items for planPayoutDeposit. The payout's own row is skipped.
 */
export function payoutItemsFromBalanceTransactions(bts) {
  const out = [];
  for (const bt of Array.isArray(bts) ? bts : []) {
    const type = String(bt?.type ?? "");
    if (type === "payout") continue;
    const gross = Number(bt?.amount);
    const fee = Number(bt?.fee) || 0;
    const src = typeof bt?.source === "object" ? bt.source : null;
    if (type === "charge" || type === "payment") {
      const pi = typeof src?.payment_intent === "object" ? src.payment_intent : null;
      out.push({
        type: PAYOUT_ITEM.PAYMENT,
        payinId: idOf(src?.payment_intent),
        grossCents: gross,
        feeCents: fee,
        // Only known when the PaymentIntent was expanded; unknown → let the
        // ledger decide (wait, then a person).
        ...(pi ? { ours: isOurs(pi.metadata) } : {}),
      });
    } else if (type === "refund" || type === "payment_refund") {
      out.push({ type: PAYOUT_ITEM.REFUND, grossCents: gross, feeCents: fee });
    } else if (type === "payment_failure_refund") {
      out.push({ type: PAYOUT_ITEM.ACH_RETURN, grossCents: gross, feeCents: fee });
    } else if (type === "adjustment" && /^(dp|du)_/.test(String(idOf(bt?.source) ?? ""))) {
      out.push({ type: PAYOUT_ITEM.DISPUTE, grossCents: gross, feeCents: fee });
    } else if (type === "stripe_fee" || type === "stripe_fx_fee" || type === "tax_fee") {
      out.push({ type: PAYOUT_ITEM.FEE, grossCents: gross, feeCents: fee });
    } else {
      out.push({ type: PAYOUT_ITEM.OTHER, grossCents: gross, feeCents: fee, label: type || "unknown" });
    }
  }
  return out;
}

/** A Stripe list response → { items, hasMore, lastId } for starting_after paging. */
export function readStripeList(data) {
  const items = Array.isArray(data?.data) ? data.data : [];
  return { items, hasMore: data?.has_more === true, lastId: items.length ? items[items.length - 1]?.id ?? null : null };
}
