// Per-piece "extra fees" helpers.
//
// Shape evolution:
//   v1 — pricing_config.extras: { tags: 1.5, waterbased: 1 }
//        Plain number = dollars per piece. No mode concept.
//   v2 — pricing_config.extras: { tags: 1.5, waterbased: 5 }
//        +  pricing_config.extraModes: { tags: "flat", waterbased: "percent" }
//        The numeric value is the RATE in either dollars (flat) or
//        percent points (percent). Mode lives in a parallel map so
//        existing rows with no extraModes default to "flat" cleanly.
//
// Quote-snapshot shapes (on quote.extras[key] when toggled on):
//   number                          → legacy / flat snapshot ($X per piece)
//   { mode: "flat", rate: N }       → explicit flat (equivalent to N)
//   { mode: "percent", rate: N }    → N% of the line's garment cost per piece
//   false / null / undefined        → off

// ── Add-on categories (basis) ────────────────────────────────────────
//
// Every fee is applied at one of three levels. The category lives in a parallel
// pricing_config map (extraBasis) next to extras/extraModes/extraLabels, and is
// SNAPSHOTTED onto the quote at toggle time so a saved quote is immutable even
// if the shop later re-categorizes a fee.
//
//   per_garment  fee × pieces                     (the historical default)
//   per_print    fee × print locations × pieces   (e.g. underbase, per imprint)
//   per_job      fee once for the whole quote      (e.g. an art / setup fee)
//
// Absent basis → per_garment, so every existing fee + saved quote computes
// exactly as before (no migration).
export const EXTRA_BASES = Object.freeze(["per_print", "per_garment", "per_job"]);
export const DEFAULT_EXTRA_BASIS = "per_garment";

export function normalizeExtraBasis(basis) {
  return EXTRA_BASES.includes(basis) ? basis : DEFAULT_EXTRA_BASIS;
}

/**
 * The category of a toggled fee. Prefers the snapshot's own basis (immutable),
 * falling back to the shop's current config, then per_garment.
 *
 * @param {*} quoteValue           what's stored on li.extras[key]
 * @param {string|undefined} configBasis  extraBasis[key] from the shop config
 * @returns {"per_print"|"per_garment"|"per_job"}
 */
export function resolveExtraBasis(quoteValue, configBasis) {
  if (quoteValue && typeof quoteValue === "object" && quoteValue.basis) {
    return normalizeExtraBasis(quoteValue.basis);
  }
  return normalizeExtraBasis(configBasis);
}

/**
 * Normalize a shop's extras + extraModes + extraBasis config for a single key.
 * Always returns { mode, rate, basis }.
 *
 * @param {object|undefined} extras       pricing_config.extras
 * @param {object|undefined} extraModes   pricing_config.extraModes
 * @param {string} key
 * @param {object|undefined} extraBasis   pricing_config.extraBasis
 * @returns {{ mode: "flat"|"percent", rate: number, basis: string }}
 */
export function normalizeExtraConfigEntry(extras, extraModes, key, extraBasis) {
  const raw = extras?.[key];
  const rate = Number.isFinite(Number(raw)) ? Number(raw) : 0;
  const mode = extraModes?.[key] === "percent" ? "percent" : "flat";
  const basis = normalizeExtraBasis(extraBasis?.[key]);
  return { mode, rate, basis };
}

/**
 * Resolve a quote.extras[key] value into a per-piece dollar amount.
 *
 *   off (false/null/0)           → 0
 *   number                       → that many dollars per piece
 *   { mode: "flat", rate: N }    → N dollars per piece
 *   { mode: "percent", rate: N } → percentBasisPerPiece × N / 100
 *   anything else                → 0 (defensive)
 *
 * Percent mode multiplies against the per-piece DECORATION cost of
 * the line (printing + setup, not the blank). User explicitly chose
 * decoration over garment cost so a "10% specialty ink" fee scales
 * with the cost of decorating each garment, not with the blank
 * cost. Pass `printCost / qty` as the basis from the caller.
 *
 * @param {*} quoteValue              what was stored on quote.extras[key]
 * @param {number} basisPerPiece      per-piece decoration cost ($)
 * @returns {number}
 */
