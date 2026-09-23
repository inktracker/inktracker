// One rounding helper for money math. Two of the four former copies skipped
// the Number()||0 coercion, so round2(undefined) returned NaN in salePricing
// and partnerHandoffMath while returning 0 everywhere else — a silent NaN
// seed in price paths. Coerce always.
export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
