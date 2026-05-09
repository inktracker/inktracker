/**
 * TaxProvider — pluggable tax computation/sync interface.
 *
 *   calculate(quote, ctx) -> {
 *     lineTax: Array<{ id, taxAmount, taxableAmount }>,
 *     totalTax: number,
 *     rate: number | null,
 *     jurisdiction: string | null,
 *   }
 *
 *   pushInvoice(quote, ctx) -> {
 *     externalId: string | null,
 *     taxFromProvider: number | null,
 *     totalFromProvider: number | null,
 *   }
 *
 * `ctx` carries `{ shop, customer }`. Providers must be pure with respect to
 * their inputs (no module-level state) so they're trivial to test.
 */

export const TAX_MODE = Object.freeze({
  INTERNAL:   "internal",
  QUICKBOOKS: "quickbooks",
});

export const EMPTY_CALC = Object.freeze({
  lineTax: [],
  totalTax: 0,
  rate: null,
  jurisdiction: null,
});

export const EMPTY_PUSH = Object.freeze({
  externalId: null,
  taxFromProvider: null,
  totalFromProvider: null,
});
