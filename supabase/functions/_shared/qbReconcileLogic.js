// Pure logic for the nightly QB reconciliation cron (qbReconcile).
//
// Reconciliation problem: webhooks miss. QB occasionally drops events
// under load, or our function timed out, or a payment was recorded
// via a UI path that doesn't fire the webhook (manual receive-payment
// in QBO). When that happens, the InkTracker quote shows "Sent" while
// the QB invoice is paid — and the order pipeline never starts.
//
// Reconciliation runs nightly. For every quote with a linked QB
// invoice + still in "Sent" state, we re-fetch the QB invoice and
// classify the divergence:
//   - OK:                  totals + paid state match
//   - PAID_NOT_RECORDED:   QB invoice is fully paid, quote isn't.
//                          Triggers a silent convert-to-order (same
//                          path as a missed webhook).
//   - TOTALS_DRIFT:        line-amounts differ beyond 1¢ tolerance.
//                          Pushes a drift notification — operator
//                          can decide whether to edit one side.
//   - MISSING_IN_QB:       QB returned no invoice for the saved id.
//                          Pushes a notification — likely deleted
//                          in QB. We don't auto-unlink.
//   - INVALID:             quote row is malformed (no id / shop_owner).
//                          Skip. Defensive guard.
//
// All decisions stay testable here. The edge function does the I/O.

import { isQbInvoicePaid } from "./qbInvoice.js";

export const DRIFT_KINDS = Object.freeze({
  OK:                "ok",
  PAID_NOT_RECORDED: "paid-not-recorded",
  TOTALS_DRIFT:      "totals-drift",
  MISSING_IN_QB:     "missing-in-qb",
  INVALID:           "invalid",
});

// Per-line subtotal drift tolerance. QB's rounding rounds to 2dp; a
// 1¢ delta on any side is noise. Anything beyond is real.
const TOTALS_TOLERANCE_CENTS = 1;

/**
 * Classify the state of one quote against its current QB invoice.
 *
 * @param {object|null} freshInvoice  QB invoice as returned by SELECT * FROM Invoice (or null if not found)
 * @param {object} quote              InkTracker quote row
 * @returns {{kind: string, reason: string, drift?: object}}
 */
export function classifyQuoteDrift(freshInvoice, quote) {
  if (!quote?.id || !quote?.shop_owner) {
    return { kind: DRIFT_KINDS.INVALID, reason: "quote missing id or shop_owner" };
  }

  if (!freshInvoice) {
    return {
      kind: DRIFT_KINDS.MISSING_IN_QB,
      reason: `QB invoice ${quote.qb_invoice_id} not found`,
    };
  }

  const qbPaid = isQbInvoicePaid(freshInvoice);
  const localPaid = Boolean(quote.paid);

  // Paid-state takes precedence — if QB says paid and we don't, we
  // need to converge before anyone checks totals.
  if (qbPaid && !localPaid) {
    return {
      kind: DRIFT_KINDS.PAID_NOT_RECORDED,
      reason: `QB invoice Balance=0, TotalAmt=${freshInvoice.TotalAmt}`,
    };
  }

  // Totals drift. Compare the QB side against what we have stored.
  // Skip if we have no qb_total recorded (pre-PR-A quotes never wrote
  // it, comparing against 0 would always trigger).
  const storedTotal = Number(quote.qb_total);
  const qbTotal     = Number(freshInvoice.TotalAmt ?? 0);
  if (Number.isFinite(storedTotal) && storedTotal > 0) {
    const driftCents = Math.round(Math.abs(qbTotal - storedTotal) * 100);
    if (driftCents > TOTALS_TOLERANCE_CENTS) {
      return {
        kind: DRIFT_KINDS.TOTALS_DRIFT,
        reason: `quote.qb_total=$${storedTotal.toFixed(2)} vs QB.TotalAmt=$${qbTotal.toFixed(2)}`,
        drift: {
          storedTotal,
          qbTotal,
          driftCents,
        },
      };
    }
  }

  return { kind: DRIFT_KINDS.OK, reason: "totals and paid state match" };
}

/**
 * Build a structured shop notification payload for non-OK drift.
 * Returns null for OK / INVALID (nothing to surface).
 *
 * Reusable by recordShopNotification — same field names as
 * buildQbDriftNotification in shopNotifications.js but at a
 * different severity scale (these are nightly findings, not
 * write-time reconciliation drift).
 */
