// What a Rainforest payment event DOES (pure, unit-tested). The webhook
// handler maps Rainforest's own event names/fields into the neutral shape
// below (see rainforestWebhook), loads the rows, and executes the plan.
//
// Design:
//   - The processor event is only trusted for WHAT happened to the money. Who
//     it belongs to is re-derived from our own rows: the merchant id → the
//     shop that owns it, and the quote must belong to that same shop and still
//     point at the invoice named in the metadata. Metadata is round-tripped
//     through the processor, so it's a hint, never proof.
//   - Money that arrived is ALWAYS recorded in the ledger, even when it can't
//     be matched to a quote — then the shop is alerted instead of the money
//     going quiet.
//   - The invoice is marked paid the same way QuickBooks Payments does it
//     today: we post a QB Payment against the invoice, QuickBooks sends its
//     own webhook, and the existing paid pipeline (qbWebhook → convert to
//     order, cascade paid, notify) runs unchanged. No second "mark paid" path.
//   - Statuses only move forward, so a late or replayed "processing" can't
//     undo a "succeeded".

import { planReversal } from "./rainforestQbBooks.js";

/** Normalised event kinds the webhook adapter produces. */
export const PAYIN_EVENT = Object.freeze({
  PROCESSING: "processing", // accepted, not settled yet (typical for bank payments)
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  CANCELED: "canceled",
  REFUNDED: "refunded",
  PARTIALLY_REFUNDED: "partially_refunded",
  RETURNED: "returned", // bank payment bounced after it looked good
  DISPUTED: "disputed",
  CHARGED_BACK: "charged_back", // dispute lost
});

// Forward-only ordering. Terminal outcomes of the charge share a rank;
// post-settlement reversals rank above them.
const RANK = {
  pending: 0,
  processing: 1,
  succeeded: 2, failed: 2, canceled: 2,
  disputed: 3, partially_refunded: 3,
  refunded: 4, returned: 4, charged_back: 4,
};

export const REJECT = Object.freeze({
  UNKNOWN_MERCHANT: "unknown_merchant",
  SHOP_MISMATCH: "shop_mismatch",
  QUOTE_NOT_FOUND: "quote_not_found",
  INVOICE_MISMATCH: "invoice_mismatch",
  BAD_EVENT: "bad_event",
});

/** True when moving from `from` to `to` is progress (or a same-rank first write). */
const docNumber = (doc) => doc?.quote_id ?? doc?.invoice_id ?? null;

export function statusAdvances(from, to) {
  if (!(to in RANK)) return false;
  if (!from) return true;
  if (!(from in RANK)) return true;
  return RANK[to] > RANK[from];
}

/**
 * @param {object} a
 * @param {{kind:string, payinId:string, merchantId:string, amountCents:number,
 *          method:"card"|"ach"|null, metadata:object, occurredAt:string,
 *          reversalCents?:number}} a.event   reversalCents: refund/return size when partial
 * @param {object|null} a.account  processor_accounts row for event.merchantId
 * @param {object|null} a.quote    the paid document for metadata.inktracker_quote_id:
 *        a quotes row, or an invoices row when metadata.inktracker_doc_type
 *        is "invoice" (the handler loads from the matching table)
 * @param {object|null} a.ledger   existing processor_payments row for payinId
 * @param {number} a.platformFeeCents fee for this payin (from rainforestPricing)
 * @returns {{
 *   ok: boolean,
 *   reject?: string,
 *   ledger?: object|null,       // upsert on processor_payin_id (null = no write)
 *   postQbPayment?: boolean,    // post (or retry) the QB Payment for this payin
 *   notify?: object|null,       // shop notification
 *   alertOps?: string|null,     // platform-level alert (qb_event_log 'error')
 * }}
 */
