// Quote-totals engine — sums the per-line prices into a quote's subtotal, then
// applies discount, additional charges, tax, and deposit. Extracted from
// components/shared/pricing.jsx (B2 of the money-path typing plan). Faithful,
// behavior-identical port of calcQuoteTotalsWithLinking: same client-PPP
// override path, same both-ways discount clamp (flat can't go below $0; percent
// bounded 0..100 so discount:150 can't produce a negative that flows into
// tax/total/QB), same additional-charges split (taxable joins the taxed base,
// non-taxable added after tax), same deposit.
//
// Pure: the shop config is threaded in, and the helpers that still live in
// pricing.jsx / extras.js / additionalCharges.js are injected via `deps` — the
// same wrapper pattern as markup.ts and linePrice.ts, keeping this module in
// the strict money type-gate and circular-import-free.

import type {
  LinePricingConfig,
  Quote,
  QuoteTotals,
  QuoteTotalsDeps,
} from "@/types/pricing";

export function computeQuoteTotals(
  q: Quote | null | undefined,
  markup: number,
  configOverride: LinePricingConfig | null | undefined,
  deps: QuoteTotalsDeps,
): QuoteTotals {
  // Defensive null/undefined — some analytics rollups call this with a missing
  // row; it must not crash (contract pinned by test IT5).
  const quote: Quote = q || {};
  // CACHE-01: only run the bleed telemetry on the legacy global path (no
  // explicit config threaded).
  if (!configOverride) deps.detectPricingConfigBleed(quote.shop_owner);
  const linkedQtyMap = deps.buildLinkedQtyMap(quote.line_items || []);
  let subtotal = 0; // sum of baseSubtotals (before rush)
  let rushTotal = 0; // sum of rushFees

  const respectOverride = markup === deps.STANDARD_MARKUP;

  (quote.line_items || []).forEach((li) => {
    const qty = deps.getQty(li);
    const override = Number(li?.clientPpp);
    if (respectOverride && Number.isFinite(override) && override > 0 && qty > 0) {
      subtotal += override * qty;
      return;
    }
    const r = deps.calcLinkedLinePrice(
      li, quote.rush_rate, deps.getLineExtras(li, quote), markup, linkedQtyMap, undefined, configOverride,
    );
    if (r) {
      // ppp × qty so totals match the displayed average per-piece price.
      subtotal += r.ppp * r.qty;
      rushTotal += r.rushFee;
    }
  });

  const sub = subtotal + rushTotal;
  const discVal = parseFloat(String(quote.discount)) || 0;
  const isFlat = quote.discount_type === "flat" || (discVal > 100 && quote.discount_type !== "percent");
  // Clamp both ways: flat can't push below $0; percent is bounded 0..100 so a
  // discount:150 can't yield a negative subtotal flowing into tax/total/QB.
  const pct = Math.min(Math.max(discVal, 0), 100);
  const afterDisc = isFlat ? Math.max(0, sub - discVal) : sub * (1 - pct / 100);

  // Additional fees: taxable join the taxed base; non-taxable added after tax.
  const addl = deps.sumAdditionalCharges(quote.additional_charges);
  const taxBase = afterDisc + addl.taxable;
  const tax = taxBase * ((parseFloat(String(quote.tax_rate)) || 0) / 100);
  const total = taxBase + tax + addl.nonTaxable;

  return {
    subtotal,
    rushTotal,
    sub,
    subBeforeRush: subtotal, // deprecated alias
    afterDisc,
    additionalTaxable: addl.taxable,
    additionalNonTaxable: addl.nonTaxable,
    additionalTotal: addl.total,
    tax,
    total,
    deposit: total * ((parseFloat(String(quote.deposit_pct)) || 0) / 100),
  };
}