export function buildReconcileNotification({ shopOwner, quote, classification }) {
  if (!classification || classification.kind === DRIFT_KINDS.OK) return null;
  if (classification.kind === DRIFT_KINDS.INVALID) return null;
  if (classification.kind === DRIFT_KINDS.PAID_NOT_RECORDED) {
    // PAID transitions are silently converted; we DO want a notification
    // so the operator sees "we converted a quote to an order while you
    // were asleep". Otherwise it looks like a ghost in the morning.
    return {
      shop_owner: shopOwner,
      event_type: "qb_reconcile_paid_converted",
      severity:   "info",
      title:      `Quote ${quote.quote_id} marked paid via overnight reconcile`,
      body:
        `The QuickBooks invoice for quote ${quote.quote_id} was paid but ` +
        `the webhook didn't fire. The overnight reconcile picked it up and ` +
        `converted the quote to an order. No action required.`,
      related_entity: "quote",
      related_id:     String(quote.id),
      metadata: {
        quote_id_human: quote.quote_id,
        qb_invoice_id:  quote.qb_invoice_id,
      },
    };
  }
  if (classification.kind === DRIFT_KINDS.TOTALS_DRIFT) {
    return {
      shop_owner: shopOwner,
      event_type: "qb_reconcile_totals_drift",
      severity:   "warning",
      title:      `Quote ${quote.quote_id} totals diverge from QuickBooks`,
      body:
        `Overnight reconcile found that quote ${quote.quote_id} has a ` +
        `stored total of $${classification.drift.storedTotal.toFixed(2)} ` +
        `but QuickBooks now shows $${classification.drift.qbTotal.toFixed(2)}. ` +
        `Open the quote → QuickBooks → Refresh to re-anchor to QB's value, ` +
        `or edit the quote and resync if your side is correct.`,
      related_entity: "quote",
      related_id:     String(quote.id),
      metadata: {
        quote_id_human: quote.quote_id,
        qb_invoice_id:  quote.qb_invoice_id,
        stored_total:   classification.drift.storedTotal,
        qb_total:       classification.drift.qbTotal,
        drift_cents:    classification.drift.driftCents,
      },
    };
  }
  if (classification.kind === DRIFT_KINDS.MISSING_IN_QB) {
    return {
      shop_owner: shopOwner,
      event_type: "qb_reconcile_missing_in_qb",
      severity:   "warning",
      title:      `Quote ${quote.quote_id} is linked to a QB invoice that no longer exists`,
      body:
        `The QuickBooks invoice id stored on quote ${quote.quote_id} ` +
        `(${quote.qb_invoice_id}) no longer exists in QuickBooks. ` +
        `It may have been deleted. Open the quote → QuickBooks → Link Existing ` +
        `to point it at a different invoice, or Re-sync to create a new one.`,
      related_entity: "quote",
      related_id:     String(quote.id),
      metadata: {
        quote_id_human: quote.quote_id,
        qb_invoice_id:  quote.qb_invoice_id,
      },
    };
  }
  return null;
}

/**
 * Aggregate per-quote classifications into a summary the cron returns
 * to its caller and writes to the audit log.
 *
 * @param {Array<{kind: string}>} classifications
 * @returns {{total: number, ok: number, paid_not_recorded: number, totals_drift: number, missing_in_qb: number, invalid: number, errors: number}}
 */
export function summarizeReconciliation(classifications) {
  const summary = {
    total: 0,
    ok: 0,
    paid_not_recorded: 0,
    totals_drift: 0,
    missing_in_qb: 0,
    invalid: 0,
    errors: 0,
  };
  for (const c of classifications || []) {
    summary.total++;
    if (c?.error) { summary.errors++; continue; }
    switch (c?.kind) {
      case DRIFT_KINDS.OK:                summary.ok++; break;
      case DRIFT_KINDS.PAID_NOT_RECORDED: summary.paid_not_recorded++; break;
      case DRIFT_KINDS.TOTALS_DRIFT:      summary.totals_drift++; break;
      case DRIFT_KINDS.MISSING_IN_QB:     summary.missing_in_qb++; break;
      case DRIFT_KINDS.INVALID:           summary.invalid++; break;
      default:                            break;
    }
  }
  return summary;
}

export { TOTALS_TOLERANCE_CENTS };