export function planPayinEffect({ event, account, quote, ledger, platformFeeCents = 0 }) {
  const kind = event?.kind;
  const amt = Number(event?.amountCents);
  if (!event?.payinId || !event?.merchantId || !(kind in RANK) || !Number.isInteger(amt) || amt <= 0) {
    return { ok: false, reject: REJECT.BAD_EVENT, ledger: null, postQbPayment: false, notify: null, alertOps: `Unusable payment event: ${JSON.stringify({ kind, payinId: event?.payinId ?? null })}` };
  }

  // 1. Whose money is this? Only our own merchant row can say.
  if (!account || account.merchant_id !== event.merchantId) {
    return { ok: false, reject: REJECT.UNKNOWN_MERCHANT, ledger: null, postQbPayment: false, notify: null,
      alertOps: `Payment event ${event.payinId} for merchant ${event.merchantId} that no shop owns` };
  }
  const shop = account.shop_owner;
  const md = event.metadata ?? {};
  // When is the invoice paid? A CARD payin is captured at "processing"
  // (Rainforest then settles T+1) — same moment QuickBooks Payments marks a
  // card invoice paid, so quote→order isn't held a day. A BANK payment isn't
  // money until "succeeded" (T+4 by default).
  const moneyIn = kind === PAYIN_EVENT.SUCCEEDED ||
    (kind === PAYIN_EVENT.PROCESSING && event.method === "card");

  const baseLedger = {
    processor_payin_id: event.payinId,
    merchant_id: event.merchantId,
    shop_owner: shop,
    amount_cents: amt,
    method: event.method === "card" || event.method === "ach" ? event.method : null,
    platform_fee_cents: Number.isInteger(platformFeeCents) && platformFeeCents >= 0 ? platformFeeCents : null,
    last_event_type: kind,
    last_event_at: event.occurredAt ?? null,
  };

  // 2. Does the quote check out against OUR rows?
  const mismatch =
    (md.shop_owner && md.shop_owner !== shop) ? REJECT.SHOP_MISMATCH
    : !quote ? REJECT.QUOTE_NOT_FOUND
    : quote.shop_owner !== shop ? REJECT.SHOP_MISMATCH
    : !md.qb_invoice_id || ![quote.qb_invoice_id, quote.qb_deposit_invoice_id].filter(Boolean).map(String).includes(String(md.qb_invoice_id))
      ? REJECT.INVOICE_MISMATCH
      : null;

  if (mismatch) {
    // Never drop money on the floor: record it against the shop (whose
    // merchant it landed in) with no quote link, and tell them.
    const ledgerRow = statusAdvances(ledger?.status, kind)
      ? { ...baseLedger, status: kind, quote_id: null, invoice_id: null, qb_invoice_id: null, pay_kind: null }
      : null;
    return {
      ok: false,
      reject: mismatch,
      ledger: ledgerRow,
      postQbPayment: false,
      notify: moneyIn && ledgerRow ? {
        severity: "alert",
        title: `Payment received that needs matching: $${(amt / 100).toFixed(2)}`,
        body: `A customer paid $${(amt / 100).toFixed(2)} online${md.quote_number ? ` for ${md.quote_number}` : ""}, but it no longer matches an open invoice, so it was NOT recorded in QuickBooks. Record it on the right invoice in QuickBooks, or refund it.`,
        metadata: { processor: "rainforest", payin_id: event.payinId, reason: mismatch },
      } : null,
      alertOps: `Unmatched payin ${event.payinId} (${mismatch}) shop=${shop}`,
    };
  }

  // 3. Matched. Forward-only status; replays are no-ops except for
  //    re-trying a QB post that hadn't landed yet.
  const advances = statusAdvances(ledger?.status, kind);
  const qbPending = moneyIn && !ledger?.qb_payment_id;
  const moneyInRecorded = ledger?.status === PAYIN_EVENT.SUCCEEDED ||
    (ledger?.status === PAYIN_EVENT.PROCESSING && ledger?.method === "card");
  const succeededNow = moneyIn && (advances || moneyInRecorded);

  const isInvoiceDoc = md.inktracker_doc_type === "invoice";
  const ledgerRow = advances ? {
    ...baseLedger,
    status: kind,
    quote_id: isInvoiceDoc ? null : quote.id,
    invoice_id: isInvoiceDoc ? quote.id : null,
    qb_invoice_id: String(md.qb_invoice_id),
    pay_kind: ["full", "balance", "deposit"].includes(md.pay_kind) ? md.pay_kind : null,
  } : null;

  let notify = null;
  const voidedAfterBooked = advances && ledger?.qb_payment_id &&
    (kind === PAYIN_EVENT.CANCELED || kind === PAYIN_EVENT.FAILED);
  if (voidedAfterBooked) {
    // Card captured → booked in QB → then voided/failed before settling.
    // Never delete a QB payment on our own; tell the shop exactly what to do.
    notify = {
      severity: "alert",
      title: `Payment canceled after it was recorded: ${docNumber(quote) ?? "a payment"}`,
      body: `A $${(amt / 100).toFixed(2)} payment was canceled before it settled, but it was already recorded in QuickBooks (payment #${ledger.qb_payment_id}). Delete that payment in QuickBooks so the invoice shows as open again.`,
      metadata: { processor: "rainforest", payin_id: event.payinId, qb_payment_id: ledger.qb_payment_id },
    };
  } else if (advances && kind === PAYIN_EVENT.FAILED && event.method === "ach") {
    notify = {
      severity: "alert",
      title: `Bank payment didn't go through: ${docNumber(quote) ?? "a payment"}`,
      body: `Your customer's bank payment of $${(amt / 100).toFixed(2)} failed. The invoice is still open; nothing was recorded in QuickBooks.`,
      metadata: { processor: "rainforest", payin_id: event.payinId },
    };
  } else if (advances && [PAYIN_EVENT.REFUNDED, PAYIN_EVENT.PARTIALLY_REFUNDED, PAYIN_EVENT.RETURNED, PAYIN_EVENT.CHARGED_BACK].includes(kind)) {
    const r = planReversal({
      kind: kind === PAYIN_EVENT.RETURNED ? "ach_return" : kind === PAYIN_EVENT.CHARGED_BACK ? "chargeback_lost" : "refund",
      amountCents: Number.isInteger(Number(event.reversalCents)) && Number(event.reversalCents) > 0 ? Number(event.reversalCents) : amt,
      payinId: event.payinId,
      quoteNumber: docNumber(quote),
    });
    notify = r.ok ? r.notify : null;
  } else if (advances && kind === PAYIN_EVENT.DISPUTED) {
    notify = {
      severity: "alert",
      title: `Card payment disputed: ${docNumber(quote) ?? "a payment"}`,
      body: `Your customer disputed a $${(amt / 100).toFixed(2)} card payment. Respond with proof of the order (approval, proof, delivery) before the deadline.`,
      metadata: { processor: "rainforest", payin_id: event.payinId },
    };
  }

  return {
    ok: true,
    ledger: ledgerRow,
    postQbPayment: succeededNow && qbPending,
    notify,
    alertOps: null,
  };
}

/**
 * How much of a payment to APPLY to the QB invoice. The customer normally pays
 * exactly the balance, but two payments can race (two tabs, card then bank).
 * QuickBooks accepts a Payment whose total exceeds the applied amount and keeps
 * the rest as a customer credit, so the books stay true — and the shop is told
 * to refund the extra.
 */
export function planQbApplication({ amountCents, liveBalanceCents }) {
  const amt = Number(amountCents);
  const bal = Number(liveBalanceCents);
  if (!Number.isInteger(amt) || amt <= 0 || !Number.isInteger(bal) || bal < 0) {
    return { ok: false, reason: "invalid_amounts" };
  }
  const applyCents = Math.min(amt, bal);
  const unappliedCents = amt - applyCents;
  return {
    ok: true,
    applyCents,
    unappliedCents,
    overpaid: unappliedCents > 0,
  };
}
