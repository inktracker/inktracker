// Customer-side payment math. Decides what amount the customer is
// charged at Stripe Checkout time, and builds the Stripe line items.
//
// This is the bottom-line invariant: **the customer is charged what
// they saw in the email**. Any drift here directly violates trust
// and the QB "numbers match" contract.
//
// Previously inline in QuotePayment.jsx with no tests. The QB
// rush-surcharge bug and the Quote→Order drift bug both lived in
// inline-uncovered code; this is the same risk surface on the
// other side of the customer/shop fence.

import { effectiveQuoteTotals } from "./effectiveTotals.js";

// ── Effective total for the customer-facing payment ─────────────────

/**
 * Decide the dollar total to surface to the customer on the payment
 * page. Priority:
 *
 *   1. quote.qb_total — when QB invoice exists, that's the source of
 *      truth for what gets billed. Charging QB's number means
 *      Stripe cash + QB AR reconcile exactly. (Tax rounding can
 *      cause cents-level drift between our calc and QB's; QB wins
 *      on the customer-facing charge.)
 *
 *   2. quote.total (saved) — if no QB total, the editor's saved
 *      "calculate once" total is the customer-promised amount.
 *
 *   3. live calc fallback — only when neither saved nor QB exists
 *      (drafts that somehow reached the payment page).
 *
 * @returns {{ total: number, source: 'qb' | 'saved' | 'live' }}
 */
export function effectiveCustomerTotal(quote) {
  if (!quote || typeof quote !== "object") {
    return { total: 0, source: "live" };
  }
  const qb = Number(quote.qb_total);
  if (Number.isFinite(qb) && qb > 0) {
    return { total: qb, source: "qb" };
  }
  const t = effectiveQuoteTotals(quote);
  return { total: t.total, source: t.source };
}

// ── Deposit / remaining-balance resolution ─────────────────────────

/**
 * Decide what the customer is charged THIS time (deposit vs.
 * remaining balance vs. full).
 *
 *   - depositPct from customer.default_deposit_pct WINS over the
 *     quote's own deposit_pct. Lets the shop flip "pay in full" on
 *     a client without re-editing old quotes.
 *   - First payment: chargeAmount = effectiveTotal × depositPct / 100
 *     (isDeposit = true). Label = "Deposit (X%)".
 *   - Deposit already paid: chargeAmount = effectiveTotal − depositAmount
 *     (isDeposit = false). Label = "Remaining Balance".
 *   - No deposit configured (depositPct = 0): chargeAmount =
 *     effectiveTotal. Label = "Quote {id}".
 *
 * Returns { chargeAmount, isDeposit, label, depositPct, depositAmount }
 * so the caller can both display and act on the values without
 * re-deriving.
 */
export function decideCustomerCharge(quote, customer) {
  const { total: effectiveTotal } = effectiveCustomerTotal(quote);

  const depositPct = customer?.default_deposit_pct != null
    ? Number(customer.default_deposit_pct) || 0
    : parseFloat(quote?.deposit_pct) || 0;

  const depositAmount = Math.round(effectiveTotal * (depositPct / 100) * 100) / 100;
  const depositPaid = Boolean(quote?.deposit_paid);

  const quoteId = quote?.quote_id || "";

  if (depositPct > 0 && !depositPaid) {
    return {
      chargeAmount: depositAmount,
      isDeposit: true,
      label: `Deposit (${depositPct}%) — Quote ${quoteId}`.trim(),
      depositPct,
      depositAmount,
      effectiveTotal,
    };
  }
  if (depositPct > 0 && depositPaid) {
    const remaining = Math.round((effectiveTotal - depositAmount) * 100) / 100;
    return {
      chargeAmount: remaining,
      isDeposit: false,
      label: `Remaining Balance — Quote ${quoteId}`.trim(),
      depositPct,
      depositAmount,
      effectiveTotal,
    };
  }
  return {
    chargeAmount: effectiveTotal,
    isDeposit: false,
    label: `Quote ${quoteId}`.trim(),
    depositPct: 0,
    depositAmount: 0,
    effectiveTotal,
  };
}

// ── Stripe Checkout line items ─────────────────────────────────────

export class InvalidChargeAmountError extends Error {
  constructor(amount) {
    super(`Charge amount must be > 0 (got ${amount})`);
    this.name = "InvalidChargeAmountError";
    this.amount = amount;
  }
}

/**
 * Build the Stripe Checkout line_items array.
 *
 * Stripe requires unit_amount in cents (positive integer). The OLD
 * inline implementation used `Math.max(1, Math.round(amount × 100))`
 * which silently charged $0.01 if amount was 0 or negative. That
 * hides bugs — if our calc produces $0, charging a penny is the
 * wrong answer; refusing loudly is right.
 *
 * Throws InvalidChargeAmountError when amount <= 0 so callers
 * (QuotePayment.jsx) can surface a clear error to the customer
 * instead of opening a useless 1-cent checkout.
 *
 * @throws {InvalidChargeAmountError} when amount <= 0
 */
export function buildCheckoutLineItems(quote, amount, label) {
  const n = Number(amount || 0);
  if (!Number.isFinite(n) || n <= 0) {
    throw new InvalidChargeAmountError(amount);
  }
  return [{
    name: `Quote ${quote?.quote_id || ""}`.trim(),
    description: label || "Approved quote payment",
    quantity: 1,
    unit_amount: Math.round(n * 100),
  }];
}
