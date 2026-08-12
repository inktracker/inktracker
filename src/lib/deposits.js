// Deposits are LIVE (docs/deposit-path-design.md, 2026-08-12).
//
// Collection path: a real QB "deposit invoice" (DocNumber {quote_id}-DEP,
// one NON-taxed line) minted at send time — the customer pays it through
// the normal Intuit share link. When the final full invoice is created,
// the deposit invoice's payment is moved onto it and the deposit invoice
// is voided: end state is one full invoice with the deposit applied as a
// linked Payment, so every existing scanner and paid-predicate keeps
// working unchanged.
//
// The flag stays as the single kill switch: flipping it back to false
// hides every deposit surface at once (the pre-2026-08-12 state).
export const DEPOSITS_ENABLED = true;

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * The deposit dollar amount for a document. The SNAPSHOT (deposit_amount)
 * always wins — it is the agreement, fixed at request/mark time. Deriving
 * from total × pct is only the fallback for docs that predate the
 * snapshot column or haven't minted yet.
 * @param {object} doc quote/order/invoice row
 * @returns {number} dollars, 2dp, >= 0
 */
export function depositAmountFor(doc) {
  const snap = Number(doc?.deposit_amount);
  if (Number.isFinite(snap) && snap > 0) return r2(snap);
  const pct = Number(doc?.deposit_pct) || 0;
  if (pct <= 0) return 0;
  const total = Number(doc?.total) || 0;
  return r2(total * (Math.min(100, Math.max(0, pct)) / 100));
}

/**
 * Remaining balance after the deposit. Never negative for display — an
 * order edited below the deposit shows $0 remaining (the over-collection
 * is surfaced as an edit warning, not silent negative money).
 */
export function depositRemaining(doc) {
  const total = Number(doc?.total) || 0;
  return r2(Math.max(0, total - depositAmountFor(doc)));
}

/** A deposit is requested when pct > 0 (or a snapshot exists) and unpaid. */
export function depositRequested(doc) {
  return !doc?.deposit_paid && depositAmountFor(doc) > 0;
}
