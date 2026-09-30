// Rainforest webhook → InkTracker's neutral payment events (pure, tested).
//
// Payload: { data: <full GET object of the resource>, event_type: "resource.status" }
// (docs.rainforestpay.com/docs/webhooks-and-notifications). Delivery is
// at-least-once; dedupe key = resource id + event_type (the docs' advice).
//
// SIGNATURES: the docs say each endpoint has a signing key in the Portal; the
// verify recipe page is gone. Everything about delivery (retry schedule,
// message.attempt.exhausted, auto-disable, replay) is Svix, so verification
// is standard Svix: HMAC-SHA256 over `${svix-id}.${svix-timestamp}.${rawBody}`
// keyed with the base64 part of the `whsec_` secret, header `svix-signature`
// = space-separated `v1,<base64>`. CONFIRM header names on the first sandbox
// delivery (docs/rainforest-payments.md test plan). Unverifiable → reject.

import { PAYIN_EVENT } from "./rainforestPayinEffect.js";

export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s);
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verify a Svix-signed webhook. Returns { ok:true } or { ok:false, reason }.
 * @param {object} a
 * @param {string} a.secret     endpoint signing secret ("whsec_…")
 * @param {string} a.rawBody    the EXACT request body text
 * @param {string|null} a.id        svix-id header
 * @param {string|null} a.timestamp svix-timestamp header (unix seconds)
 * @param {string|null} a.signature svix-signature header
 * @param {number} [a.nowSeconds]
 */
