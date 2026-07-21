// State derivation for SendQuoteModal's QB Create/Send gate.
//
// Three states, mutually exclusive:
//
//   "needs_create"  — no QB invoice yet. Show the Create button. Send blocked.
//   "send_failed"   — invoice exists in QB but no scs- payment link is on the
//                     row. With the /send-based mint path, this means our
//                     POST /invoice/{id}/send call failed (transient API
//                     error, QBO blip, etc.) — NOT that the shop's account
//                     lacks QB Payments. Show a red error + Retry button;
//                     the retry re-invokes the createInvoice action, which
//                     hits the UPDATE path on the existing invoice and re-runs
//                     /send. Send is blocked because routing the customer
//                     without a link would fall back to a different path
//                     than what the shop picked.
//   "ready"         — invoice id + payment link both set. Show the success
//                     bar. Send enabled.
//
// The qb_invoice_id gate (not the payment link) is the lock that prevents
// duplicate QB invoices: the Create button MUST NOT reappear once an invoice
// has been written to QB, even if the payment link came back empty.

/**
 * @param {object} args
 * @param {string|null} args.qbInvoiceId  — present when QB has accepted the invoice
 * @param {string|null} args.qbPaymentLink — present when /send returned a share link
 *
 * @returns {{
 *   status: "needs_create" | "send_failed" | "ready",
 *   sendDisabledByQb: boolean,
 *   warning: string | null,
 * }}
 *   sendDisabledByQb:
 *     true for needs_create AND send_failed — Send only fires once both
 *     the invoice and the customer-facing link are in place.
 *   warning:
 *     human-readable error string for send_failed, otherwise null.
 */
export function deriveQbSendState({ qbInvoiceId, qbPaymentLink } = {}) {
  if (!qbInvoiceId) {
    return { status: "needs_create", sendDisabledByQb: true, warning: null };
  }

  if (!qbPaymentLink) {
    return {
      status: "send_failed",
      sendDisabledByQb: true,
      warning:
        "Couldn't get the payment link from QuickBooks. Try again — if it keeps " +
        "failing, check QuickBooks → Settings → Sales for any pending action " +
        "items on your QB Payments account.",
    };
  }

  return { status: "ready", sendDisabledByQb: false, warning: null };
}

/**
 * Stale-invoice check (Joe 2026-07-21): a quote can be edited AFTER its QB
 * invoice was created — the pay-now link then charges the OLD amount. The
 * quote row mirrors the QB invoice's total (`qb_total`, kept fresh by qbSync
 * and the QB webhook), so "amounts disagree" is the money-correct staleness
 * signal — edits that don't move the total (renames, notes) don't warn.
 *
 * @param {object} args
 * @param {number|string|null|undefined} args.qbTotal — mirrored QB invoice total
 * @param {number|string|null|undefined} args.currentTotal — quote's current customer-facing total
 * @returns {boolean} true when both totals are known and differ by ≥ 1 cent
 */
export function qbInvoiceOutOfSync({ qbTotal, currentTotal } = {}) {
  const qb = Number(qbTotal);
  const cur = Number(currentTotal);
  if (qbTotal == null || qbTotal === "" || !Number.isFinite(qb)) return false;
  if (currentTotal == null || currentTotal === "" || !Number.isFinite(cur)) return false;
  return Math.abs(qb - cur) >= 0.005;
}
