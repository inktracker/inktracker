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

/** Valid preference or "" (no preference). */
export function preferredSupplier(pricingConfig) {
  const v = norm(pricingConfig?.defaultSupplier);
  return v === "S&S Activewear" || v === "SanMar" ? v : "";
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
export function pickDefaultOption(options, { brand = "", supplier = "", preferred = "" } = {}) {
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
    if (preferred) {
      const pref = candidates.find((o) => norm(o._supplier) === preferred);
      if (pref) return pref;
    }
    return candidates[0];
  }

  // No brand chosen yet.
  if (candidates.length === 1) return candidates[0];
  const distinctBrands = new Set(candidates.map((o) => lower(o.brandName)));
  if (distinctBrands.size === 1) {
    if (preferred) {
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
  const pref = all.filter((o) => norm(o._supplier) === preferred);
  if (pref.length === 0) return all;
  return [...pref, ...all.filter((o) => norm(o._supplier) !== preferred)];
}

/** Preference as an enrichStyle source token ("ss" | "sanmar" | ""). */
export function preferredSourceToken(pricingConfig) {
  const v = preferredSupplier(pricingConfig);
  if (v === "S&S Activewear") return "ss";
  if (v === "SanMar") return "sanmar";
  return "";
}
