// Per-shop pricing configuration
// Loaded from shops.pricing_config JSONB column
// Falls back to InkTracker defaults when no custom config is set

import { FIRST_PRINT, ADDL_PRINT, EXTRA_RATES } from "@/components/shared/pricing";

const DEFAULTS = {
  // Garment markup tiers: cost threshold → markup multiplier
  garmentMarkup: [
    { above: 25, markup: 1.15 },
    { above: 15, markup: 1.22 },
    { above: 8, markup: 1.3 },
    { above: 0, markup: 1.4 },
  ],
  // First print location: colors → { qty tier → price per piece }
  firstPrint: FIRST_PRINT,
  // Additional print locations
  addlPrint: ADDL_PRINT,
  // Extra per-piece charges
  extras: {
    colorMatch: 1.0,
    difficultPrint: 0.5,
    waterbased: 1.0,
    tags: 0.75,
  },
  // Rush fee percentage
  rushRate: 0.20,
  // Broker markup share (portion of admin markup given to broker)
  brokerMarkupShare: 0.2,
};

let _shopConfig = {};

export function setShopPricingConfig(config) {
  _shopConfig = config || {};
}

export function getShopPricingConfig() {
  return { ...DEFAULTS, ..._shopConfig };
}

export function getGarmentMarkupConfig() {
  return _shopConfig.garmentMarkup || DEFAULTS.garmentMarkup;
}

export function getRushRate() {
  return _shopConfig.rushRate ?? DEFAULTS.rushRate;
}

export function getExtrasConfig() {
  return { ...DEFAULTS.extras, ...(_shopConfig.extras || {}) };
}

export { DEFAULTS as PRICING_DEFAULTS };
