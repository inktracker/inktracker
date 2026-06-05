// Per-technique extras resolution for the quote editor.
//
// Shop owners configure extra fees in three places on Account →
// Pricing & Fees:
//
//   cfg.extras                              → Screen Print (root)
//   cfg.embroidery.extras                   → Embroidery
//   cfg.custom_techniques[name].extras      → DTG / DTF / any custom method
//
// Each slice also carries its own `extraLabels` and `extraModes`.
// At quote time we surface only the fees that match the imprint
// technique selected on a line — `+10% specialty ink` configured
// on the DTG tab should appear when the line's technique is DTG,
// not when it's Screen Print.
//
// All functions in this module are pure. The Account UI writes to
// the right slice via the scope-aware setSlice helper, and the
// quote modal reads through here. Engine math (resolveExtraRatePerPiece)
// is unchanged — once a fee is snapshotted onto li.extras it
// computes identically regardless of which scope it came from.

const TECHNIQUE_EMBROIDERY = "Embroidery";

/**
 * Friendly auto-label derived from a camelCase key.
 *   "puffEmbroidery" → "Puff Embroidery"
 * Falls back to the key itself when transformation can't help.
 */
function autoLabel(key) {
  return String(key || "")
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

/**
 * Convert a single slice ({extras, extraLabels, extraModes}) into a
 * sorted addons list of the shape the quote UI consumes:
 *   [{ key, label, rate, mode }]
 *
 * Numeric strings on `rate` are coerced via parseFloat — some legacy
 * shops have rates stored as strings ("1.5"). Unknown modes default
 * to "flat". Sort is alphabetical by label for stable rendering.
 *
 * @param {object|undefined} slice  Any of cfg, cfg.embroidery, or cfg.custom_techniques[name]
 * @param {object} [defaultLabels]  Optional label fallbacks (used for the root scope's seeded keys)
 * @returns {{key:string,label:string,rate:number,mode:"flat"|"percent"}[]}
 */
export function sliceToAddons(slice, defaultLabels = {}) {
  if (!slice || !slice.extras) return [];
  const list = Object.keys(slice.extras).map((key) => ({
    key,
    label: slice.extraLabels?.[key] || defaultLabels[key] || autoLabel(key),
    rate: parseFloat(slice.extras[key]) || 0,
    mode: slice.extraModes?.[key] === "percent" ? "percent" : "flat",
  }));
  return list.sort((a, b) =>
    (a.label || "").localeCompare(b.label || "", undefined, { sensitivity: "base" })
  );
}

/**
 * Build the addons-by-scope map from a shop's pricing_config.
 * Returns the stable shape:
 *
 *   { root: [...], embroidery: [...], custom: { [methodName]: [...] } }
 *
 * Called once when the pricing_config loads in the quote editor.
 * Computing it lazily per-render would re-fire effects that depend
 * on the addon list — store in state instead.
 *
 * @param {object|null|undefined} cfg
 * @param {object} [defaultLabels]
 * @returns {{root: any[], embroidery: any[], custom: Record<string, any[]>}}
 */
export function buildAddonsByScope(cfg, defaultLabels = {}) {
  const customMap = {};
  const techniques = cfg?.custom_techniques || {};
  for (const name of Object.keys(techniques)) {
    customMap[name] = sliceToAddons(techniques[name]);
  }
  return {
    root: sliceToAddons(cfg, defaultLabels),
    embroidery: sliceToAddons(cfg?.embroidery),
    custom: customMap,
  };
}

/**
 * Resolve the active addons list for a line's imprint technique.
 *
 *   "Embroidery"       → byScope.embroidery
 *   custom method name → byScope.custom[name]  (when present)
 *   anything else      → byScope.root          (Screen Print + safety net)
 *
 * Falls back to root on unknown technique names — a line whose
 * technique was deleted from the shop config still renders SOMETHING
 * instead of an empty addons row. The existing line.extras snapshot
 * preserves any previously-toggled fees regardless.
 *
 * @param {{root:any[], embroidery:any[], custom:Record<string, any[]>}|null|undefined} byScope
 * @param {string|undefined} technique
 * @returns {any[]}
 */
export function getAddonsForTechnique(byScope, technique) {
  if (!byScope) return [];
  if (technique === TECHNIQUE_EMBROIDERY) return byScope.embroidery || [];
  if (
    technique &&
    byScope.custom &&
    Object.prototype.hasOwnProperty.call(byScope.custom, technique)
  ) {
    return byScope.custom[technique] || [];
  }
  return byScope.root || [];
}
