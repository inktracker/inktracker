// Penny-tax auto-adopt (pure).
//
// Joe, 2026-09-28: "why do people keep getting books drifts? that just
// should not happen." Three weeks of books_drift_alert / qb_tax_mismatch
// rows said most of it was QuickBooks' Automated Sales Tax landing a cent
// or two away from InkTracker's flat-rate estimate (Q-2026-Y009: 261.97 vs
// 262.00; Q-2026-O185: 507.13 vs 507.19). Every one of those HELD the
// invoice, posted a bell notification nobody read (21 unread across two
// shops), and then showed up as "drift" every night until someone clicked
// "Use QuickBooks' tax" — which is the only sensible answer to a 4¢ tax
// difference anyway. QB is the tax authority; when the lines are faithful
// and the only disagreement is sub-dollar tax rounding, adopt QB's number
// silently and move on. Anything a dollar or more is still a real billing
// decision and still holds (docs/qb-tax-sync.md).

/** Tax differences strictly below this auto-adopt; at or above, hold. */
export const PENNY_TAX_MAX = 1.0;

/**
 * True when a reconcileQbInvoice() result is a sub-dollar, tax-only
 * disagreement: lines faithful, QB recorded SOME tax (never the missingTax
 * under-reporting case), and both the tax and total drift are under $1.
 */
export function isPennyTaxMismatch(reconciliation, { max = PENNY_TAX_MAX } = {}) {
  if (!reconciliation || reconciliation.taxMismatch !== true) return false;
  if (reconciliation.lineAmountDrift || reconciliation.missingTax) return false;
  const totalDrift = Number(reconciliation.totalDrift);
  const taxDrift = Number(reconciliation.taxDrift);
  if (!Number.isFinite(totalDrift) || !Number.isFinite(taxDrift)) return false;
  return Math.abs(totalDrift) < max && Math.abs(taxDrift) < max;
}

/**
 * The persisted hold state written to quotes/invoices.qb_tax_hold while a
 * created QB invoice is held for a tax mismatch. The quote/invoice modals
 * render a blocking banner from this (instead of a bell notification), and
 * the reconcile's drift scan skips held rows — the shop is being walked
 * through it in-app, it is not "drift". Cleared (null) by any createInvoice
 * that is not held: a clean re-sync or an explicit / automatic adopt.
 */
export function buildTaxHoldState(reconciliation, { now = new Date() } = {}) {
  const num = (v) => (Number.isFinite(Number(v)) ? Number(Number(v).toFixed(2)) : 0);
  return {
    quoted_tax:   num(reconciliation?.sentTax),
    qb_tax:       num(reconciliation?.qbTax),
    tax_drift:    num(reconciliation?.taxDrift),
    quoted_total: num(reconciliation?.sentTotal),
    qb_total:     num(reconciliation?.qbTotal),
    missing_tax:  reconciliation?.missingTax === true,
    held_at:      now.toISOString(),
  };
}

/**
 * Nightly self-heal for sub-dollar drift the reconcile's live-QB check has
 * CONFIRMED (local total vs live QB total differ by less than $1). That is
 * the same penny-tax class that pre-dates the auto-adopt at create time —
 * rows created before this shipped, or a row whose accept click never
 * happened. Adopt QB's authoritative total/tax onto the local row exactly
 * the way the "Match to QuickBooks" button does (money fields only; line
 * items untouched). Returns null when the drift is a dollar or more —
 * that stays a real conflict for the operator email.
 *
 * @param {object} row          { total, tax, drift } — drift = local − live
 * @param {object} liveInvoice  fresh QB invoice
 */
export function pennyDriftAdoptPatch(row, liveInvoice, { max = PENNY_TAX_MAX } = {}) {
  if (!row || !liveInvoice) return null;
  const drift = Number(row.drift);
  if (!Number.isFinite(drift) || Math.abs(drift) >= max) return null;
  const qbTotal = Number(liveInvoice.TotalAmt);
  if (!Number.isFinite(qbTotal)) return null;
  const qbTax = Number(liveInvoice?.TxnTaxDetail?.TotalTax ?? 0) || 0;
  const qbSubtotal = Number((qbTotal - qbTax).toFixed(2));
  const taxRate = qbSubtotal > 0 ? Number(((qbTax / qbSubtotal) * 100).toFixed(4)) : 0;
  return { total: qbTotal, tax: qbTax, tax_rate: taxRate, qb_tax_hold: null };
}
