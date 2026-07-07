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

import { getLineExtras, normalizeExtraBasis } from "./extras";

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
    // Category (per_print / per_garment / per_job). Absent → per_garment, so
    // every existing fee behaves exactly as before.
    basis: normalizeExtraBasis(slice.extraBasis?.[key]),
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
  // Resolve labels across ALL the line's techniques, not just the first — a fee
  // toggled for a non-first location must still label correctly in descriptions.
  const techniques = [...new Set((li?.imprints || []).map((im) => im?.technique).filter(Boolean))];
  const labelByKey = {};
  for (const a of getAddonsForTechniques(byScope, techniques)) {
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

/**
 * Union of add-ons across ALL of a line's imprint techniques, deduped by key.
 *
 * A line's add-ons must not be gated to the FIRST imprint's technique — a line
 * with an Embroidery front and a Screen Print back should still surface the
 * Screen Print "underbase" fee for the back, even though it isn't the first
 * location. (Kato's report, 2026-07: "add underbase to the second print location
 * isn't possible if I don't select it for the first.") With no techniques,
 * falls back to the root (Screen Print) scope — same default as the single-
 * technique resolver. First occurrence wins on a key collision across scopes.
 *
 * @param {{root:any[], embroidery:any[], custom:Record<string, any[]>}|null|undefined} byScope
 * @param {(string|undefined)[]|undefined} techniques
 * @returns {any[]}  sorted alphabetically by label, deduped by key
 */
export function getAddonsForTechniques(byScope, techniques) {
  if (!byScope) return [];
  const techs = Array.isArray(techniques) ? techniques.filter(Boolean) : [];
  const source = techs.length ? [...new Set(techs)] : [undefined];
  const seen = new Set();
  const out = [];
  for (const t of source) {
    for (const a of getAddonsForTechnique(byScope, t)) {
      if (a && a.key && !seen.has(a.key)) {
        seen.add(a.key);
        out.push(a);
      }
    }
  }
  return out.sort((a, b) =>
    (a.label || "").localeCompare(b.label || "", undefined, { sensitivity: "base" })
  );
}

/**
 * Prune extras against the union of ALL the line's techniques. A key survives if
 * ANY current technique's addon list allows it — so changing one location's
 * technique never wipes a fee that a DIFFERENT location still supports (the bug
 * the single-technique prune caused on mixed-technique lines).
 */
/**
 * All per-JOB add-ons across every scope (root + embroidery + custom), deduped
 * by key. Per-job fees apply to the whole quote regardless of technique, so the
 * quote-level "Job fees" section shows them all in one place — unlike per_print/
 * per_garment fees, which are technique-scoped on each line.
 *
 * @param {{root:any[], embroidery:any[], custom:Record<string, any[]>}|null|undefined} byScope
 * @returns {any[]}  per_job add-ons, deduped by key, sorted by label
 */
export function getJobAddons(byScope) {
  if (!byScope) return [];
  const all = [
    ...(byScope.root || []),
    ...(byScope.embroidery || []),
    ...Object.values(byScope.custom || {}).flat(),
  ];
  const seen = new Set();
  const out = [];
  for (const a of all) {
    if (a && a.key && a.basis === "per_job" && !seen.has(a.key)) {
      seen.add(a.key);
      out.push(a);
    }
  }
  return out.sort((x, y) => (x.label || "").localeCompare(y.label || "", undefined, { sensitivity: "base" }));
}

/**
 * Line-level add-ons only — per_print + per_garment (NOT per_job, which is
 * toggled once on the quote). Used by the per-line add-on toggle block.
 */
export function excludeJobAddons(list) {
  return (list || []).filter((a) => a && a.basis !== "per_job");
}

export function pruneExtrasForTechniques(extras, byScope, techniques) {
  if (!extras || typeof extras !== "object") return {};
  const allowed = new Set(
    getAddonsForTechniques(byScope, techniques).map((a) => a && a.key).filter(Boolean)
  );
  const out = {};
  for (const [k, v] of Object.entries(extras)) {
    if (allowed.has(k)) out[k] = v;
  }
  return out;
}
