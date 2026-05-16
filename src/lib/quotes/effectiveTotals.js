// Pure helper that resolves a quote's "effective" totals — the
// customer-facing numbers we promised the customer in the email and
// the ones that need to flow downstream to Order → Invoice → QB.
//
// Contract:
//   1. SAVED totals (quote.subtotal / quote.tax / quote.total) win
//      when present. They're what the editor stamped at last-save
//      time, which is what the customer's email + PDF references.
//   2. If saved totals are missing OR total === 0 (a draft / blank
//      quote), fall back to live recomputation via calcQuoteTotals.
//
// Why saved wins:
//   - Customer's email shows the saved total. They paid via Stripe
//     link tied to that amount. Live recompute can drift if the
//     shop's pricing config changes between send and convert.
//   - The shop made a commitment when they hit Send. Re-pricing the
//     order after the fact violates that commitment AND creates a
//     reconciliation gap (cash collected ≠ AR booked).
//
// Why fall back to live for draft / total=0:
//   - New quotes that haven't been saved yet have no .total to
//     respect, but still have line items to compute from.
//   - total=0 is the blank-quote shape; respecting it would shortcut
//     the live calc and produce $0 orders.
//
// This was inlined as `getQuoteTotalsForSend` inside SendQuoteModal,
// causing buildOrderFromQuote to diverge silently from it. Now
// shared so the contract is enforced everywhere.

import { calcQuoteTotals } from "../../components/shared/pricing";

/**
 * Resolve the effective totals for a quote — saved values win, fall
 * back to live calc when missing or blank.
 *
 * @param {object} quote
 * @param {number} [markup] — passed through to calcQuoteTotals for
 *                            broker quotes (BROKER_MARKUP). Caller
 *                            passes undefined for admin/standard.
 * @returns {{ sub: number, tax: number, total: number,
 *             afterDisc: number, source: 'saved' | 'live' }}
 *   source — observable so callers (and tests) can see which path won
 */
export function effectiveQuoteTotals(quote, markup = undefined) {
  const live = calcQuoteTotals(quote || {}, markup);

  if (quote && Number.isFinite(quote.total) && quote.total > 0) {
    return {
      ...live,
      sub:   Number.isFinite(quote.subtotal) ? quote.subtotal : live.sub,
      tax:   quote.tax != null ? quote.tax : live.tax,
      total: quote.total,
      source: "saved",
    };
  }

  return { ...live, source: "live" };
}