export function resolveExtraRatePerPiece(quoteValue, basisPerPiece) {
  if (!quoteValue) return 0;
  if (typeof quoteValue === "number") return quoteValue;
  if (typeof quoteValue === "object") {
    const rate = Number(quoteValue.rate);
    if (!Number.isFinite(rate)) return 0;
    if (quoteValue.mode === "percent") {
      const b = Number(basisPerPiece);
      if (!Number.isFinite(b) || b <= 0) return 0;
      return b * rate / 100;
    }
    return rate;
  }
  return 0;
}

/**
 * Per-line extras with quote-level fallback.
 *
 * Extras moved from quote.extras (one toggle set per quote) to
 * li.extras (one set per line item) on 2026-06-04. Old quotes still
 * carry quote.extras and no li.extras — those keep computing
 * identically by falling through to the quote-level map.
 *
 *   new quote, line set up explicitly: li.extras = { tags: 1.5 } → use it
 *   new quote, untouched line:         li.extras = {}            → no fees on this line
 *   legacy quote pre-2026-06-04:       no li.extras, quote.extras = {...} → quote-level fallback
 *
 * The hasOwn check is load-bearing — distinguishes "explicitly empty
 * (new line, no fees)" from "field never existed (old quote)".
 *
 * @param {object} li     line item
 * @param {object} quote  the parent quote
 * @returns {object}      extras map ready for resolveExtraRatePerPiece
 */
export function getLineExtras(li, quote) {
  if (li && Object.prototype.hasOwnProperty.call(li, "extras") && li.extras) return li.extras;
  return (quote && quote.extras) || {};
}

/**
 * Snapshot a shop-config entry onto a quote. The toggle UI calls
 * this when the user turns a fee on — the returned value is what
 * goes onto quote.extras[key].
 *
 * For flat fees we return the bare number so old code paths
 * (typeof === "number") keep working unchanged. For percent we
 * return the full object so the pricing engine knows how to apply
 * it against garment cost later.
 *
 * A non-default basis (per_print / per_job) forces the object form so the
 * category travels with the quote. A per_garment FLAT fee stays a bare number —
 * byte-identical to every existing snapshot (backward compat + immutability).
 *
 * @param {{ mode, rate, basis }} entry  (the output of normalizeExtraConfigEntry)
 * @returns {number|{mode:"flat"|"percent", rate:number, basis?:string}}
 */
// Per-job fees compute their once-per-order dollar amount at toggle time. flat →
// rate; percent → subtotalBasis × rate/100. Used by JobFeesSection to write an
// additional_charges line, so per_job rides the shared additional-charges
// pipeline (one place — QB invoice, displays, PDF, payment all handle it).
export function computeJobFeeAmount(entry, subtotalBasis = 0) {
  if (!entry || typeof entry !== "object") return 0;
  const rate = Number(entry.rate) || 0;
  if (entry.mode === "percent") {
    const b = Number(subtotalBasis);
    return Number.isFinite(b) && b > 0 ? Math.round((b * rate) / 100 * 100) / 100 : 0;
  }
  return Math.round(rate * 100) / 100;
}

export function snapshotExtraForQuote(entry) {
  if (!entry) return 0;
  const rate = Number(entry.rate) || 0;
  const basis = normalizeExtraBasis(entry.basis);
  const isPercent = entry.mode === "percent";
  // Bare number only for the historical default (per_garment flat).
  if (!isPercent && basis === DEFAULT_EXTRA_BASIS) return rate;
  const snap = { mode: isPercent ? "percent" : "flat", rate };
  if (basis !== DEFAULT_EXTRA_BASIS) snap.basis = basis;
  return snap;
}
