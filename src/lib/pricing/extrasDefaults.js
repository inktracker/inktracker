// THE single source of the default add-on ("extras") rate table.
//
// This table used to be independently re-declared in SIX files (pricing.jsx,
// pricingConfigDefaults, shopPricingDefaults, QuoteEditorModal,
// BrokerQuoteEditor, AddonsSection) and the array copies had already drifted
// structurally (one carried mode:"flat", two didn't) — audit 2026-09-30. A
// rate change needed six edits or the surfaces silently split. Every default
// now derives from here; per-shop saved pricing_config still overrides all of
// it at runtime.
export const DEFAULT_EXTRA_RATES = Object.freeze({
  colorMatch: 1.0,
  difficultPrint: 0.5,
  waterbased: 1.0,
  tags: 1.5,
});

export const DEFAULT_EXTRA_LABELS = Object.freeze({
  tags: "Custom Tags",
  difficultPrint: "Difficult Print",
  colorMatch: "Ink Color Match",
  waterbased: "Water-Based Ink",
});

// Canonical display order for the editor fallbacks (was inconsistent between
// the shop and broker editors; unified on the shop editor's order).
const DISPLAY_ORDER = ["tags", "difficultPrint", "colorMatch", "waterbased"];

/**
 * The array form the quote editors use as their pre-config fallback.
 * @param {object} [opts]
 * @param {string} [opts.mode] include a `mode` on each entry (the shop editor
 *   passes "flat" — the historical UI was flat-only until the shop saves).
 */
export function defaultExtrasList({ mode } = {}) {
  return DISPLAY_ORDER.map((key) => ({
    key,
    label: DEFAULT_EXTRA_LABELS[key],
    rate: DEFAULT_EXTRA_RATES[key],
    ...(mode ? { mode } : {}),
  }));
}