export async function verifyWebhookSignature({ secret, rawBody, id, timestamp, signature, nowSeconds = Math.floor(Date.now() / 1000) }) {
  if (!secret || !String(secret).startsWith("whsec_")) return { ok: false, reason: "no_secret_configured" };
  if (!id || !timestamp || !signature) return { ok: false, reason: "missing_signature_headers" };
  const ts = Number(timestamp);
  if (!Number.isInteger(ts)) return { ok: false, reason: "bad_timestamp" };
  if (Math.abs(nowSeconds - ts) > SIGNATURE_TOLERANCE_SECONDS) return { ok: false, reason: "timestamp_out_of_tolerance" };
  let keyBytes;
  try {
    keyBytes = b64ToBytes(String(secret).slice("whsec_".length));
  } catch {
    return { ok: false, reason: "bad_secret" };
  }
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`));
  const expected = bytesToB64(mac);
  const candidates = String(signature).split(" ")
    .map((part) => part.split(","))
    .filter(([v, sig]) => v === "v1" && sig)
    .map(([, sig]) => sig);
  return candidates.some((sig) => constantTimeEqual(sig, expected))
    ? { ok: true }
    : { ok: false, reason: "signature_mismatch" };
}

const lc = (s) => String(s ?? "").toLowerCase();
const methodOf = (t) => {
  const m = String(t ?? "").toUpperCase();
  if (m === "CARD" || m === "APPLE_PAY" || m === "GOOGLE_PAY") return "card";
  if (m === "ACH" || m === "PLAID_ACH") return "ach";
  return null;
};

/** Which Rainforest object an event is about, for routing. */
export function classifyEvent(eventType) {
  const [resource, status] = String(eventType ?? "").split(".");
  return { resource: resource ?? "", status: status ?? "" };
}

/** Dedupe key (docs: resource id + event_type). */
export function webhookDedupeKey(body) {
  const d = body?.data ?? {};
  const rid = d.payin_id && classifyEvent(body?.event_type).resource === "payin" ? d.payin_id
    : d.refund_id ?? d.chargeback_id ?? d.ach_return_id ?? d.deposit_id ?? d.merchant_application_id ?? d.merchant_id ?? d.payin_id ?? null;
  return rid && body?.event_type ? `${rid}:${body.event_type}` : null;
}

// payin.<status> → PAYIN_EVENT. Anything not listed is recorded nowhere
// (created/authorized/presenting are pre-capture; in_review is a risk hold
// that later moves to processing/succeeded/canceled).
const PAYIN_STATUS = {
  processing: PAYIN_EVENT.PROCESSING,
  succeeded: PAYIN_EVENT.SUCCEEDED,
  failed: PAYIN_EVENT.FAILED,
  canceled: PAYIN_EVENT.CANCELED,
  returned: PAYIN_EVENT.RETURNED,
};

/**
 * Neutral event from a PAYIN object (from a payin.* webhook, or the payin
 * re-fetched for a refund/chargeback/return event).
 * @param {string} kind   PAYIN_EVENT value
 * @param {object} payin  Rainforest payin object
 */
export function payinToEvent(kind, payin, { reversalCents, occurredAt } = {}) {
  return {
    kind,
    payinId: payin?.payin_id ?? null,
    merchantId: payin?.merchant_id ?? null,
    amountCents: Number(payin?.amount),
    method: methodOf(payin?.method_type),
    metadata: payin?.metadata ?? {},
    occurredAt: occurredAt ?? payin?.updated_at ?? null,
    ...(Number.isInteger(reversalCents) ? { reversalCents } : {}),
  };
}

/**
 * Route one webhook body. Returns one of:
 *   { route: "payin", event }                       ready for planPayinEffect
 *   { route: "fetch_payin", payinId, kind, reversalCents }  refund/chargeback/
 *        return events: the handler GETs the payin (authoritative amount +
 *        metadata) and calls payinToEvent(kind, payin, { reversalCents })
 *   { route: "merchant", merchantId, merchantStatus?, applicationStatus? }
 *   { route: "deposit", depositId, status }
 *   { route: "ignore", reason }
 */
export function routeWebhook(body) {
  const { resource, status } = classifyEvent(body?.event_type);
  const d = body?.data ?? {};

  if (resource === "payin") {
    const kind = PAYIN_STATUS[status];
    return kind ? { route: "payin", event: payinToEvent(kind, d) } : { route: "ignore", reason: `payin.${status}` };
  }
  if (resource === "refund") {
    // Only a refund that actually went through moves money.
    if (status !== "succeeded") return { route: "ignore", reason: `refund.${status}` };
    const amt = Number(d.amount);
    return { route: "fetch_payin", payinId: d.payin_id ?? null, kind: "refund", reversalCents: Number.isInteger(amt) ? amt : undefined };
  }
  if (resource === "ach_return") {
    const amt = Number(d.amount);
    return { route: "fetch_payin", payinId: d.payin_id ?? null, kind: PAYIN_EVENT.RETURNED, reversalCents: Number.isInteger(amt) ? amt : undefined };
  }
  if (resource === "chargeback") {
    const amt = Number(d.amount);
    const rev = Number.isInteger(amt) ? amt : undefined;
    if (status === "dispute_action_required" || status === "inquiry_action_required") {
      return { route: "fetch_payin", payinId: d.payin_id ?? null, kind: PAYIN_EVENT.DISPUTED, reversalCents: rev };
    }
    if (status === "lost") return { route: "fetch_payin", payinId: d.payin_id ?? null, kind: PAYIN_EVENT.CHARGED_BACK, reversalCents: rev };
    return { route: "ignore", reason: `chargeback.${status}` };
  }
  if (resource === "merchant") {
    return { route: "merchant", merchantId: d.merchant_id ?? null, merchantStatus: d.status ? lc(d.status) : (["pending", "onboarding", "active", "suspended", "deactivated", "canceled"].includes(status) ? status : undefined) };
  }
  if (resource === "merchant_application") {
    return { route: "merchant", merchantId: d.merchant_id ?? null, applicationStatus: d.status ? lc(d.status) : status };
  }
  if (resource === "deposit") {
    return { route: "deposit", depositId: d.deposit_id ?? null, status };
  }
  return { route: "ignore", reason: String(body?.event_type ?? "unknown") };
}

/** A refund is "full" once nothing refundable is left on the payin. */
export function refundKind(payin) {
  return Number(payin?.refundable_amount) === 0 ? PAYIN_EVENT.REFUNDED : PAYIN_EVENT.PARTIALLY_REFUNDED;
}
