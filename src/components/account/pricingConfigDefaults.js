// Default pricing configuration for the Account → Pricing & Fees editor.
// Extracted verbatim from PricingConfigEditor as a pure decomposition —
// no value changes. A freshly-connected shop with no saved pricing_config
// starts from DEFAULTS; the "Reset to Defaults" button restores them.
export const DEFAULT_TIERS = [25, 50, 100, 200];
export const DEFAULT_COLORS = 8;

export const DEFAULTS = {
  tiers: DEFAULT_TIERS,
  maxColors: DEFAULT_COLORS,
  firstPrint: {
    1: { 25: 6.3, 50: 5.67, 100: 5.22, 200: 4.9 },
    2: { 25: 6.93, 50: 6.24, 100: 5.77, 200: 5.48 },
    3: { 25: 7.55, 50: 6.8, 100: 6.29, 200: 5.97 },
    4: { 25: 8.16, 50: 7.34, 100: 6.79, 200: 6.45 },
    5: { 25: 8.73, 50: 7.86, 100: 7.27, 200: 6.9 },
    6: { 25: 9.25, 50: 8.33, 100: 7.7, 200: 7.32 },
    7: { 25: 9.75, 50: 8.78, 100: 8.12, 200: 7.72 },
    8: { 25: 10.23, 50: 9.21, 100: 8.52, 200: 8.1 },
  },
  addlPrint: {
    1: { 25: 3.15, 50: 2.68, 100: 2.41, 200: 2.29 },
    2: { 25: 3.45, 50: 2.93, 100: 2.64, 200: 2.51 },
    3: { 25: 3.75, 50: 3.19, 100: 2.87, 200: 2.73 },
    4: { 25: 4.05, 50: 3.44, 100: 3.1, 200: 2.94 },
    5: { 25: 4.25, 50: 3.61, 100: 3.25, 200: 3.09 },
    6: { 25: 4.45, 50: 3.78, 100: 3.4, 200: 3.23 },
    7: { 25: 4.65, 50: 3.95, 100: 3.55, 200: 3.37 },
    8: { 25: 4.85, 50: 4.12, 100: 3.7, 200: 3.51 },
  },
  garmentMarkup: [
    { above: 25, markup: 1.15 },
    { above: 15, markup: 1.22 },
    { above: 8, markup: 1.3 },
    { above: 0, markup: 1.4 },
  ],
  extras: { colorMatch: 1.0, difficultPrint: 0.5, waterbased: 1.0, tags: 1.5 },
  // Per-screen setup fee billing. Off by default. Shops define their
  // own named fees (Screens, Film, Color Match, etc.) each with a
  // per-screen rate plus a cheaper reorder rate (used when "Reorder"
  // is checked on the quote — screens already exist from the first run).
  setupFees: {
    enabled: false,
    items: [
      { id: "screens", label: "Screens", rate: 25, reorderRate: 5 },
      { id: "film",    label: "Film",    rate: 10, reorderRate: 0 },
    ],
  },
  rushRate: 0.20,
  // Embroidery pricing: stitch count tiers × quantity tiers
  embroidery: {
    enabled: false,
    digitizingFee: 50,
    qtyTiers: [12, 24, 48, 72, 144],
    stitchTiers: ["Under 5K", "5K-10K", "10K-15K", "15K+"],
    pricing: {
      "Under 5K": { 12: 8.50, 24: 7.50, 48: 6.50, 72: 5.75, 144: 5.25 },
      "5K-10K":   { 12: 10.50, 24: 9.00, 48: 8.00, 72: 7.00, 144: 6.50 },
      "10K-15K":  { 12: 12.50, 24: 11.00, 48: 9.75, 72: 8.75, 144: 8.00 },
      "15K+":     { 12: 15.00, 24: 13.50, 48: 12.00, 72: 10.75, 144: 9.75 },
    },
    extras: { puffEmbroidery: 2.0, metallicThread: 1.5, applique: 3.0 },
    extraLabels: { puffEmbroidery: "Puff / 3D Embroidery", metallicThread: "Metallic Thread", applique: "Applique" },
    extraModes: { puffEmbroidery: "flat", metallicThread: "flat", applique: "flat" },
  },
};
