// Canonical pricing-config defaults for a new shop.
//
// Pulled out of Account.jsx so onboarding and "Pricing → Save" write
// the SAME shape. The previous setup had onboarding write a tiny
// `{ embroidery: { enabled: true } }` while Account.jsx Save wrote a
// full config — the minimal onboarding payload left `_pc.embroidery`
// without any pricing tables, so even after a hard reload the quote
// modal couldn't price embroidery, and the dropdown silently dropped
// the option. Two surfaces, two shapes, one regression class.
//
// Edit cautiously: tweaking a default here changes what every new
// shop starts with. Existing shops are unaffected (their saved config
// overlays these). Match Account.jsx's inline DEFAULTS literal — the
// numbers below were copied from there 2026-05-30. If you change
// embroidery rates, embroidery-pricing tests in pricing.test.js may
// need updating.

export const EMBROIDERY_DEFAULTS = Object.freeze({
  enabled: false,
  digitizingFee: 50,
  qtyTiers: [12, 24, 48, 72, 144],
  stitchTiers: ["Under 5K", "5K-10K", "10K-15K", "15K+"],
  pricing: {
    "Under 5K": { 12: 8.50,  24: 7.50,  48: 6.50,  72: 5.75,  144: 5.25 },
    "5K-10K":   { 12: 10.50, 24: 9.00,  48: 8.00,  72: 7.00,  144: 6.50 },
    "10K-15K":  { 12: 12.50, 24: 11.00, 48: 9.75,  72: 8.75,  144: 8.00 },
    "15K+":     { 12: 15.00, 24: 13.50, 48: 12.00, 72: 10.75, 144: 9.75 },
  },
  extras: { puffEmbroidery: 2.0, metallicThread: 1.5, applique: 3.0 },
});

export const SHOP_PRICING_DEFAULTS = Object.freeze({
  tiers: [25, 50, 100, 200],
  brokerMarkupShare: 0.5,
  brokerTiers: [
    { above: 50, markup: 1.05 },
    { above: 25, markup: 1.15 },
    { above: 15, markup: 1.22 },
    { above: 8,  markup: 1.3  },
    { above: 0,  markup: 1.4  },
  ],
  extras: { colorMatch: 1.0, difficultPrint: 0.5, waterbased: 1.0, tags: 1.5 },
  setupFees: {
    enabled: false,
    items: [
      { id: "screens", label: "Screens", rate: 25, reorderRate: 5 },
      { id: "film",    label: "Film",    rate: 10, reorderRate: 0 },
    ],
  },
  rushRate: 0.20,
  // Embroidery defaults live next to the shop defaults so the two are
  // updated together and a future "DTG defaults" can sit beside them
  // in the same place.
  embroidery: EMBROIDERY_DEFAULTS,
});

/**
 * Build a complete `pricing_config` object for a newly-onboarded shop.
 *
 * Two responsibilities:
 *   1. Carry the full defaults forward — every tier, every rate —
 *      so the quote modal has real numbers to work with from minute one.
 *   2. Honor whatever onboarding-level toggles the user flipped.
 *      Right now that's just embroidery; future toggles slot in here.
 *
 * @param {object} opts
 * @param {boolean} [opts.offersEmbroidery] — flip embroidery.enabled
 * @param {boolean} [opts.offersScreenPrint] — default true; false turns screen
 *   printing off for an embroidery-only (or other) shop
 * @returns {object} a deep-cloned, full pricing_config object
 */
export function buildInitialPricingConfig({ offersEmbroidery = false, offersScreenPrint = true } = {}) {
  // Deep clone via JSON so callers can mutate the result without
  // touching the frozen module-level constants above.
  const cloned = JSON.parse(JSON.stringify(SHOP_PRICING_DEFAULTS));
  if (offersEmbroidery) cloned.embroidery.enabled = true;
  // Turn screen printing off ONLY if they said no AND they enabled another
  // method — never seed a zero-method shop (getEnabledTechniques would then
  // fall back to Screen Print anyway, so this keeps the config honest).
  if (!offersScreenPrint && offersEmbroidery) {
    cloned.screenPrint = { ...(cloned.screenPrint || {}), enabled: false };
  }
  return cloned;
}
