// Pure logic for the qbSync `refreshInvoice` action.
//
// refreshInvoice's job: pull the current state of a QB invoice and
// reconcile it against the InkTracker quote row. This is the recovery
// primitive — when a webhook is missed, or when state drifts, an
// operator hits "Refresh from QB" and InkTracker re-anchors to what
// QB actually thinks is true.
//
// The pure helpers below decide what to patch and whether to convert.
// The edge function does the I/O (QB fetch, DB update, order create).
//
// Separation lets vitest cover the decision tree without spinning up
// Deno + Supabase + a QB mock.

import { isQbInvoicePaid, extractPaymentLink } from "./qbInvoice.js";

// ── Decision: what patch should we apply to the quotes row? ──────────

/**
 * Compute the partial update to write back to `quotes` based on the
 * fresh QB invoice. Returns null if nothing should change (current
 * row is already in sync).
 *
 * @param {object} freshInvoice  The QB invoice as returned by SELECT * FROM Invoice
 * @param {object} currentQuote  The quotes row (subset; only the qb_* fields matter)
 * @returns {object|null}        partial { qb_subtotal, qb_tax_amount, qb_total, qb_payment_link, paid, paid_date, qb_synced_at }
 */
export function buildQuotePatchFromFreshInvoice(freshInvoice, currentQuote) {
  if (!freshInvoice) return null;

  const qbTotal     = Number(freshInvoice.TotalAmt ?? 0);
  const qbTaxAmount = Number(freshInvoice?.TxnTaxDetail?.TotalTax ?? 0);
  const qbSubtotal  = Number((qbTotal - qbTaxAmount).toFixed(2));
  const paymentLink = extractPaymentLink(freshInvoice) ?? null;
  const isPaid      = isQbInvoicePaid(freshInvoice);

  const patch = {
    qb_subtotal:     qbSubtotal,
    qb_tax_amount:   qbTaxAmount,
    qb_total:        qbTotal,
    qb_synced_at:    new Date().toISOString(),
  };

  // Backfill the human-facing DocNumber if QB now reports one and we
  // don't have it persisted yet (older quotes pre-date the column).
  const docNumber = freshInvoice?.DocNumber ? String(freshInvoice.DocNumber) : null;
  if (docNumber && !currentQuote?.qb_doc_number) {
    patch.qb_doc_number = docNumber;
  }

  // Only overwrite paymentLink when we got a fresh one — QB sometimes
  // returns no link on a refetch even after one was minted (the field
  // is conditional on portal activation). Don't blow away a known-good
  // link with null.
  if (paymentLink) patch.qb_payment_link = paymentLink;

  // Paid transition: flip the quote AND stamp paid_date the moment we
  // see Balance=0 + TotalAmt>0. Once paid, never un-pay (refunds are
  // a separate handler — out of scope here).
  if (isPaid && !currentQuote?.paid) {
    patch.paid      = true;
    patch.paid_date = patch.qb_synced_at;
  }

  return patch;
}

// ── Decision: does this refresh require a quote → order conversion? ──

export const REFRESH_CONVERSION = Object.freeze({
  CONVERT:                "convert",                  // Newly-paid, not yet converted
  SKIP_NOT_PAID:          "skip-not-paid",
  SKIP_ALREADY_CONVERTED: "skip-already-converted",
  SKIP_INVALID_QUOTE:     "skip-invalid-quote",
});

/**
 * Mirror of decidePaidInvoiceAction from qbWebhookLogic — but takes
 * the fresh invoice instead of trusting a webhook. Used by the
 * "Refresh from QB" action to catch missed webhooks (the most common
 * support ticket cause).
 *
 * @param {object} freshInvoice  QB invoice
 * @param {object} quote         InkTracker quote row
 * @returns {{action: string, reason: string}}
 */
export function decideRefreshConversion(freshInvoice, quote) {
  if (!quote?.id || !quote?.shop_owner) {
    return {
      action: REFRESH_CONVERSION.SKIP_INVALID_QUOTE,
      reason: "quote missing id or shop_owner",
    };
  }
  if (!isQbInvoicePaid(freshInvoice)) {
    return {
      action: REFRESH_CONVERSION.SKIP_NOT_PAID,
      reason: "QB invoice Balance > 0 (or TotalAmt = 0)",
    };
  }
  if (quote.status === "Converted to Order" || quote.converted_order_id) {
    return {
      action: REFRESH_CONVERSION.SKIP_ALREADY_CONVERTED,
      reason: `quote ${quote.quote_id ?? quote.id} already has an order`,
    };
  }
  return {
    action: REFRESH_CONVERSION.CONVERT,
    reason: "QB invoice fully paid, no existing order",
  };
}
