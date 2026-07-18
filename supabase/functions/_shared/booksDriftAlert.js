// Books-drift operator alert — pure logic.
//
// The Dragon Head / Thunder House lesson (2026-07-17): InkTracker rows
// can silently disagree with QuickBooks (a write-path bug, a QB-side
// edit, a missed cascade), and nothing told the operator — the drift
// was only found by hand-querying after a shop complained. The nightly
// reconcile already mirrors QB's authoritative totals onto the qb_*
// columns, which makes drift mechanically detectable:
//
//   - money drift:  row total vs qb_total differ beyond tolerance on a
//     QB-linked quote/invoice
//   - stuck paid:   invoice paid=true whose linked order is paid=false
//     (the pullInvoices-beat-the-webhook gap, healed going forward but
//     watched here in case any path regresses)
//   - tax holds:    context only — holds firing is the system WORKING,
//     so holds alone never trigger an email, but they're listed when a
//     drift email goes out anyway.
//
// The fetch glue lives in qbReconcile/index.ts (scanAndAlertBooksDrift);
// everything here is pure and unit-tested.

export const DRIFT_TOLERANCE = 0.01;

/**
 * Filter QB-linked rows to those whose local total diverges from QB's
 * mirrored total beyond tolerance. Rows missing either number are
 * skipped (a null qb_total means "never mirrored", not "drifted").
 *
 * @param {Array<object>} rows  each: { shop_owner, ref, total, qb_total }
 * @returns {Array<object>} rows + { drift } (signed, local - qb)
 */
export function findDriftRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r && r.qb_total != null && r.total != null)
    .map((r) => ({ ...r, drift: Number((Number(r.total) - Number(r.qb_total)).toFixed(2)) }))
    .filter((r) => Math.abs(r.drift) > DRIFT_TOLERANCE);
}

/**
 * Roll the three signals into one summary the alert helpers consume.
 *
 * @param {object} args
 * @param {Array<object>} args.quoteDrift    from findDriftRows (quotes)
 * @param {Array<object>} args.invoiceDrift  from findDriftRows (invoices)
 * @param {Array<object>} args.stuckOrders   { shop_owner, invoice_id, order_id }
 * @param {number} args.taxHoldCount         holds fired in the last 24h (context)
 */
export function summarizeBooksDrift({ quoteDrift = [], invoiceDrift = [], stuckOrders = [], taxHoldCount = 0 } = {}) {
  const shops = new Set([
    ...quoteDrift.map((r) => r.shop_owner),
    ...invoiceDrift.map((r) => r.shop_owner),
    ...stuckOrders.map((r) => r.shop_owner),
  ]);
  return {
    quoteDrift,
    invoiceDrift,
    stuckOrders,
    taxHoldCount: Number(taxHoldCount) || 0,
    driftCount: quoteDrift.length + invoiceDrift.length,
    stuckCount: stuckOrders.length,
    shopCount: shops.size,
  };
}

/**
 * Alert only on actionable findings. Tax holds alone are the system
 * working as designed (the shop is being walked through it in-app) —
 * they ride along as context, never trigger.
 */
export function shouldSendBooksDriftAlert(summary) {
  return Boolean(summary && (summary.driftCount > 0 || summary.stuckCount > 0));
}

/**
 * Verify a mirror-flagged drift candidate against the LIVE QB invoice.
 *
 * The first prod firing (2026-07-17) taught this the hard way: qb_total
 * mirrors are written at create/refresh time and can go stale — Kato's
 * two "major drifts" were invoices corrected inside QBO before the
 * customer paid, with the quote mirror frozen at the born-wrong values.
 * A mirror-based comparison alone produces false alarms, so every
 * candidate must be re-checked against QB's current TotalAmt before it
 * is allowed into the operator email.
 *
 * @param {object} row          candidate: { shop_owner, ref, total, qb_total }
 * @param {object|null} liveInvoice  fresh QB invoice (null = gone from QB)
 * @returns {{ status: "confirmed"|"stale-mirror"|"missing-in-qb",
 *             row?: object, mirrorPatch?: object }}
 *   - confirmed:    still diverges vs live QB → alert, row.qb_total = live total
 *   - stale-mirror: matches live QB → no alert; mirrorPatch refreshes the row
 *   - missing-in-qb: invoice deleted in QB → not drift (reconcile's
 *     missing_in_qb classification owns that signal)
 */
export function verifyDriftRow(row, liveInvoice) {
  if (!liveInvoice) return { status: "missing-in-qb" };
  const liveTotal = Number(liveInvoice.TotalAmt ?? 0);
  const liveTax = Number(liveInvoice?.TxnTaxDetail?.TotalTax ?? 0);
  const mirrorPatch = {
    qb_total: liveTotal,
    qb_tax_amount: liveTax,
    qb_subtotal: Number((liveTotal - liveTax).toFixed(2)),
    qb_synced_at: new Date().toISOString(),
  };
  const drift = Number((Number(row.total) - liveTotal).toFixed(2));
  if (Math.abs(drift) > DRIFT_TOLERANCE) {
    return { status: "confirmed", row: { ...row, qb_total: liveTotal, drift }, mirrorPatch };
  }
  return { status: "stale-mirror", mirrorPatch };
}

const money = (n) => `$${Number(n).toFixed(2)}`;

/** Plain-text operator email body. */
export function buildBooksDriftAlertText(summary) {
  const s = summary || summarizeBooksDrift({});
  const lines = [
    `InkTracker books-drift scan found ${s.driftCount} row(s) out of sync with QuickBooks` +
      (s.stuckCount ? ` and ${s.stuckCount} paid invoice(s) with an unpaid order` : "") +
      ` across ${s.shopCount} shop(s).`,
    "",
  ];
  if (s.quoteDrift.length) {
    lines.push("QUOTES (local total vs QuickBooks):");
    for (const r of s.quoteDrift) {
      lines.push(`  - ${r.shop_owner}  ${r.ref}: IT ${money(r.total)} vs QB ${money(r.qb_total)} (drift ${money(r.drift)})`);
    }
    lines.push("");
  }
  if (s.invoiceDrift.length) {
    lines.push("INVOICES (local total vs QuickBooks):");
    for (const r of s.invoiceDrift) {
      lines.push(`  - ${r.shop_owner}  ${r.ref}: IT ${money(r.total)} vs QB ${money(r.qb_total)} (drift ${money(r.drift)})`);
    }
    lines.push("");
  }
  if (s.stuckOrders.length) {
    lines.push("PAID INVOICES WITH UNPAID ORDERS:");
    for (const r of s.stuckOrders) {
      lines.push(`  - ${r.shop_owner}  invoice ${r.invoice_id} → order ${r.order_id}`);
    }
    lines.push("");
  }
  if (s.taxHoldCount > 0) {
    lines.push(`Context: ${s.taxHoldCount} tax-mismatch hold(s) fired in the last 24h (system working as designed).`);
    lines.push("");
  }
  lines.push("QB is the authority on collected money — reconcile the listed rows toward the QB numbers.");
  lines.push("Runbook: check qb_event_log for the row's recent create/refresh events before editing anything.");
  return lines.join("\n");
}
