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

import { calcQuoteTotals, calcSetupFees, getShopPricingConfig, withShopPricingConfig } from "../../components/shared/pricing";
import { sumAdditionalCharges } from "../pricing/additionalCharges";
import { roundedQuoteTotals } from "../pricing/quoteRounding";

/**
 * The discounted line-item subtotal ("after discount, before setup/fees/tax"),
 * derived PURELY from a quote's SAVED fields — no live recompute. This is the
 * single source of truth for the displayed discount amount: every viewer shows
 * discount = subtotal − afterDiscount, and the column foots because
 * subtotal − discount + setup + additional fees + tax === total.
 *
 *   afterDiscount = total − tax − setup_total − additional_charges
 *
 * Using saved total/tax (rather than re-deriving discount from the % and
 * re-rounding) is what keeps the PDF, customer page, and detail view identical
 * and penny-consistent. See project_quote_immutability.
 */
export function savedAfterDiscount(quote) {
  const total = Number(quote?.total) || 0;
  const tax = Number(quote?.tax) || 0;
  const setup = Number(quote?.setup_total) || 0;
  const additional = sumAdditionalCharges(quote?.additional_charges).total;
  return total - tax - setup - additional;
}

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
export function effectiveQuoteTotals(quote, markup = undefined, pc = undefined) {
  // CACHE-01 Phase 2b: when a multi-shop surface passes an explicit pricing
  // config, run the WHOLE resolution under it (borrow/restore). This covers
  // both the live calcQuoteTotals call AND the getShopPricingConfig() setup-fee
  // read in the live branch below, so the quote is priced for ITS owner without
  // mutating the session global. Default (pc === undefined) keeps reading the
  // loaded global — byte-identical to before. Saved quotes ignore config
  // entirely (they read snapshot fields), so the borrow is a harmless no-op
  // there. Recurse with pc omitted so the body runs against the borrowed global.
  if (pc !== undefined) {
    return withShopPricingConfig(pc, quote?.shop_owner ?? null, () =>
      effectiveQuoteTotals(quote, markup),
    );
  }
  const live = calcQuoteTotals(quote || {}, markup);

  if (quote && Number.isFinite(quote.total) && quote.total > 0) {
    // Override `subtotal` (without rush) too — not just `sub` (with rush).
    // The PDF reads `totals.subtotal ?? totals.sub` for its "Subtotal:"
    // line, and if we leave `subtotal` from the live calc, broker quotes
    // viewed by a shop with a different pricing config will render the
    // shop's live-computed broker price (e.g. $14.02) instead of what
    // the broker actually quoted (e.g. $12.62). Saved totals are the
    // contract — read them straight through.
    //
    // Note: editors today save `quote.subtotal` as sub-WITH-rush (sum of
    // line totals plus rushTotal). Locking `subtotal` and `sub` to the
    // same saved value here is fine for the no-rush case (subtotal === sub)
    // and matches the legacy display path for rush>0 (Subtotal line
    // includes rush, separate Rush Fee line shown alongside).
    const savedSubtotal = Number.isFinite(quote.subtotal) ? quote.subtotal : null;
    const effTax = quote.tax != null ? quote.tax : live.tax;
    const setup = Number(quote.setup_total) || 0;
    const additional = sumAdditionalCharges(quote.additional_charges).total;
    return {
      ...live,
      subtotal: savedSubtotal != null ? savedSubtotal : live.subtotal,
      sub:   savedSubtotal != null ? savedSubtotal : live.sub,
      tax:   effTax,
      total: quote.total,
      // Derive afterDisc from SAVED total/tax/setup/fees — NOT the live calc —
      // so the discount the PDF prints matches the saved snapshot and the
      // column foots. (Previously left as the live `...live` value, which
      // produced a 1-cent discount discrepancy vs. the saved total.)
      afterDisc: quote.total - effTax - setup - additional,
      source: "saved",
    };
  }

  // No saved total (draft / total === 0 / pre-save conversion): recompute live.
  // calcQuoteTotals EXCLUDES setup/screen fees by design (the editor layers and
  // snapshots them separately), so without folding them in here a quote
  // converted before an editor save produces an order whose total drops every
  // setup fee — commonly $20–$200+ (audit PRICE-01). Fold them the exact way
  // the editor's save does (calcSetupFees → roundedQuoteTotals) so the live
  // total and the saved total use ONE formula.
  const setupFees = calcSetupFees({
    lineItems: quote?.line_items || [],
    override: Number.isInteger(quote?.setup_screens_override) ? quote.setup_screens_override : undefined,
    isReorder: !!quote?.is_reorder,
    skippedFeeIds: quote?.setup_skipped_fee_ids || [],
    config: getShopPricingConfig()?.setupFees || {},
  });
  const liveAddl = sumAdditionalCharges(quote?.additional_charges);
  const rt = roundedQuoteTotals({
    sub: live.sub,
    discount: quote?.discount,
    discountType: quote?.discount_type,
    setup: setupFees.total,
    addlTaxable: liveAddl.taxable,
    addlNonTax: liveAddl.nonTaxable,
    taxRate: quote?.tax_rate,
  });
  return {
    ...live,
    sub: rt.sub,
    afterDisc: rt.afterDisc,
    setup_total: setupFees.total,
    tax: rt.tax,
    total: rt.total,
    source: "live",
  };
}
