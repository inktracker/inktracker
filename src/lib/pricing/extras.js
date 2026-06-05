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

/**
 * Normalize a shop's extras + extraModes config for a single key.
 * Always returns { mode, rate } with mode in {"flat","percent"}.
 *
 * @param {object|undefined} extras       pricing_config.extras
 * @param {object|undefined} extraModes   pricing_config.extraModes
 * @param {string} key
 * @returns {{ mode: "flat"|"percent", rate: number }}
 */
export function normalizeExtraConfigEntry(extras, extraModes, key) {
  const raw = extras?.[key];
  const rate = Number.isFinite(Number(raw)) ? Number(raw) : 0;
  const mode = extraModes?.[key] === "percent" ? "percent" : "flat";
  return { mode, rate };
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
 * @param {{ mode, rate }} entry  (the output of normalizeExtraConfigEntry)
 * @returns {number|{mode:"percent", rate:number}}
 */
export function snapshotExtraForQuote(entry) {
  if (!entry) return 0;
  if (entry.mode === "percent") {
    return { mode: "percent", rate: Number(entry.rate) || 0 };
  }
  return Number(entry.rate) || 0;
}
