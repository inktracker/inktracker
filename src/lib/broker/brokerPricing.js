// Per-broker pricing overrides — the overlay half of the broker_pricing
// table (migration 20260911000000).
//
// A shop can give an individual broker their own wholesale terms: a
// custom markup share, custom garment-markup brackets, and/or a full
// contract print-rate matrix. The overrides row stores ONLY the
// sections the shop overrode; everything else inherits the shop's
// pricing sheet at calc time via mergeBrokerPricing().
//
// Scope contract (do not widen casually):
//   * The merged config feeds the BROKER side of a broker quote only —
//     BrokerQuoteEditor's BROKER_MARKUP live calc + save-time stamping,
//     and BrokerPricePanel's wholesale column. The client-side retail
//     suggestion (STANDARD_MARKUP) keeps pricing off the shop's
//     standard sheet, and the anonymous public wizard never sees any
//     of this (no anon RLS on broker_pricing).
//   * Saved quotes are immutable snapshots — editing a broker's
//     overrides never reprices an already-saved quote.
import { getShopPricingConfig } from "@/components/shared/pricing";

// The only pricing_config sections a broker overlay may carry. tiers /
// maxColors ride along as a snapshot whenever the print matrices are
// overridden: the engine picks the quantity tier from config.tiers and
// then indexes firstPrint/addlPrint by it, so an overridden matrix must
// stay aligned with the tiers it was authored against even if the shop
// later re-tiers their main sheet.
export const BROKER_OVERRIDABLE_KEYS = [
  "brokerMarkupShare",
  "garmentMarkup",
  "firstPrint",
  "addlPrint",
  "tiers",
  "maxColors",
  "embroidery",
  "custom_techniques",
];

// How the shop prices this broker (the editor's toggle, Joe 2026-07-19):
//   "markup" — the original way: the shop sheet with a broker discount
//              share (shop-wide default, or a per-broker share). No
//              other sections may ride along in this mode.
//   "sheet"  — a custom price sheet: garment brackets + print matrices
//              applied AS-IS (the editor stores brokerMarkupShare: 0 so
//              the brackets are exactly what the broker pays — no
//              further share discount on top).
// Rows saved before the mode existed have no `mode`; brokerPricingMode()
// derives it from which sections are present.
export const BROKER_PRICING_MODES = ["markup", "sheet"];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cleanPrintTable(table) {
  if (!table || typeof table !== "object" || Array.isArray(table)) return null;
  const clean = {};
  for (const [colors, row] of Object.entries(table)) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const cleanRow = {};
    for (const [tier, rate] of Object.entries(row)) {
      const r = num(rate);
      if (r != null && r >= 0) cleanRow[tier] = r;
    }
    clean[colors] = cleanRow;
  }
  return Object.keys(clean).length ? clean : null;
}

/**
 * Reduce a raw overrides blob (DB row / editor draft) to the shape the
 * money path will accept: known keys only, finite numbers, valid
 * brackets. Anything malformed is dropped rather than guessed at — a
 * dropped section simply inherits the shop sheet.
 */
