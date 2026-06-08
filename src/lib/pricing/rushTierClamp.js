// Clamp a rush-tier maxDays input to the shop's standard turnaround.
//
// Rush is by definition faster than standard. A tier with maxDays
// longer than the shop's standardTurnaroundDays would mean "this
// surcharge applies to orders due in less than X days" where X is
// already past the standard window — i.e., the surcharge would apply
// even to standard-speed orders. Doesn't make sense.
//
// `getRushTiers` filters out higher values at read time, so the rate
// engine never honors them — but until 2026-06-08 the Account UI let
// shops type any value up to 365, leaving them confused about why
// their tier "wasn't applying." This helper is the gate.
//
// Pulled out of Account.jsx specifically so we can pin its behavior
// from tests without a React render. Account.jsx imports and calls
// this in the rush-tier inputs.

/**
 * @param {unknown} candidate                 Whatever the user typed.
 * @param {unknown} standardTurnaroundDays    Shop's standardTurnaroundDays value (may be undefined).
 * @returns {number}                          Integer in [1, std]; falls back to 1 when input is unusable.
 */
export function clampRushTierMaxDays(candidate, standardTurnaroundDays) {
  const std = Math.max(1, Math.round(Number(standardTurnaroundDays || 10)));
  const n = Number(candidate);
  const safe = Number.isFinite(n) && n > 0 ? Math.round(n) : 1;
  return Math.max(1, Math.min(std, safe));
}

/**
 * Pick a sensible default maxDays for a freshly-added rush tier.
 * Used by the "+ Add tier" button in Account.jsx. Caps the suggestion
 * at the standard so a brand-new tier never lands outside the legal
 * range. Walks back from any existing tier so multi-tier shops get a
 * staggered set instead of duplicates.
 *
 * @param {Array<{ maxDays?: number, rate?: number }>} existingTiers
 * @param {unknown} standardTurnaroundDays
 * @returns {number}
 */
export function defaultNewRushTierMaxDays(existingTiers, standardTurnaroundDays) {
  const std = Math.max(1, Math.round(Number(standardTurnaroundDays || 10)));
  const tiers = Array.isArray(existingTiers) ? existingTiers : [];
  const loosest = tiers
    .map((t) => Number(t?.maxDays))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => b - a)[0];
  const seed = loosest ? Math.max(1, loosest - 2) : 3;
  return Math.min(std, seed);
}
