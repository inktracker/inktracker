// ONE flat-vs-percent discount test for every surface that INFERS the type
// from a saved quote/invoice (as opposed to a UI control that explicitly sets
// discount_type).
//
// Legacy rows (and some QB-pulled / order-derived invoices) carry a flat
// dollar discount with discount_type null/empty rather than "flat". A value
// over 100 can't be a percentage, so it must be a flat amount — that's the
// heuristic the primary payload builder and every DISPLAY path use. Three QB-
// push FALLBACK sites instead used a strict `discount_type === "flat"`, so a
// legacy `discount=150` / null-type row would be pushed to QuickBooks as a
// 150% discount (invoice → ~$0 / rejected). Routing every inference site
// through this helper removes that divergence (Joe audit, 2026-10-01).
//
// NOT for UI toggles that set the type explicitly (QuoteEditorModal) — those
// own the value, they don't infer it.
export function isFlatDiscount(
  discount: number | string | null | undefined,
  discountType: string | null | undefined,
): boolean {
  const v = parseFloat(String(discount)) || 0;
  return discountType === "flat" || (v > 100 && discountType !== "percent");
}