export function sanitizeBrokerOverrides(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const mode = BROKER_PRICING_MODES.includes(raw.mode) ? raw.mode : null;
  const out = {};

  if (raw.brokerMarkupShare != null) {
    const n = num(raw.brokerMarkupShare);
    if (n != null) out.brokerMarkupShare = Math.min(1, Math.max(0, n));
  }

  // Sheet sections are only meaningful outside markup mode — a markup
  // row that somehow carries matrices (bad write, older editor) must
  // not price with them.
  if (mode !== "markup") {
    if (Array.isArray(raw.garmentMarkup)) {
      const brackets = raw.garmentMarkup
        .map((t) => ({ above: num(t?.above), markup: num(t?.markup) }))
        .filter((t) => t.above != null && t.markup != null && t.markup >= 1);
      if (brackets.length) out.garmentMarkup = brackets;
    }

    const fp = cleanPrintTable(raw.firstPrint);
    const ap = cleanPrintTable(raw.addlPrint);
    if (fp) out.firstPrint = fp;
    if (ap) out.addlPrint = ap;

    // tiers/maxColors only mean anything alongside a matrix override.
    if (fp || ap) {
      if (Array.isArray(raw.tiers)) {
        const tiers = raw.tiers.map(num).filter((t) => t != null && t > 0);
        if (tiers.length) out.tiers = tiers;
      }
      const mc = num(raw.maxColors);
      if (mc != null && mc >= 1) out.maxColors = Math.round(mc);
    }

    // Embroidery — RATES ONLY (pricing matrix keyed by stitch-tier
    // label, digitizing fee, and the tier snapshots the matrix was
    // authored against). enabled/extras/labels are NOT overridable:
    // mergeBrokerPricing layers this onto the shop's embroidery object,
    // so those keep inheriting live.
    if (raw.embroidery && typeof raw.embroidery === "object" && !Array.isArray(raw.embroidery)) {
      const emb = {};
      const pricing = cleanPrintTable(raw.embroidery.pricing);
      if (pricing) emb.pricing = pricing;
      const fee = num(raw.embroidery.digitizingFee);
      if (fee != null && fee >= 0) emb.digitizingFee = fee;
      if (pricing) {
        if (Array.isArray(raw.embroidery.qtyTiers)) {
          const qt = raw.embroidery.qtyTiers.map(num).filter((t) => t != null && t > 0);
          if (qt.length) emb.qtyTiers = qt;
        }
        if (Array.isArray(raw.embroidery.stitchTiers)) {
          const st = raw.embroidery.stitchTiers.map((s) => String(s)).filter(Boolean);
          if (st.length) emb.stitchTiers = st;
        }
      }
      if (Object.keys(emb).length) out.embroidery = emb;
    }

    // Custom techniques (DTG, DTF, …) — per technique, the rate
    // matrices + tier snapshot. Merged one level deep per technique so
    // anything else on the technique (extras) inherits from the shop.
    if (raw.custom_techniques && typeof raw.custom_techniques === "object" && !Array.isArray(raw.custom_techniques)) {
      const cleanTechs = {};
      for (const [name, tech] of Object.entries(raw.custom_techniques)) {
        if (!name || !tech || typeof tech !== "object") continue;
        const t = {};
        const tfp = cleanPrintTable(tech.firstPrint);
        const tap = cleanPrintTable(tech.addlPrint);
        if (tfp) t.firstPrint = tfp;
        if (tap) t.addlPrint = tap;
        if (tfp || tap) {
          if (Array.isArray(tech.tiers)) {
            const tt = tech.tiers.map(num).filter((x) => x != null && x > 0);
            if (tt.length) t.tiers = tt;
          }
          const tmc = num(tech.maxColors);
          if (tmc != null && tmc >= 1) t.maxColors = Math.round(tmc);
        }
        if (Object.keys(t).length) cleanTechs[name] = t;
      }
      if (Object.keys(cleanTechs).length) out.custom_techniques = cleanTechs;
    }
  }

  // mode is metadata — carried only when there's substance under it.
  if (mode && Object.keys(out).length) out.mode = mode;

  return out;
}

export function hasBrokerOverrides(raw) {
  return Object.keys(sanitizeBrokerOverrides(raw)).some((k) => k !== "mode");
}

/** The editor toggle's position for a saved row (derived for pre-mode rows). */
export function brokerPricingMode(raw) {
  const ov = sanitizeBrokerOverrides(raw);
  if (ov.mode) return ov.mode;
  return ov.firstPrint || ov.addlPrint || ov.garmentMarkup || ov.embroidery || ov.custom_techniques
    ? "sheet"
    : "markup";
}

/**
 * Effective wholesale config for one broker: the shop's pricing sheet
 * with the broker's overridden sections layered on top (section-level
 * replace, never a deep merge — an overridden matrix is authored as a
 * whole against its own tier snapshot).
 *
 * With no meaningful overrides this returns `shopConfig` untouched —
 * including undefined, which callers pass through to the calc functions
 * to mean "use the module-global config" (the existing early-shop
 * fallback in BrokerQuoteEditor).
 */
export function mergeBrokerPricing(shopConfig, overrides) {
  // eslint-disable-next-line no-unused-vars
  const { mode, embroidery, custom_techniques, ...flat } = sanitizeBrokerOverrides(overrides);
  if (Object.keys(flat).length === 0 && !embroidery && !custom_techniques) return shopConfig;
  const base = shopConfig || getShopPricingConfig() || {};
  const merged = { ...base, ...flat };

  // Embroidery + custom techniques merge ONE LEVEL DEEP: the broker
  // override carries only the rate tables + tier snapshots, while
  // enabled flags, add-on fees, and labels keep inheriting live from
  // the shop sheet (a whole-section replace would silently zero the
  // broker's embroidery add-on rates).
  if (embroidery) {
    merged.embroidery = { ...(base.embroidery || {}), ...embroidery };
  }
  if (custom_techniques) {
    merged.custom_techniques = { ...(base.custom_techniques || {}) };
    for (const [name, tech] of Object.entries(custom_techniques)) {
      merged.custom_techniques[name] = { ...(merged.custom_techniques[name] || {}), ...tech };
    }
  }
  return merged;
}
