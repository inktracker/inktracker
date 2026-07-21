// Shop-level default supplier (Joe 2026-07-20): when a garment is
// carried by BOTH S&S and SanMar, the shop's chosen supplier is what
// auto-selects and displays — the dropdown still offers the other, so
// it's a default, never a lock.
//
// Storage: pricing_config.defaultSupplier ("S&S Activewear" | "SanMar").
// pricing_config is deliberate: it already flows to every surface that
// needs the preference — both quote editors read getShopPricingConfig(),
// the broker dashboard loads the host shop's config, and the wizard's
// enrichment reads the same module global. Not a secret (it ships in the
// public wizard's config blob, harmlessly).

const norm = (v) => String(v || "").trim();
const lower = (v) => norm(v).toLowerCase();

/**
 * Valid preference or "" (no preference). "cheapest" is the sale-aware
 * mode (Joe 2026-07-20): auto-select whichever supplier is cheaper at
 * today's BUY price (sale when one is running, else standard). Note the
 * deliberate split: cheapest governs which supplier gets SELECTED; the
 * quote still costs at that supplier's STANDARD price — sales never
 * feed the cost formula.
 */
export function preferredSupplier(pricingConfig) {
  const v = norm(pricingConfig?.defaultSupplier);
  return v === "S&S Activewear" || v === "SanMar" || v === "cheapest" ? v : "";
}

/**
 * What the shop would PAY today for an option/match: the selected
 * color's sale-or-standard price when resolvable, else the cheapest
 * effective price across colors, else the match-level piecePrice.
 * Unpriced options rank last (Infinity).
 */
export function effectiveOptionCost(option, colorName = "") {
  const priceOf = (e) => {
    if (!e) return 0;
    const sale = Number(e.salePrice);
    if (sale > 0) return sale;
    const std = Number(e.piecePrice);
    return std > 0 ? std : 0;
  };
  const pm = option?.priceMap || {};
  if (colorName && pm[colorName]) {
    const c = priceOf(pm[colorName]);
    if (c > 0) return c;
  }
  const vals = Object.values(pm).map(priceOf).filter((v) => v > 0);
  if (vals.length) return Math.min(...vals);
  const std = Number(option?.piecePrice);
  return std > 0 ? std : Infinity;
}

function cheapestOf(candidates, colorName) {
  let best = null;
  let bestCost = Infinity;
  for (const o of candidates) {
    const c = effectiveOptionCost(o, colorName);
    if (c < bestCost) { best = o; bestCost = c; }
  }
  return best; // null when nothing is priced — callers fall back to order
}

/**
 * Decide which brand option to auto-apply after a style lookup.
 * Precedence (each step only among options matching the line's brand,
 * when the line has one):
 *   1. The line's SAVED supplier — a reopened line must reload ITS
 *      supplier's data, never the first name-match in array order
 *      (which was always S&S and silently flipped SanMar lines back).
 *   2. The shop's preferred supplier.
 *   3. The only candidate, when there is exactly one.
 *   4. With no brand on the line: auto-apply ONLY when the options are
 *      one distinct brand across multiple suppliers (the supplier is
 *      the only ambiguity — resolve it with the preference). Multiple
 *      brands stay a manual choice; we never guess the garment itself.
 * Returns null when nothing should be auto-applied.
 */
export function pickDefaultOption(options, { brand = "", supplier = "", preferred = "", color = "" } = {}) {
  const all = Array.isArray(options) ? options : [];
  if (all.length === 0) return null;

  const brandLc = lower(brand);
  const candidates = brandLc
    ? all.filter((o) => lower(o.brandName) === brandLc)
    : all;
  if (candidates.length === 0) return null;

  if (supplier) {
    const exact = candidates.find((o) => norm(o._supplier) === norm(supplier));
    if (exact) return exact;
  }

  if (brandLc) {
    if (preferred === "cheapest") {
      const cheap = cheapestOf(candidates, color);
      if (cheap) return cheap;
    } else if (preferred) {
      const pref = candidates.find((o) => norm(o._supplier) === preferred);
      if (pref) return pref;
    }
    return candidates[0];
  }

  // No brand chosen yet.
  if (candidates.length === 1) return candidates[0];
  const distinctBrands = new Set(candidates.map((o) => lower(o.brandName)));
  if (distinctBrands.size === 1) {
    if (preferred === "cheapest") {
      const cheap = cheapestOf(candidates, color);
      if (cheap) return cheap;
    } else if (preferred) {
      const pref = candidates.find((o) => norm(o._supplier) === preferred);
      if (pref) return pref;
    }
    return candidates[0];
  }
  return null;
}

/**
 * Stable-sort options so the preferred supplier's listings lead the
 * dropdown. No preference → untouched.
 */
export function orderBySupplierPreference(options, preferred) {
  const all = Array.isArray(options) ? options : [];
  if (!preferred) return all;
  if (preferred === "cheapest") {
    // Ascending by effective (sale-aware) price; unpriced sink last.
    // Stable for ties, so the legacy S&S-first order breaks them.
    return [...all].sort((a, b) => effectiveOptionCost(a) - effectiveOptionCost(b));
  }
  const pref = all.filter((o) => norm(o._supplier) === preferred);
  if (pref.length === 0) return all;
  return [...pref, ...all.filter((o) => norm(o._supplier) !== preferred)];
}

/** Preference as an enrichStyle source token ("ss" | "sanmar" | ""). */
export function preferredSourceToken(pricingConfig) {
  const v = preferredSupplier(pricingConfig);
  if (v === "S&S Activewear") return "ss";
  if (v === "SanMar") return "sanmar";
  if (v === "cheapest") return "cheapest";
  return "";
}
