// What a Stripe payment event DOES (pure, unit-tested). The webhook handler
// maps Stripe's own events into the neutral shape below
// (stripeWebhookAdapter), loads the rows, and executes the plan.
//
// Design:
//   - The processor event is only trusted for WHAT happened to the money. Who
//     it belongs to is re-derived from our own rows: the Stripe account → the
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

import { planReversal } from "./paymentsQbBooks.js";

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

/**
 * Did money come IN for a payin in this status? Card: at capture. Bank: once
 * it cleared. Later reversals (dispute, refund, lost chargeback) don't undo
 * that the customer paid — the payment still belongs in QuickBooks, and the
 * reversal is recorded by the shop against it. Failed/canceled and a bank
 * payment RETURNED before it cleared never brought money in.
 */
export function moneyCameIn(status, method) {
  if (["succeeded", "disputed", "partially_refunded", "refunded", "charged_back"].includes(String(status))) return true;
  return status === "processing" && method === "card";
}

/** Ledger statuses the sweep should try to book (see moneyCameIn). */
export const BOOKABLE_STATUSES = Object.freeze(["processing", "succeeded", "disputed", "partially_refunded", "refunded", "charged_back"]);

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
 * @param {number} a.platformFeeCents InkTracker's fee for this payin (paymentsPricing)
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

  // A payment that failed or was canceled before we ever saw it start moved
  // no money, and on Stripe the customer can retry the SAME payment (a bank
  // login that didn't verify). Recording "failed" would outrank its later
  // success, so there's nothing to write.
  if ((kind === PAYIN_EVENT.FAILED || kind === PAYIN_EVENT.CANCELED) && !ledger) {
    return { ok: true, ledger: null, postQbPayment: false, notify: null, alertOps: null };
  }

  // 1. Whose money is this? Only our own merchant row can say.
  if (!account || account.merchant_id !== event.merchantId) {
    return { ok: false, reject: REJECT.UNKNOWN_MERCHANT, ledger: null, postQbPayment: false, notify: null,
      alertOps: `Payment event ${event.payinId} for merchant ${event.merchantId} that no shop owns` };
  }
  const shop = account.shop_owner;
  const md = event.metadata ?? {};
  // When is the invoice paid? A CARD payment is "succeeded" the moment it's
  // captured — same moment QuickBooks Payments marks a card invoice paid.
  // A BANK payment is "processing" for about 4 business days and isn't
  // money until "succeeded". (A card "processing" is accepted too, in case
  // Stripe ever reports one.)
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
    // payin.created_at never changes, so re-writing it is harmless; only
    // written when known so an event without it can't blank it.
    ...(event.paidAt ? { paid_at: event.paidAt } : {}),
  };

  const label = docNumber(quote) ?? (md.quote_number || null);
  const advances = statusAdvances(ledger?.status, kind);

  // 2. Which document is this for? Once a ledger row is linked (or already
  //    booked in QuickBooks) it is the authority: later events — refunds,
  //    disputes, the card's "succeeded" after "processing" — must not be
  //    re-matched against the document, whose invoice pointers can move
  //    (deposit settlement voids the deposit invoice and clears its id).
  const trusted = Boolean(ledger && (ledger.quote_id || ledger.invoice_id || ledger.qb_payment_id));
  const mismatch = trusted ? null
    : (md.shop_owner && md.shop_owner !== shop) ? REJECT.SHOP_MISMATCH
    : !quote ? REJECT.QUOTE_NOT_FOUND
    : quote.shop_owner !== shop ? REJECT.SHOP_MISMATCH
    : !md.qb_invoice_id || ![quote.qb_invoice_id, quote.qb_deposit_invoice_id].filter(Boolean).map(String).includes(String(md.qb_invoice_id))
      ? REJECT.INVOICE_MISMATCH
      : null;

  // Ledger write. Link columns are written ONCE, on the row's first write,
  // and never overwritten (an existing row keeps its links).
  const isInvoiceDoc = md.inktracker_doc_type === "invoice";
  let ledgerRow = null;
  if (advances) {
    ledgerRow = { ...baseLedger, status: kind };
    if (!ledger) {
      Object.assign(ledgerRow, mismatch
        ? { quote_id: null, invoice_id: null, qb_invoice_id: null, pay_kind: null }
        : {
          quote_id: isInvoiceDoc ? null : quote.id,
          invoice_id: isInvoiceDoc ? quote.id : null,
          qb_invoice_id: String(md.qb_invoice_id),
          pay_kind: ["full", "balance", "deposit"].includes(md.pay_kind) ? md.pay_kind : null,
        });
    }
  }

  // Notifications — bad news always reaches the shop, matched or not.
  let notify = null;
  const isReversal = [PAYIN_EVENT.REFUNDED, PAYIN_EVENT.PARTIALLY_REFUNDED, PAYIN_EVENT.RETURNED, PAYIN_EVENT.CHARGED_BACK].includes(kind);
  const voidedAfterBooked = advances && ledger?.qb_payment_id &&
    (kind === PAYIN_EVENT.CANCELED || kind === PAYIN_EVENT.FAILED);
  if (voidedAfterBooked) {
    // Card captured → booked in QB → then voided/failed before settling.
    // Never delete a QB payment on our own; tell the shop exactly what to do.
    notify = {
      severity: "alert",
      title: `Payment canceled after it was recorded: ${label ?? "a payment"}`,
      body: `A $${(amt / 100).toFixed(2)} payment was canceled before it settled, but it was already recorded in QuickBooks (payment #${ledger.qb_payment_id}). Delete that payment in QuickBooks so the invoice shows as open again.`,
      metadata: { processor: "stripe", payin_id: event.payinId, qb_payment_id: ledger.qb_payment_id },
    };
  } else if (advances && kind === PAYIN_EVENT.FAILED && event.method === "ach") {
    notify = {
      severity: "alert",
      title: `Bank payment didn't go through: ${label ?? "a payment"}`,
      body: `Your customer's bank payment of $${(amt / 100).toFixed(2)} failed. The invoice is still open; nothing was recorded in QuickBooks.`,
      metadata: { processor: "stripe", payin_id: event.payinId },
    };
  } else if (isReversal) {
    // Every reversal event is news (a second partial refund, a chargeback
    // after a refund) even when the ledger status doesn't move. Replays of
    // the SAME event are dropped upstream by the webhook's message dedupe.
    const r = planReversal({
      kind: kind === PAYIN_EVENT.RETURNED ? "ach_return" : kind === PAYIN_EVENT.CHARGED_BACK ? "chargeback_lost" : "refund",
      amountCents: Number.isInteger(Number(event.reversalCents)) && Number(event.reversalCents) > 0 ? Number(event.reversalCents) : amt,
      payinId: event.payinId,
      quoteNumber: label,
      booked: Boolean(ledger?.qb_payment_id),
    });
    notify = r.ok ? r.notify : null;
  } else if (kind === PAYIN_EVENT.DISPUTED) {
    notify = {
      severity: "alert",
      title: `Card payment disputed: ${label ?? "a payment"}`,
      body: `Your customer disputed a $${(amt / 100).toFixed(2)} card payment. Respond with proof of the order (approval, proof, delivery) before the deadline in your Stripe dashboard (Payments → Disputes). InkTracker's art approval record and proof history are good evidence.`,
      metadata: { processor: "stripe", payin_id: event.payinId },
    };
  } else if (!mismatch && advances && kind === PAYIN_EVENT.PROCESSING && event.method === "ach") {
    // A bank payment isn't booked in QuickBooks until it clears (about 4
    // business days). Without this the shop sees an unpaid invoice all week
    // and may chase a customer who already paid, or hold a paid job.
    notify = {
      severity: "info",
      title: `Bank payment started: $${(amt / 100).toFixed(2)}${label ? ` for ${label}` : ""}`,
      body: "Your customer paid by bank transfer. It usually clears in about 4 business days, then InkTracker records it in QuickBooks and marks the invoice paid. If it doesn't clear, you'll get an alert.",
      metadata: { processor: "stripe", payin_id: event.payinId },
    };
  } else if (mismatch && moneyIn && ledgerRow) {
    notify = {
      severity: "alert",
      title: `Payment received that needs matching: $${(amt / 100).toFixed(2)}`,
      body: `A customer paid $${(amt / 100).toFixed(2)} online${md.quote_number ? ` for ${md.quote_number}` : ""}, but it no longer matches an open invoice, so it was NOT recorded in QuickBooks. Record it on the right invoice in QuickBooks, or refund it from your Stripe dashboard.`,
      metadata: { processor: "stripe", payin_id: event.payinId, reason: mismatch },
    };
  }

  if (mismatch) {
    return { ok: false, reject: mismatch, ledger: ledgerRow, postQbPayment: false, notify,
      alertOps: `Unmatched payin ${event.payinId} (${mismatch}) shop=${shop}` };
  }

  // 3. Matched (or trusted). Replays are no-ops except for re-trying a QB
  //    post that hadn't landed yet.
  // Book it once money came in — even if a refund or dispute arrived first
  // (out-of-order events, or QuickBooks was disconnected until after).
  // …but never on the event that says the money DIDN'T arrive (card voided
  // or failed, bank payment returned) — those alert the shop instead.
  const cameIn = ![PAYIN_EVENT.FAILED, PAYIN_EVENT.CANCELED, PAYIN_EVENT.RETURNED].includes(kind) &&
    (moneyCameIn(kind, event.method) || moneyCameIn(ledger?.status, ledger?.method ?? event.method));
  const qbPending = cameIn && !ledger?.qb_payment_id;
  const succeededNow = qbPending;
  // A trusted row without a QB invoice (recorded unmatched) is never posted.
  const postable = trusted ? Boolean(ledger.qb_invoice_id) : true;

  return {
    ok: true,
    ledger: ledgerRow,
    postQbPayment: succeededNow && qbPending && postable,
    notify,
    alertOps: null,
  };
}

/** Statuses a row may be moved FROM to reach `to` (forward-only, for a guarded update). */
export function statusesBelow(to) {
  if (!(to in RANK)) return [];
  return Object.keys(RANK).filter((k) => RANK[k] < RANK[to]);
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
