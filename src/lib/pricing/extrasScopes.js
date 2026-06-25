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

import { getLineExtras } from "./extras";

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

/**
 * Drop fee keys from `extras` that don't exist in the active
 * technique's addon list.
 *
 * Called when the user changes a line's imprint technique. Without
 * this, a "Custom Tags" snapshot toggled on while the line was
 * Screen Print would keep charging $1.50/pc after the user switched
 * to Embroidery — the engine resolves whatever's on li.extras, and
 * Tags isn't an Embroidery fee, so the user can't see it (and can't
 * un-toggle it) but it still applies.
 *
 * Keeps any key present in the new scope's list (rare overlap when
 * two techniques happen to define a fee with the same key). Keeps
 * explicit `false` values too — they preserve the "user turned this
 * off" intent rather than silently leaving it ambiguous.
 *
 * @param {object|null|undefined} extras   per-line extras map
 * @param {{root:any[], embroidery:any[], custom:Record<string, any[]>}|null|undefined} byScope
 * @param {string|undefined} technique     the line's new technique
 * @returns {object}                       pruned extras map
 */
/**
 * Human-readable labels for a line's ACTIVE add-ons, for display in line
 * descriptions (QB invoice, quote/PDF, detail views) when the shop opts in via
 * pricing_config.show_addons_in_description. Resolves each toggled-on key to its
 * configured label (technique-scoped), falling back to an auto-label.
 *
 * @param {object} li     line item
 * @param {object} quote  parent quote (for the legacy quote-level extras fallback)
 * @param {object} cfg    shop pricing_config
 * @returns {string[]}
 */
export function getActiveAddonLabels(li, quote, cfg) {
  const lineExtras = getLineExtras(li, quote || {});
  const activeKeys = Object.keys(lineExtras || {}).filter((k) => !!lineExtras[k]);
  if (!activeKeys.length) return [];
  const byScope = buildAddonsByScope(cfg || {});
  const technique = (li?.imprints || [])[0]?.technique;
  const labelByKey = {};
  for (const a of getAddonsForTechnique(byScope, technique)) {
    if (a && a.key) labelByKey[a.key] = a.label;
  }
  return activeKeys.map((k) => labelByKey[k] || autoLabel(k));
}

export function pruneExtrasForTechnique(extras, byScope, technique) {
  if (!extras || typeof extras !== "object") return {};
  const list = getAddonsForTechnique(byScope, technique);
  const allowed = new Set((list || []).map((a) => a && a.key).filter(Boolean));
  const out = {};
  for (const [k, v] of Object.entries(extras)) {
    if (allowed.has(k)) out[k] = v;
  }
  return out;
}
