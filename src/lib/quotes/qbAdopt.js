// "Match to QuickBooks" for quotes — pull QB's authoritative total/tax onto a
// quote's as-sold fields when a QB-side edit has made them disagree.
//
// QB is the billing authority. The nightly reconcile mirrors QB's total onto
// `qb_total`/`qb_tax_amount`, so a quote whose saved `total` no longer matches
// its mirror has drifted (usually because the invoice was edited inside QBO
// after the quote was sent). The shop is told in-app; this powers the fix.
//
// Adoption is ALWAYS explicit — the quote-snapshot invariant means as-sold
// totals are only ever rewritten on the operator's click, never automatically.
// Line items and production detail are never touched; only the money follows QB.
// This is the quote-side parallel of buildAdoptPatches' quote leg for invoices
// (src/lib/invoices/qbModifiedSync.js), so both surfaces adopt identically.

import { qbModifiedState } from "@/lib/invoices/qbModifiedSync";

// Re-exported so the quote UI imports its drift check + patch from one place.
export { qbModifiedState };

/**
 * Build the patch that reconciles a quote toward its QB mirror.
 * Returns null when the quote was never mirrored (qb_total null) — there's
 * nothing authoritative to adopt.
 *
 * @param {object} quote  a quote row with qb_total / qb_tax_amount / qb_subtotal
 * @returns {{ total: number, tax: number, tax_rate: number } | null}
 */
export function buildQuoteAdoptPatch(quote) {
  // Guard null BEFORE Number() — Number(null) is 0 (finite), which would
  // otherwise adopt a bogus $0 total onto a never-mirrored quote.
  if (!quote || quote.qb_total == null) return null;
  const qbTotal = Number(quote.qb_total);
  if (!Number.isFinite(qbTotal)) return null;
  const qbTax = Number(quote?.qb_tax_amount) || 0;
  // Prefer QB's own subtotal; fall back to total − tax when it wasn't mirrored.
  const qbSubtotal = quote?.qb_subtotal != null
    ? Number(quote.qb_subtotal)
    : Number((qbTotal - qbTax).toFixed(2));
  // Effective rate against QB's taxable base — matches how the invoice adopt
  // and the accept-QB-tax path (qbSync adoptQbTaxFields) derive it.
  const taxRate = qbSubtotal > 0 ? Number(((qbTax / qbSubtotal) * 100).toFixed(4)) : 0;
  return { total: qbTotal, tax: qbTax, tax_rate: taxRate };
}
