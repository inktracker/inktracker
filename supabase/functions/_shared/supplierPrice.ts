// INT-03: supplier APIs are external and occasionally return bad price data —
// negatives, null/strings that Number() turns to NaN, or absurd magnitudes from
// a units/decimal mix-up. Unsanitized, a bad price flows straight into a saved
// wizard garment cost and then into a customer quote. Sanitize at the supplier
// boundary so that can't happen.
//
// Returns a finite dollar amount in (0, max], rounded to whole cents. Anything
// else (NaN, ≤0, > max) → 0, which every downstream reader already treats as
// "no usable price" (the wizard audit flags it). 0 is a legitimate signal — some
// AS Colour styles expose no price at all.

// Per-PIECE ceiling: no blank/decorated garment costs four figures a unit, so
// >$2,000/pc is a data error, not a real price.
export const MAX_SANE_PIECE_PRICE = 2000;
// A full case can be 72-144 units, so its ceiling is far higher; this only
// catches outright garbage (a price field carrying an order total, etc.).
export const MAX_SANE_CASE_PRICE = 50000;

export function sanitizeSupplierPrice(
  raw: unknown,
  max: number = MAX_SANE_PIECE_PRICE,
): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > max) return 0;
  return Math.round(n * 100) / 100;
}
