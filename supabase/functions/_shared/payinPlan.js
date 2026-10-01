// Decide WHAT a customer is charged when they pay a quote through Stripe,
// and build the data that rides with the charge (pure, unit-tested).
//
// The rule that makes this safe: the customer pays what the LIVE QuickBooks
// invoice says is still owed — never InkTracker's saved total. QuickBooks is
// the billing authority (its tax, its edits, any deposit already applied to
// it), so charging its Balance means a deposit, a remaining balance, and a
// QB-side discount are all correct without re-deriving them here, and a
// second click after a payment cannot double-charge (the balance is 0).
//
// Routing mirrors the QuickBooks pay-link routing on QuotePayment exactly:
//   - broker quotes are never payable here (the shop's invoice is the broker's
//     wholesale bill, not the end client's price)
//   - an unpaid requested deposit, while only the deposit invoice exists,
//     pays the DEPOSIT invoice
//   - otherwise the FINAL invoice, whose balance is the remainder after any
//     settled deposit
//   - a quote whose charges changed after its QB invoice was made is blocked
//     (the invoice would under-charge) — same rule as isQbStale, but checked
//     against the live invoice rather than the stored mirror.

import { platformFeeCents, shopTotalFeeCents, normalizePayMethod } from "./paymentsPricing.js";

export const NOT_PAYABLE = Object.freeze({
  BROKER: "broker_quote",
  NO_INVOICE: "no_qb_invoice",
  STALE: "invoice_out_of_date",
  PAID: "already_paid",
  DEPOSIT_PAID_AWAITING_FINAL: "deposit_paid_awaiting_final_invoice",
  BAD_AMOUNT: "invalid_amount",
});

const toCents = (dollars) => {
  const n = Number(dollars);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};

const isBrokerQuote = (q) => Boolean(q?.broker_id || q?.broker_email);

/** Unpaid requested deposit, mirroring src/lib/deposits.js depositRequested. */
function depositRequested(q) {
  if (q?.deposit_paid) return false;
  const snap = Number(q?.deposit_amount);
  if (Number.isFinite(snap) && snap > 0) return true;
  return (Number(q?.deposit_pct) || 0) > 0;
}

/**
 * Pre-tax mismatch between the saved quote and the LIVE QB invoice. Same test
 * as src/lib/quotes/qbStale.js (tax is excluded because QuickBooks computes it
 * from the address and may legitimately differ).
 */
export function liveInvoiceIsStale(quote, liveInvoice) {
  if (!quote || !liveInvoice) return false;
  const savedTotal = Number(quote.total);
  const qbTotal = Number(liveInvoice.TotalAmt);
  if (!Number.isFinite(savedTotal) || !Number.isFinite(qbTotal)) return false;
  const savedPreTax = savedTotal - (Number(quote.tax) || 0);
  const qbPreTax = qbTotal - (Number(liveInvoice?.TxnTaxDetail?.TotalTax) || 0);
  return Math.abs(savedPreTax - qbPreTax) > 0.01;
}

/**
 * @param {object} args
 * @param {object} args.quote            saved quote row
 * @param {boolean} args.depositsEnabled the DEPOSITS_ENABLED kill switch
 * @param {object|null} args.liveFinal   live QB Invoice for quote.qb_invoice_id
 * @param {object|null} args.liveDeposit live QB Invoice for quote.qb_deposit_invoice_id
 * @returns {{ ok: true, kind: "deposit"|"balance"|"full", qbInvoiceId: string, amountCents: number }
 *         | { ok: false, reason: string }}
 */
