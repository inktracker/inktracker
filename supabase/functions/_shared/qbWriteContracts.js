// Strict contracts on QB writes.
//
// Two invariants live here:
//
//   1. InkTracker cannot delete anything in QuickBooks.
//      Enforced by codebase scan in the test file — no qbDelete helper,
//      no HTTP DELETE, no `/void` endpoint usage.
//
//   2. Numbers on the QB invoice match what InkTracker sent.
//      Enforced at runtime by reconcileQbInvoice(): when QB responds
//      with a saved Invoice, we compare line amounts and totals
//      against what we sent. Any drift beyond a small rounding
//      tolerance produces a `severity: 'drift'` result that the
//      caller logs (and could later surface to the user).
//
// Pure module — no I/O, no globals. Imported by qbSync and tested
// from __tests__/qbWriteContracts.test.js.

// ── Money math primitives ────────────────────────────────────────────────────

const DEFAULT_TOLERANCE = 0.01; // 1 cent — covers any 4-decimal QB rounding

/**
 * Sum `Amount` over an array of QB line objects, skipping anything that
 * isn't a SalesItemLineDetail (QB sometimes includes SubTotal lines).
 * Returns a number rounded to 2 decimal places — never NaN, never null.
 */
export function sumQbLineAmounts(lines) {
  if (!Array.isArray(lines)) return 0;
  let total = 0;
  for (const line of lines) {
    if (!line) continue;
    if (line.DetailType && line.DetailType !== "SalesItemLineDetail") continue;
    const amt = Number(line.Amount);
    if (Number.isFinite(amt)) total += amt;
  }
  return Number(total.toFixed(2));
}

/**
 * Coerce a value into a 2-decimal money number, or null when it isn't
 * one. Strict: rejects NaN, null, undefined, empty string, and
 * non-finite. The whole point is to NEVER let garbage reach QB.
 */
export function toMoneyOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(2));
}

// ── Reconciliation result shape ──────────────────────────────────────────────

export const RECONCILE_SEVERITY = Object.freeze({
  OK:    "ok",
  DRIFT: "drift",
  FATAL: "fatal",
});

/**
 * Reconcile what InkTracker sent against what QB returned for one
 * Invoice round-trip.
 *
 * @param {object} args
 * @param {Array}  args.sentLines   The QB Line[] we POSTed.
 * @param {number} args.sentTax     The tax amount InkTracker calculated
 *                                  for this invoice (post-discount).
 * @param {object} args.qbResponse  The Invoice object QB returned (or
 *                                  fetched back). Expects { Line[],
 *                                  TotalAmt, TxnTaxDetail }.
 * @param {number} [args.tolerance] Max acceptable drift in dollars
 *                                  (default $0.01 — handles 4-decimal
 *                                  unit-price rounding).
 *
 * @returns {{severity, issues: string[],
 *           sentSubtotal: number, qbSubtotal: number, subtotalDrift: number,
 *           sentTotal:    number, qbTotal:    number, totalDrift: number,
 *           sentTax:      number, qbTax:      number, taxDrift:   number}}
 *
 * severity:
 *   - 'fatal' — qbResponse is missing/garbage. Caller MUST NOT trust
 *               qbTotal as authoritative.
 *   - 'drift' — line-amount or subtotal drift exceeded tolerance. Tax
 *               drift alone is NOT 'drift' because QB applies tax from
 *               the customer's QB tax setup (which can legitimately
 *               differ from our local guess). Caller should log.
 *   - 'ok'    — everything within tolerance.
 */
export function reconcileQbInvoice({ sentLines, sentTax, qbResponse, tolerance = DEFAULT_TOLERANCE }) {
  const tol = Number(tolerance);
  const safeTol = Number.isFinite(tol) && tol >= 0 ? tol : DEFAULT_TOLERANCE;

  const issues = [];

  if (!qbResponse || typeof qbResponse !== "object") {
    return {
      severity:     RECONCILE_SEVERITY.FATAL,
      issues:       ["qbResponse missing or not an object"],
      sentSubtotal: sumQbLineAmounts(sentLines),
      qbSubtotal:   0,
      subtotalDrift: NaN,
      sentTotal:    NaN,
      qbTotal:      0,
      totalDrift:   NaN,
      sentTax:      toMoneyOrNull(sentTax) ?? 0,
      qbTax:        0,
      taxDrift:     NaN,
    };
  }

  const sentSubtotal = sumQbLineAmounts(sentLines);
  const qbSubtotal   = sumQbLineAmounts(qbResponse.Line);

  const qbTotalRaw   = Number(qbResponse.TotalAmt);
  const qbTotal      = Number.isFinite(qbTotalRaw) ? Number(qbTotalRaw.toFixed(2)) : NaN;

  const qbTaxRaw     = Number(qbResponse?.TxnTaxDetail?.TotalTax);
  const qbTax        = Number.isFinite(qbTaxRaw) ? Number(qbTaxRaw.toFixed(2)) : 0;

  const sentTaxNum   = toMoneyOrNull(sentTax) ?? 0;
  const sentTotal    = Number((sentSubtotal + sentTaxNum).toFixed(2));

  const subtotalDrift = Number((qbSubtotal - sentSubtotal).toFixed(2));
  const totalDrift    = Number.isFinite(qbTotal) ? Number((qbTotal - sentTotal).toFixed(2)) : NaN;
  const taxDrift      = Number((qbTax - sentTaxNum).toFixed(2));

  // FATAL: response total is missing/NaN — we cannot trust it.
  if (!Number.isFinite(qbTotal)) {
    issues.push(`qbResponse.TotalAmt is missing or non-finite (got ${qbResponse.TotalAmt})`);
    return {
      severity: RECONCILE_SEVERITY.FATAL,
      issues, sentSubtotal, qbSubtotal, subtotalDrift,
      sentTotal, qbTotal: 0, totalDrift: NaN,
      sentTax: sentTaxNum, qbTax, taxDrift,
    };
  }

  // The hard guarantee the user cares about: amounts we sent equal
  // amounts on the QB invoice. This is the line-item fidelity check.
  if (Math.abs(subtotalDrift) > safeTol) {
    issues.push(
      `Line-amount drift ${subtotalDrift.toFixed(2)} exceeds tolerance ${safeTol.toFixed(2)} ` +
      `(sent subtotal ${sentSubtotal.toFixed(2)}, QB subtotal ${qbSubtotal.toFixed(2)})`,
    );
  }

  // Total drift beyond the subtotal drift means QB applied a different
  // tax than we expected. This is *informational* — QB's tax setup is
  // authoritative — but worth surfacing so the user can investigate.
  if (Math.abs(totalDrift) > safeTol) {
    issues.push(
      `Total drift ${totalDrift.toFixed(2)} exceeds tolerance ${safeTol.toFixed(2)} ` +
      `(sent total ${sentTotal.toFixed(2)}, QB total ${qbTotal.toFixed(2)}; ` +
      `tax drift ${taxDrift.toFixed(2)})`,
    );
  }

  const severity = issues.length === 0
    ? RECONCILE_SEVERITY.OK
    : RECONCILE_SEVERITY.DRIFT;

  return {
    severity, issues,
    sentSubtotal, qbSubtotal, subtotalDrift,
    sentTotal, qbTotal, totalDrift,
    sentTax: sentTaxNum, qbTax, taxDrift,
  };
}
