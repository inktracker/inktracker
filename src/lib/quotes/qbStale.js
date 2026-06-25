// A quote's QuickBooks invoice is "stale" when the quote was edited AFTER the
// QB invoice was created — e.g. an additional fee (shipping) was added, so the
// quote's real total no longer matches the amount the QB invoice will charge.
//
// Why this matters: the customer payment page and the shop detail view both
// prefer qb_total when a QB invoice exists. If qb_total is stale, the customer
// is shown — and would be charged — the OLD, lower amount (underpayment).
//
// Detection compares PRE-TAX amounts (total - tax) on each side. We can't
// compare totals directly: QB computes tax from the ship-to address, which can
// legitimately differ from our estimated tax_rate, so an in-sync invoice may
// have qb_total != total purely from tax. Pre-tax (line items + setup +
// additional fees) is tax-independent, so a mismatch there means the quote's
// charges genuinely changed since the invoice was made.
export function isQbStale(quote) {
  if (!quote || quote.qb_total == null) return false;
  const savedTotal = Number(quote.total);
  const qbTotal = Number(quote.qb_total);
  if (!Number.isFinite(savedTotal) || !Number.isFinite(qbTotal)) return false;
  const savedPreTax = savedTotal - (Number(quote.tax) || 0);
  const qbPreTax = qbTotal - (Number(quote.qb_tax_amount) || 0);
  return Math.abs(savedPreTax - qbPreTax) > 0.01;
}