export function choosePayTarget({ quote, depositsEnabled, liveFinal = null, liveDeposit = null }) {
  if (isBrokerQuote(quote)) return { ok: false, reason: NOT_PAYABLE.BROKER };

  const depositDue = Boolean(depositsEnabled) &&
    depositRequested(quote) &&
    Boolean(quote?.qb_deposit_invoice_id) &&
    !quote?.qb_invoice_id;

  if (depositDue) {
    if (!liveDeposit) return { ok: false, reason: NOT_PAYABLE.NO_INVOICE };
    const cents = toCents(liveDeposit.Balance);
    if (!Number.isFinite(cents)) return { ok: false, reason: NOT_PAYABLE.BAD_AMOUNT };
    if (cents <= 0) return { ok: false, reason: NOT_PAYABLE.DEPOSIT_PAID_AWAITING_FINAL };
    return { ok: true, kind: "deposit", qbInvoiceId: String(liveDeposit.Id ?? quote.qb_deposit_invoice_id), amountCents: cents };
  }

  // Deposit already paid and the final invoice not made yet: nothing is due.
  if (quote?.deposit_paid && quote?.qb_deposit_invoice_id && !quote?.qb_invoice_id) {
    return { ok: false, reason: NOT_PAYABLE.DEPOSIT_PAID_AWAITING_FINAL };
  }
  if (!quote?.qb_invoice_id || !liveFinal) return { ok: false, reason: NOT_PAYABLE.NO_INVOICE };
  if (liveInvoiceIsStale(quote, liveFinal)) return { ok: false, reason: NOT_PAYABLE.STALE };

  const balance = toCents(liveFinal.Balance);
  const total = toCents(liveFinal.TotalAmt);
  if (!Number.isFinite(balance) || !Number.isFinite(total)) return { ok: false, reason: NOT_PAYABLE.BAD_AMOUNT };
  if (balance <= 0) return { ok: false, reason: NOT_PAYABLE.PAID };
  return {
    ok: true,
    kind: balance === total ? "full" : "balance",
    qbInvoiceId: String(liveFinal.Id ?? quote.qb_invoice_id),
    amountCents: balance,
  };
}

// Checkout Sessions live CHECKOUT_TTL_MS; requests in the same window with
// the same inputs get the SAME session back (Stripe idempotency), so a
// double-click or refresh never opens two checkouts.
export const CHECKOUT_WINDOW_MS = 30 * 60 * 1000;
export const CHECKOUT_TTL_MS = 90 * 60 * 1000;

/**
 * Idempotency key + expiry for the Checkout Session. Same document + same QB
 * invoice + same amount + same method + same 30-minute window → same key and
 * the SAME expires_at (Stripe rejects a reused key with different params).
 * `attempt` = payments already recorded against this QB invoice, so a
 * balance reopened by a refund or return gets a fresh session.
 */
export function payinIdempotencyKey({ quoteId, qbInvoiceId, amountCents, method, attempt = 0, nowMs = Date.now() }) {
  const windowStart = Math.floor(nowMs / CHECKOUT_WINDOW_MS) * CHECKOUT_WINDOW_MS;
  const base = `it-checkout:${quoteId}:${qbInvoiceId}:${amountCents}:${method}:w${windowStart}`;
  return {
    key: attempt > 0 ? `${base}:a${attempt}` : base,
    // ≥ 60 min from now (Stripe needs ≥ 30) and identical across the window.
    expiresAt: Math.floor((windowStart + CHECKOUT_TTL_MS) / 1000),
  };
}

/**
 * Metadata that rides with the payment and comes back on every webhook.
 * `inktracker_quote_id` is the id of the paid DOCUMENT — a quote, or an
 * invoice row when `inktracker_doc_type` is "invoice" (the order-then-invoice
 * flow). The
 * webhook must NOT trust it on its own (it is round-tripped through the
 * processor) — it re-reads the quote and checks the shop owns the Stripe account
 * that received the money before applying anything.
 */
export function buildPayinMetadata({ quote, target, docType = "quote" }) {
  // Stripe metadata values must be strings ≤ 500 chars; keys ≤ 40.
  const isInvoice = docType === "invoice";
  return {
    inktracker_doc_type: isInvoice ? "invoice" : "quote",
    inktracker_quote_id: String(quote?.id ?? ""),
    quote_number: String((isInvoice ? quote?.invoice_id : quote?.quote_id) ?? ""),
    shop_owner: String(quote?.shop_owner ?? ""),
    qb_invoice_id: String(target?.qbInvoiceId ?? ""),
    pay_kind: String(target?.kind ?? ""),
  };
}

/**
 * The fees this payment will carry, for the shop-facing breakdown:
 * `feeCents` is everything the shop pays (Stripe + InkTracker),
 * `platformFeeCents` InkTracker's part of it.
 */
export function previewFee({ method, amountCents }) {
  const m = normalizePayMethod(method);
  if (!m) return null;
  const feeCents = shopTotalFeeCents(m, amountCents);
  return { method: m, feeCents, platformFeeCents: platformFeeCents(m, amountCents), netCents: amountCents - feeCents };
}
