import { todayInShopTz } from "@/lib/shopTimezone";
import {
  adminMarkup as adminMarkupCore,
  brokerMarkupShare as brokerMarkupShareCore,
  brokerMarkup as brokerMarkupCore,
  markup as markupCore,
  DEFAULT_BROKER_MARKUP_SHARE,
} from "@/lib/pricing/markup";

export const FIRST_PRINT = {
  1: { 25: 6.3, 50: 5.67, 100: 5.22, 200: 4.9 },
  2: { 25: 6.93, 50: 6.24, 100: 5.77, 200: 5.48 },
  3: { 25: 7.55, 50: 6.8, 100: 6.29, 200: 5.97 },
  4: { 25: 8.16, 50: 7.34, 100: 6.79, 200: 6.45 },
  5: { 25: 8.73, 50: 7.86, 100: 7.27, 200: 6.9 },
  6: { 25: 9.25, 50: 8.33, 100: 7.7, 200: 7.32 },
  7: { 25: 9.75, 50: 8.78, 100: 8.12, 200: 7.72 },
  8: { 25: 10.23, 50: 9.21, 100: 8.52, 200: 8.1 },
};

export const ADDL_PRINT = {
  1: { 25: 3.15, 50: 2.68, 100: 2.41, 200: 2.29 },
  2: { 25: 3.45, 50: 2.93, 100: 2.64, 200: 2.51 },
  3: { 25: 3.75, 50: 3.19, 100: 2.87, 200: 2.73 },
  4: { 25: 4.05, 50: 3.44, 100: 3.1, 200: 2.94 },
  5: { 25: 4.25, 50: 3.61, 100: 3.25, 200: 3.09 },
  6: { 25: 4.45, 50: 3.78, 100: 3.4, 200: 3.23 },
  7: { 25: 4.65, 50: 3.95, 100: 3.55, 200: 3.37 },
  8: { 25: 4.85, 50: 4.12, 100: 3.7, 200: 3.51 },
};

// Re-exported here so existing callers that import from "@/components/shared/pricing"
// don't have to know about the extracted helpers file.
export {
  normalizeExtraConfigEntry,
  resolveExtraRatePerPiece,
  snapshotExtraForQuote,
  getLineExtras,
  resolveExtraBasis,
} from "@/lib/pricing/extras";
import {
  resolveExtraRatePerPiece as _resolveExtraRatePerPiece,
  getLineExtras as _getLineExtras,
  resolveExtraBasis as _resolveExtraBasis,
} from "@/lib/pricing/extras";
import { sumAdditionalCharges as _sumAdditionalCharges, normalizeAdditionalCharges as _normalizeAdditionalCharges } from "@/lib/pricing/additionalCharges";

export const EXTRA_RATES = {
  colorMatch: 1.0,
  difficultPrint: 0.5,
  waterbased: 1.0,
  tags: 1.5,
};

export const SIZES = ["OS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"];
export const BIG_SIZES = ["2XL", "3XL", "4XL", "5XL"];

export function sortSizeEntries(entries) {
  return [...entries].sort(([a], [b]) => {
    const ia = SIZES.indexOf(a);
    const ib = SIZES.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });
}
export const LOCATIONS = ["Front", "Back", "Left Chest", "Right Chest", "Left Sleeve", "Right Sleeve", "Pocket", "Hood", "Other"];
export const ALL_TECHNIQUES = ["Screen Print", "DTG", "Embroidery", "DTF", "Heat Transfer", "Sublimation"];
// Returns only techniques the shop has set up. Screen Print is always
// available. Embroidery shows if the shop has either explicitly toggled
// the enabled flag OR filled in any pricing tiers — the second check
// rescues two real failure modes:
//   1. User saved pricing tiers but didn't realize the "Enable" toggle
//      was a separate save (config has pricing but enabled=false).
//   2. Legacy configs from before the enabled flag existed.
// If neither flag nor pricing exists, embroidery stays hidden so a
// shop that doesn't do it doesn't accidentally pick it on a quote.
export function getEnabledTechniques(configOverride) {
  // `configOverride` lets a caller (e.g. BrokerDashboard) pass the
  // shop's pricing_config DIRECTLY instead of relying on the
  // module-level `_pc`. React doesn't track changes to `_pc`, so any
  // component that calls getEnabledTechniques() during render and
  // mounted BEFORE _pc was hydrated would be stuck on Screen Print
  // until something else re-rendered it. The broker quote editor hit
  // exactly this bug 2026-06-02 — embroidery never appeared in the
  // technique dropdown because _pc was still null on the first render.
  // Passing the config explicitly makes it React-tracked state.
  const pc = configOverride ?? _pc;
  const enabled = ["Screen Print"];
  const emb = pc?.embroidery;
  const hasPricing = emb?.pricing && Object.keys(emb.pricing).length > 0;
  if (emb?.enabled || hasPricing) enabled.push("Embroidery");
  // Custom techniques (DTG, DTF, Heat Transfer, Sublimation, anything
  // the shop adds on Account → Pricing). Order matches insertion in
  // the JSONB object, which JS object iteration preserves.
  const custom = pc?.custom_techniques;
  if (custom && typeof custom === "object") {
    for (const name of Object.keys(custom)) {
      const t = String(name || "").trim();
      if (t && !enabled.includes(t)) enabled.push(t);
    }
  }
  return enabled;
}

// Technique dropdown options for a line that ALREADY has `currentTechnique`
// selected. Returns the shop's enabled techniques, but ALWAYS includes the
// current one even if the shop's config no longer enables it (stale/absent
// pricing config, or the technique was toggled off after the quote was saved).
// Without this, editing a saved Embroidery quote could drop "Embroidery" from
// the dropdown, making the saved technique impossible to keep or re-select.
export function getTechniqueOptions(currentTechnique, configOverride) {
  const opts = getEnabledTechniques(configOverride);
  const cur = (currentTechnique == null ? "" : String(currentTechnique)).trim();
  if (cur && !opts.includes(cur)) return [...opts, cur];
  return opts;
}

// Resolve the firstPrint/addlPrint/tiers/maxColors table set to use for
// a given imprint's technique.
//   Embroidery       → returns null (caller uses the embroidery path)
//   Custom technique → uses pc.custom_techniques[tech] with screen-print
//                      fallbacks for any missing field
//   Otherwise        → screen-print defaults
//
// Exposed so the Account UI can render the same input grid against
// either the legacy `_pc.firstPrint` or a custom tech's namespace
// without duplicating the field-resolution logic.
export function getTechniqueRates(tech, configOverride) {
  if (tech === "Embroidery") return null;
  const pc = configOverride ?? _pc;
  const baseFp    = pc?.firstPrint || FIRST_PRINT;
  const baseAp    = pc?.addlPrint  || ADDL_PRINT;
  const baseTiers = pc?.tiers      || [25, 50, 100, 200];
  const baseMax   = pc?.maxColors  || 8;
  const custom = pc?.custom_techniques?.[tech];
  if (!custom) {
    return { firstPrint: baseFp, addlPrint: baseAp, tiers: baseTiers, maxColors: baseMax };
  }
  return {
    firstPrint: custom.firstPrint || baseFp,
    addlPrint:  custom.addlPrint  || baseAp,
    tiers:      custom.tiers      || baseTiers,
    maxColors:  Number.isFinite(Number(custom.maxColors)) && Number(custom.maxColors) > 0 ? Number(custom.maxColors) : baseMax,
  };
}
export const TECHNIQUES = ALL_TECHNIQUES; // backward compat for code that imports it directly
export const Q_STATUSES = ["Draft", "Sent", "Pending", "Approved", "Approved and Paid", "Declined"];
// Canonical order pipeline. Single source of truth — OrderDetailModal,
// Production, Calendar, broker analytics all import this constant.
// Trimmed from 8 stages to 5 on 2026-05-12 (Joe's audit decision —
// Finishing, QC, and Ready for Pickup are inline with Printing for
// the single-press / garage-shop ICP). DB CHECK constraint mirrors
// this list, enforced by 20260518_slim_order_pipeline.sql.
export const O_STATUSES = ["Art Approval", "Order Goods", "Pre-Press", "Printing", "Completed"];

export const STANDARD_MARKUP = 1.4;
export const BROKER_MARKUP = 1.2;
// brokerMarkupShare semantics: % DISCOUNT off the shop's standard
// markup that brokers receive on their wholesale rate.
//   0.0 = no discount (broker pays full retail, $0 spread)
//   1.0 = full discount (broker pays raw cost, keeps the entire markup)
// Default 0.5 = 50/50 split — broker gets half the markup as their
// spread, shop keeps the other half. Set 2026-06-03.
//
// Fixed 2026-06-03: the formula was previously inverted relative to
// the labeled UX. The Account UI said "higher = lower wholesale" but
// the math did the opposite. Joe set 80% expecting a big broker
// discount and got the smallest possible spread (8% of cost). After
// the fix his 0.8 setting correctly applies an 80% discount.
export const BROKER_MARKUP_SHARE = DEFAULT_BROKER_MARKUP_SHARE;

// Per-shop pricing config — set via loadShopPricingConfig() on app startup.
// When null, all functions use the hardcoded defaults above.
let _pc = null;
// CACHE-01: which shop _pc was loaded for. Lets us detect cross-shop "bleed" —
// a quote for shop A priced while the module holds shop B's config (happens on
// multi-shop surfaces like the broker dashboard). Stage 1 is detection-only
// (telemetry, no math change); a later stage threads config to prevent it.
let _pcOwner = null;

export function loadShopPricingConfig(config, owner = null) {
  _pc = config && Object.keys(config).length > 0 ? config : null;
  _pcOwner = owner ?? null;
}

export function getShopPricingConfig() { return _pc; }
export function getShopPricingConfigOwner() { return _pcOwner; }

// CACHE-01 Stage 2a — snapshot / restore the module pricing-config globals.
// A surface that temporarily borrows another shop's config (an editor modal, a
// multi-shop render) can capture the session state, borrow, then put it back —
// instead of leaving a foreign config loaded, which is the "stale global" bleed
// mode. Snapshots carry the already-normalized _pc, so restore assigns directly.
export function getPricingConfigSnapshot() {
  return { config: _pc, owner: _pcOwner };
}
export function restorePricingConfigSnapshot(snap) {
  _pc = snap?.config ?? null;
  _pcOwner = snap?.owner ?? null;
}

// Run `fn` with `config`/`owner` temporarily loaded, then restore the prior
// snapshot — even if `fn` throws. Returns fn's result. This is the synchronous
// borrow/restore primitive Phase 2b will thread through the live calc so a
// multi-shop surface can price a quote under its OWNER's config without
// mutating the session global. Synchronous by design: do not pass an async fn
// (the restore would run before its awaited work).
export function withShopPricingConfig(config, owner, fn) {
  const snap = getPricingConfigSnapshot();
  try {
    loadShopPricingConfig(config, owner);
    return fn();
  } finally {
    restorePricingConfigSnapshot(snap);
  }
}

// Telemetry-only bleed detector (CACHE-01, Stage 1). Conservative to avoid
// false positives: both owners must be present and real (broker: pseudo-owners
// and blank/new quotes are skipped), and we warn once per (loaded→quoted) pair.
const _bleedSeen = new Set();
export function detectPricingConfigBleed(quoteShopOwner) {
  const loaded = _pcOwner;
  const quoted = quoteShopOwner;
  if (!loaded || !quoted) return false;
  if (String(loaded).startsWith("broker:") || String(quoted).startsWith("broker:")) return false;
  if (loaded === quoted) return false;
  const pair = `${loaded}=>${quoted}`;
  if (!_bleedSeen.has(pair)) {
    _bleedSeen.add(pair);
    // console.error is picked up by Sentry's console integration, surfacing
    // the real prod blast radius before we do the riskier config-threading.
    try { console.error(`[pricing] CACHE-01 config bleed: pricing a quote for "${quoted}" while config is loaded for "${loaded}"`); } catch { /* ignore */ }
  }
  return true;
}

// Default turnaround windows in BUSINESS days. The shop can override
// either of these in Account → Pricing alongside the Rush Fee %, so
// a one-person tee shop with a 2-week standard can show that on
// quotes instead of the platform-wide 10/5 fallback.
export const DEFAULT_STANDARD_TURNAROUND_DAYS = 10;
export const DEFAULT_RUSH_TURNAROUND_DAYS = 5;

function clampPositiveInt(n, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return fallback;
  return Math.round(x);
}

/**
 * Standard turnaround used as the default due-date offset on new
 * quotes. Returns shop's value when set; falls back to the platform
 * default (10) when not configured.
 */
export function getStandardTurnaroundDays() {
  return clampPositiveInt(_pc?.standardTurnaroundDays, DEFAULT_STANDARD_TURNAROUND_DAYS);
}

/**
 * Rush turnaround applied when the shop toggles Rush on a quote.
 * Falls back to platform default (5).
 */
export function getRushTurnaroundDays() {
  return clampPositiveInt(_pc?.rushTurnaroundDays, DEFAULT_RUSH_TURNAROUND_DAYS);
}

/**
 * Rush fee multiplier (e.g. 0.20 = +20%). Reads from shop config
 * with the historical 0.20 platform fallback so existing quote-modal
 * code that previously hard-coded 0.2 keeps producing the same
 * behavior for shops who never visited Account → Pricing.
 *
 * Kept for back-compat with the single-tier API. New consumers
 * should prefer getRushRateForDaysOut(daysOut) which respects the
 * shop's variable rush tier table.
 */
export function getShopRushRate() {
  const v = Number(_pc?.rushRate);
  if (Number.isFinite(v) && v >= 0) return v;
  return 0.20;
}

/**
 * The single rush tier the public wizard's Rush button advertises.
 *
 * Both values come straight from the shop's Rush Surcharge Tiers in
 * Account → Pricing. The wizard mirrors what the shop set:
 *
 *   - rate      = the LOOSEST tier's rate (largest maxDays). Multi-tier
 *                 shops keep their urgent tier (e.g. 3 days → 50%) as a
 *                 pricing override; the wizard advertises the moderate
 *                 one (e.g. 14 days → 20%) as the default rush option.
 *
 *   - daysLabel = a human-readable string of the days that hit the
 *                 advertised tier. Reads naturally as marketing copy:
 *
 *                   single tier  (maxDays=14)        → "14 business days or less"
 *                   multi-tier   ([{7,..}, {14,..}]) → "7-14 business days"
 *
 *                 Multi-tier uses the next-tighter tier's maxDays as
 *                 the low bound: a customer asking for fewer days than
 *                 the tighter tier's cutoff would hit THAT tier (a
 *                 different rate), so the loosest tier really only
 *                 covers the gap between the two.
 *
 * When NO tiers are configured we fall back to the legacy single-rate
 * pair (`rushRate` + `rushTurnaroundDays`). Both have defaults in
 * `getShopRushRate` / `getRushTurnaroundDays`, so the wizard still has
 * something to render for a brand-new shop that hasn't touched
 * Account → Pricing yet.
 *
 * @returns {{ daysLabel: string, rate: number }}
 */
export function getWizardRushDisplay() {
  const tiers = getRushTiers(); // ascending by maxDays
  if (tiers.length > 0) {
    const loosest = tiers[tiers.length - 1];
    const tighter = tiers.length > 1 ? tiers[tiers.length - 2] : null;
    const daysLabel = tighter
      ? `${tighter.maxDays}-${loosest.maxDays} business days`
      : `${loosest.maxDays} business days or less`;
    return { daysLabel, rate: loosest.rate };
  }
  return {
    daysLabel: `${getRushTurnaroundDays()} business days or less`,
    rate: getShopRushRate(),
  };
}

/**
 * Variable rush surcharge tiers. Each tier means:
 *   "if the order is due in less than `maxDays` business days,
 *    charge `rate` on top of the line subtotal."
 *
 * Tiers are returned sorted ascending by maxDays. The smallest
 * matching tier wins — a 2-day job hits the tightest tier first
 * (the highest rate), a 6-day job slides up to the looser tier.
 *
 * When the shop hasn't defined any tiers, we synthesize a single
 * tier from the legacy {rushRate, rushTurnaroundDays} pair so
 * existing quote behavior doesn't break for shops on the old
 * single-rate model.
 *
 * Tiers above the shop's standard turnaround are dropped on read —
 * "if due in less than 20 days" makes no sense when the shop's
 * standard turnaround is 10 days, because anything that close
 * would already qualify as standard.
 *
 * @returns {{ maxDays: number, rate: number }[]}
 */
export function getRushTiers() {
  const raw = _pc?.rushTiers;
  const std = getStandardTurnaroundDays();
  let tiers = [];
  if (Array.isArray(raw)) {
    tiers = raw
      .map((t) => ({
        maxDays: Math.round(Number(t?.maxDays)),
        rate: Number(t?.rate),
      }))
      .filter((t) =>
        Number.isFinite(t.maxDays) && t.maxDays > 0 && t.maxDays <= std &&
        Number.isFinite(t.rate) && t.rate >= 0
      );
  }
  // Legacy single-rate fallback. Lets shops who haven't migrated to
  // the tier table keep seeing rush surcharge on tight due dates.
  if (tiers.length === 0) {
    const legacyRate = Number(_pc?.rushRate);
    if (Number.isFinite(legacyRate) && legacyRate > 0) {
      const legacyMax = getRushTurnaroundDays();
      tiers = [{ maxDays: legacyMax, rate: legacyRate }];
    }
  }
  return tiers.sort((a, b) => a.maxDays - b.maxDays);
}

/**
 * Look up the rush rate for an order that is `daysOut` business
 * days from being due. Returns 0 (no rush) when daysOut is at or
 * above the shop's standard turnaround, or when no tier covers
 * that window.
 *
 * Picks the SMALLEST matching tier — tightest rush wins. A 2-day
 * job under tiers [(5, 0.50), (8, 0.25)] gets 0.50, not 0.25.
 *
 * @param {number} daysOut  business days between today and due date
 * @returns {number}        rate multiplier (0.20 = +20%); 0 = standard
 */
export function getRushRateForDaysOut(daysOut) {
  // Explicit nullish guard — Number(null) coerces to 0, which would
  // wrongly match the tightest tier as a "0-day" job.
  if (daysOut === null || daysOut === undefined) return 0;
  const d = Number(daysOut);
  if (!Number.isFinite(d)) return 0;
  if (d >= getStandardTurnaroundDays()) return 0;
  const tiers = getRushTiers(); // already sorted ascending
  for (const t of tiers) {
    if (d < t.maxDays) return t.rate;
  }
  return 0;
}

// Minimum order quantity per garment — derived from the shop's first
// screen-print tier. Defaults to 25 (the platform default tier) when
// no pricing config is loaded. Drives the wizard's "MIN X PCS" badge,
// per-garment quantity validation, and the est-quantity placeholder.
export function getMinOrderQty() {
  const tiers = _pc?.tiers;
  if (Array.isArray(tiers) && tiers.length > 0) {
    const first = Number(tiers[0]);
    if (Number.isFinite(first) && first > 0) return first;
  }
  return 25;
}


export function getTier(qty, tiersOverride) {
  const tiers = (Array.isArray(tiersOverride) && tiersOverride.length > 0)
    ? tiersOverride
    : (_pc?.tiers || [25, 50, 100, 200]);
  // Find the highest tier the qty meets or exceeds
  const sorted = [...tiers].sort((a, b) => b - a);
  for (const t of sorted) {
    if (qty >= t) return t;
  }
  return sorted[sorted.length - 1] || 25;
}

export function getQty(li) {
  const sizes = li?.sizes || {};
  // QB-imported lines (pullInvoices, Add to Production orders) carry a bare
  // `qty` with an EMPTY sizes map — without this fallback a 2,675-piece
  // imported job counted as 0 units everywhere (Units Sold, packing slips,
  // per-line displays). Any sizes key at all — including zero or negative
  // entries — keeps the original sizes-sum semantics untouched.
  if (Object.keys(sizes).length === 0) return parseInt(li?.qty, 10) || 0;
  return Object.values(sizes).reduce((sum, v) => sum + (parseInt(v, 10) || 0), 0);
}

// Shortfall tracking — the shop can record per-size misprints / losses
// against a line item. Shape mirrors `sizes`: { S: 1, M: 2, ... }
// stored on the line item as `_shortfall`. Defaults to {} so older
// orders without the field report 0 shortfall.
//
// Added 2026-05-27. Used by OrderDetailModal's Shortfall section and
// the per-line "X of Y completed" display. Does NOT affect pricing —
// quote/invoice totals stay anchored to the originally-quoted qty
// (Quote Snapshot Invariant). Billing adjustments for shortfall are
// a separate decision (credit memo / reorder) handled outside the
// pricing engine.
export function getShortfallQty(li) {
  return Object.values(li?._shortfall || {}).reduce((sum, v) => sum + (parseInt(v, 10) || 0), 0);
}

export function getCompletedQty(li) {
  return Math.max(0, getQty(li) - getShortfallQty(li));
}

// Sum of all garment units across an order's line items. Used on
// dashboards (Dashboard, Performance, BrokerPerformanceSelf) to show
// total pieces produced — defaults to 0 for orders without line_items.
export function getOrderUnits(order) {
  if (!order) return 0;
  return (order.line_items || []).reduce((sum, li) => sum + getQty(li), 0);
}

// Thin wrappers over the typed, unit-tested markup engine in
// @/lib/pricing/markup. They resolve the active pricing config
// (`configOverride ?? _pc`) — the only module-state dependency — then defer
// all math to the pure core, so behavior is unchanged and consumers/tests
// keep importing these same names. See docs/durability-and-typing-plan.md (B2).
export function getAdminMarkup(garmentCost, configOverride) {
  return adminMarkupCore(garmentCost, configOverride ?? _pc);
}

export function getBrokerMarkupShare(configOverride) {
  return brokerMarkupShareCore(configOverride ?? _pc);
}

export function getBrokerMarkup(garmentCost, share, configOverride) {
  return brokerMarkupCore(garmentCost, share, configOverride ?? _pc);
}

export function getMarkup(garmentCost, isBroker = false, configOverride) {
  return markupCore(garmentCost, isBroker, configOverride ?? _pc);
}

export function fmtDate(d) {
  if (!d) return "—";
  const p = String(d).split("-");
  return `${p[1]}/${p[2]}/${p[0]}`;
}

export function fmtMoney(n) {
  return "$" + (parseFloat(n) || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function uid() {
  return Math.random().toString(36).slice(2, 9);
}

// "Today" as a YYYY-MM-DD string, scoped to the shop's configured
// timezone. The historical implementation used new Date().toISOString()
// which returns the UTC date — wrong for any shop west of London past
// 5pm local. A shop in Reno writing a quote at 6pm Pacific got a quote
// stamped with tomorrow's UTC date, which then sorted into tomorrow's
// calendar slot. Same bug class fixed in Production/Orders earlier
// (handleAdvance + handleComplete).
//
// Falls through to the browser tz when no shop tz is set —
// shopTimezone.js has the precedence rules. Import is at the top
// of the file.
export function tod() {
  return todayInShopTz();
}

export function getDisplayName(customer) {
  if (typeof customer === "string") {
    try {
      const parsed = JSON.parse(customer);
      if (typeof parsed === "object" && parsed !== null) {
        return (parsed.company && parsed.company.trim()) || parsed.name || "Unknown";
      }
    } catch (e) {
      return customer;
    }
    return customer;
  }

  return (customer?.company && customer.company.trim()) || customer?.name || "Unknown";
}

export function isBrokerRecord(record) {
  return Boolean(record?.broker_id || record?.broker_email || record?.brokerId);
}

export function getOrderDisplayClient(order, fallbackCustomer = null) {
  if (isBrokerRecord(order)) {
    return order?.customer_name || order?.broker_name || order?.broker_company || order?.broker_id || "Unknown";
  }

  // Company-first: prefer the denormalized order.company (added 2026-06-18),
  // then the customer record, then the contact name. See
  // feedback_company_name_first.
  return (order?.company && order.company.trim()) || getDisplayName(fallbackCustomer || order?.customer_name);
}

export function getOrderDisplayJobTitle(order, fallbackCustomer = null) {
  if (isBrokerRecord(order)) {
    return order?.job_title || order?.broker_client_name || getDisplayName(fallbackCustomer || order?.broker_client_name || order?.customer_name);
  }

  // Direct (non-broker) orders: show the shop's own job label when set.
  // Every consumer guards on a truthy result, so an empty job title simply
  // renders nothing (no bare "Job:" line).
  return order?.job_title || "";
}

// Company-first END-CLIENT name for BROKER-FACING surfaces (a broker's own
// dashboard / invoices / order PDF). On broker ORDERS `customer_name` is
// swapped to the broker's OWN display name and the end client lives in
// `broker_client_name`; on broker QUOTES the end client is in `customer_name`.
// Prefer the denormalized company, then the end-client contact. This is the
// BROKER's view of their client — distinct from getOrderDisplayClient (the
// SHOP's view, which shows the broker on broker records).
export function getBrokerClientDisplay(rec) {
  const company = rec?.company && String(rec.company).trim();
  if (company) return company;
  const brokerClient = rec?.broker_client_name && String(rec.broker_client_name).trim();
  if (brokerClient) return brokerClient;
  const name = rec?.customer_name && String(rec.customer_name).trim();
  return name || "—";
}

export function newLineItem() {
  return {
    id: uid(),
    style: "",
    brand: "",
    category: "",
    garmentCost: "",
    garmentColor: "",
    sizes: {},
    imprints: [
      {
        id: uid(),
        title: "",
        location: "Front",
        width: "",
        height: "",
        colors: 1,
        pantones: "",
        technique: "Screen Print",
        details: "",
        linked: false,
      },
    ],
  };
}

// Get embroidery price per piece for a given stitch tier index and quantity
// Default embroidery pricing (used when shop hasn't saved custom config yet)
const DEFAULT_EMB_PRICING = {
  "Under 5K": { 12: 8.50, 24: 7.50, 48: 6.50, 72: 5.75, 144: 5.25 },
  "5K-10K":   { 12: 10.50, 24: 9.00, 48: 8.00, 72: 7.00, 144: 6.50 },
  "10K-15K":  { 12: 12.50, 24: 11.00, 48: 9.75, 72: 8.75, 144: 8.00 },
  "15K+":     { 12: 15.00, 24: 13.50, 48: 12.00, 72: 10.75, 144: 9.75 },
};
export const DEFAULT_EMB_STITCH_TIERS = ["Under 5K", "5K-10K", "10K-15K", "15K+"];
const DEFAULT_EMB_QTY_TIERS = [12, 24, 48, 72, 144];

function getEmbroideryPPP(stitchIdx, qty, configOverride) {
  const emb = (configOverride ?? _pc)?.embroidery;
  const pricing = emb?.pricing || DEFAULT_EMB_PRICING;
  const stitchTiers = emb?.stitchTiers || DEFAULT_EMB_STITCH_TIERS;
  const qtyTiers = emb?.qtyTiers || DEFAULT_EMB_QTY_TIERS;

  if (!stitchTiers.length) return 0;
  const stitchTier = stitchTiers[Math.min(stitchIdx, stitchTiers.length - 1)];
  // Find the best matching qty tier
  const sorted = [...qtyTiers].sort((a, b) => b - a);
  let tier = sorted[sorted.length - 1];
  for (const t of sorted) { if (qty >= t) { tier = t; break; } }
  // Try both number and string key (JSONB keys are strings)
  const tierPricing = pricing[stitchTier];
  if (!tierPricing) return 0;
  return tierPricing[tier] ?? tierPricing[String(tier)] ?? 0;
}

// calcGroupPrice has been deleted — use calcLinkedLinePrice for all pricing.

export function getPrintKey(imp) {
  return `${imp?.technique || "Screen Print"}|${imp?.title || ""}|${imp?.width || ""}|${imp?.height || ""}`;
}

export function findLinkedPrints(lineItems) {
  const printMap = {};

  (lineItems || []).forEach((li, liIdx) => {
    (li.imprints || []).forEach((imp) => {
      if (imp.linked && (imp.colors || 0) > 0) {
        const key = getPrintKey(imp);
        if (!printMap[key]) printMap[key] = [];
        printMap[key].push({ liIdx, impId: imp.id, li, imp });
      }
    });
  });

  return printMap;
}

export function buildLinkedQtyMap(lineItems) {
  const printMap = findLinkedPrints(lineItems);
  const qtyMap = {};

  // Dedupe by line-item index. The linked-qty tier reflects "how
  // many pieces of this print exist across line items," NOT "how
  // many imprints reference this print." A single line item with
  // Front + Back + Left Sleeve all using the wizard's default empty
  // title/width/height collapses to a single getPrintKey — without
  // this dedupe, the qty gets counted once per imprint and the volume
  // tier inflates by Nx. Caught when the wizard's "100-pc break" stopped
  // moving the per-piece price between 99 and 100.
  Object.entries(printMap).forEach(([key, items]) => {
    const seen = new Set();
    qtyMap[key] = items.reduce((sum, item) => {
      if (seen.has(item.liIdx)) return sum;
      seen.add(item.liIdx);
      return sum + getQty(item.li);
    }, 0);
  });

  return qtyMap;
}

// Count distinct screens needed for a quote's screen-print imprints.
// Same artwork shared across multiple line items (same `getPrintKey`)
// only counts ONCE — the shop only burns one set of screens for it.
// Embroidery imprints aren't counted (no screens, separate digitizing).
//
// The dedupe key here adds `location` on top of getPrintKey. getPrintKey
// is technique|title|width|height, and title/width/height are all blank
// by default (editor addImprint + every wizard submission) — so an
// untitled Front 4-color and Back 1-color would otherwise collapse to
// one key and bill max(4,1)=4 screens instead of 5. Placement is the
// one field that always distinguishes two prints on the same job.
// Deliberately NOT changed in getPrintKey itself: the qty-linking maps
// (findLinkedPrints/buildLinkedQtyMap) want same-art imprints combined
// across line items regardless, and location is stable across lines in
// the run-level wizard flow, so those semantics stay put.
export function calcSetupScreenCount(lineItems) {
  const seen = new Map();  // print-key+location → max color count seen for this print
  (lineItems || []).forEach((li) => {
    (li.imprints || []).forEach((imp) => {
      const tech = imp?.technique || "Screen Print";
      if (tech !== "Screen Print") return;
      const colors = Math.max(0, Number(imp?.colors) || 0);
      if (colors === 0) return;
      const key = `${getPrintKey(imp)}|${imp?.location || ""}`;
      // If the same print key shows up twice with different color counts
      // (shouldn't normally — colors are part of the imprint config not
      // the key — but be defensive), take the higher count so we don't
      // under-charge.
      seen.set(key, Math.max(seen.get(key) || 0, colors));
    });
  });
  let total = 0;
  for (const n of seen.values()) total += n;
  return total;
}

// Normalize a shop's setup-fee config to the array shape, accepting both
// the legacy single-rate shape and the current items-list shape. Lets
// older shops who only set perScreenRate continue to bill correctly
// while the UI is upgrading to multi-fee.
function resolveFeeItems(config) {
  if (Array.isArray(config?.items) && config.items.length > 0) {
    return config.items
      .filter((f) => f && f.id)
      .map((f) => ({
        id: String(f.id),
        label: f.label || f.id,
        rate: Number(f.rate) || 0,
        reorderRate: Number(f.reorderRate) || 0,
      }));
  }
  // Legacy single-rate config — synthesize one "Screens" item so old
  // shops keep working without a data migration.
  if (config?.perScreenRate != null || config?.reorderPerScreenRate != null) {
    return [{
      id: "screens",
      label: "Screens",
      rate: Number(config.perScreenRate) || 0,
      reorderRate: Number(config.reorderPerScreenRate) || 0,
    }];
  }
  return [];
}

// Compute setup-fee total for a quote.
//   lineItems        — the quote's line items (for auto-screen-count)
//   override         — when a positive integer, use this screen count
//                      instead of the auto-computed one (lets the shop
//                      pair screens or correct edge cases at the bottom
//                      of the editor)
//   isReorder        — when true, each fee uses its reorderRate instead
//                      of rate (cheaper — screens already exist from the
//                      first run, film/burn skipped)
//   skippedFeeIds    — array of fee ids to skip for this quote (e.g.
//                      ["colorMatch"] when the design doesn't need PMS)
//   config           — { enabled, items: [{ id, label, rate, reorderRate }] }
//                      or legacy { enabled, perScreenRate, reorderPerScreenRate }
// Returns { enabled, screens, items: [{ id, label, rate, total }], total }
// so the UI can render the line-by-line breakdown.
export function calcSetupFees({ lineItems, override, isReorder, skippedFeeIds, config } = {}) {
  // Gate logic: respect an EXPLICIT enabled flag in either direction.
  // When the flag is true → enabled. When the flag is FALSE → disabled
  // even if fee items are configured (so an operator who unchecked the
  // "Enabled" checkbox in Account → Pricing doesn't get phantom fees on
  // their quotes). Fall through to the "items configured" inference only
  // when the flag is undefined/null — that's the legacy-shop rescue
  // path mentioned in PR #268: shops who had fees pre-populated by
  // defaults but never separately toggled the flag still get the fees
  // they expect.
  const allItems = resolveFeeItems(config);
  const flag = config?.enabled;
  const enabled = flag === true || (flag == null && allItems.length > 0);
  if (!enabled) return { enabled: false, screens: 0, items: [], total: 0 };
  const auto = calcSetupScreenCount(lineItems);
  const screens = Number.isInteger(override) && override >= 0 ? override : auto;
  const skip = new Set(Array.isArray(skippedFeeIds) ? skippedFeeIds : []);
  const active = allItems
    .filter((f) => !skip.has(f.id))
    .map((f) => {
      const rate = isReorder ? f.reorderRate : f.rate;
      return { id: f.id, label: f.label, rate, total: Math.round(screens * rate * 100) / 100 };
    });
  const total = active.reduce((s, f) => s + f.total, 0);
  return { enabled: true, screens, items: active, total: Math.round(total * 100) / 100 };
}

export function calcLinkedLinePrice(li, rushRate, extras, markup, linkedQtyMap, sizePricesOverride, configOverride) {
  // configOverride threads the shop's pricing_config explicitly through the
  // whole line-price math so a multi-shop surface can price under the quote's
  // OWNER config regardless of what's loaded in the module global — CACHE-01
  // bleed becomes structurally impossible on this path. Defaults to `_pc` for
  // every existing caller, so behavior is identical when nothing is threaded.
  const pc = configOverride ?? _pc;
  const qty = getQty(li);
  if (!qty || qty < 1 || !li.imprints || li.imprints.length === 0) return null;

  const active = li.imprints.filter((i) => (i.colors || 0) > 0);
  if (active.length === 0) return null;

  // firstPrintOrdering controls which imprint absorbs the first-print
  // rate (setup is typically baked in). "fewest" (default, kept for
  // backward compat with shops set up before this toggle existed)
  // puts the smallest-color imprint first; "most" matches industry
  // convention where the heaviest imprint carries the setup. Per-shop
  // toggle in Account → Pricing.
  const ordering = pc?.firstPrintOrdering || "fewest";
  const sorted = ordering === "most"
    ? [...active].sort((a, b) => b.colors - a.colors)
    : [...active].sort((a, b) => a.colors - b.colors);
  const printBreakdown = [];

  let printCost = 0;
  let firstPPP = 0;
  let displayTier = getTier(qty, pc?.tiers);

  const fp = pc?.firstPrint || FIRST_PRINT;
  const ap = pc?.addlPrint || ADDL_PRINT;
  const maxColors = pc?.maxColors || 8;

  // Per-imprint technique pricing: each imprint uses its OWN technique's
  // rate table. Group-local "first" counter so a mix of embroidery +
  // screen print on the same line prices each correctly — embroidery
  // gets embroidery rates with its 30% additional-decoration discount;
  // screen prints get the screen-print first/additional tables. Was a
  // real bug where the whole line was priced under the FIRST imprint's
  // technique (e.g. setting imprint 2 to "Screen Print" silently still
  // charged embroidery × 0.7).
  //
  // For single-technique lines (the 99% case) this collapses to the
  // pre-fix behavior identically: all imprints share a technique →
  // share a group → group-local isFirst == overall isFirst.
  const groupCount = {}; // technique → count seen so far (used as next index)

  sorted.forEach((imp, overallIndex) => {
    const tech = imp.technique || "Screen Print";
    const isEmb = tech === "Embroidery";
    const gIdx = groupCount[tech] = (groupCount[tech] ?? -1) + 1;
    const isFirstInGroup = gIdx === 0;

    // Per-technique rate table: custom techniques (DTG, DTF, etc.)
    // get their own firstPrint/addlPrint/tiers/maxColors when
    // configured on Account → Pricing. Falls back to screen print's
    // tables for unknown techniques so newly-added techs without a
    // custom rate sheet still price something.
    const techCfg = isEmb ? null : getTechniqueRates(tech, pc);
    const techFp        = techCfg ? techCfg.firstPrint : fp;
    const techAp        = techCfg ? techCfg.addlPrint  : ap;
    const techTiers     = techCfg ? techCfg.tiers      : (pc?.tiers || [25, 50, 100, 200]);
    const techMaxColors = techCfg ? techCfg.maxColors  : maxColors;

    const colors = Math.min(techMaxColors, Math.max(1, imp.colors || 1));
    const linkedKey = imp.linked ? getPrintKey(imp) : null;
    const tierQty = linkedKey && linkedQtyMap[linkedKey] ? linkedQtyMap[linkedKey] : qty;
    let tier, rate;
    if (isEmb) {
      const stitchIdx = Math.max(0, colors - 1);
      rate = getEmbroideryPPP(stitchIdx, tierQty, pc);
      if (!isFirstInGroup) rate *= 0.7;
      const embTiers = pc?.embroidery?.qtyTiers || [12, 24, 48, 72, 144];
      const stiers = [...embTiers].sort((a, b) => b - a);
      tier = stiers[stiers.length - 1];
      for (const t of stiers) { if (tierQty >= t) { tier = t; break; } }
    } else {
      tier = getTier(tierQty, techTiers);
      const table = isFirstInGroup ? techFp : techAp;
      // Per-cell fallback to the Screen Print rate for a missing custom cell.
      // A custom technique table can be sparse (the Account editor writes it
      // cell-by-cell, and it promises "fields with no value fall back to your
      // Screen Print rates"). getTechniqueRates uses the whole sparse object,
      // so a filled 1-color row but empty 3-color row left table[3] undefined
      // and priced the decoration at $0. Fall back to the base Screen Print
      // cell (keyed by the base tiers) before giving up to 0.
      const baseTable = isFirstInGroup ? fp : ap;
      const baseTier = getTier(tierQty, pc?.tiers || [25, 50, 100, 200]);
      rate =
        table[colors]?.[tier] ??
        table[Math.min(colors, techMaxColors)]?.[tier] ??
        baseTable[colors]?.[baseTier] ??
        baseTable[Math.min(colors, maxColors)]?.[baseTier] ??
        0;
    }
    const lineCost = Math.round(rate * qty * 100) / 100;

    if (overallIndex === 0) {
      firstPPP = rate;
      displayTier = tier;
    }

    printCost += lineCost;

    printBreakdown.push({
      id: imp.id,
      title: imp.title || "",
      location: imp.location || "",
      colors,
      technique: tech,         // NEW: lets renderers show accurate per-imprint labels
      groupIndex: gIdx,        // NEW: position within technique group (0 = first)
      linked: !!imp.linked,
      tierQty,
      tier,
      rate,
      lineCost,
      isFirst: isFirstInGroup, // SEMANTIC: first within technique group, not overall
    });
  });

  const isBroker = markup === BROKER_MARKUP;
  const roundedPrintCost = Math.round(printCost * 100) / 100;

  // Extras lookup is line-level. For single-technique lines this
  // matches the pre-fix behavior exactly; for mixed lines we merge
  // both tables (their key sets are disjoint — e.g. puffEmbroidery vs
  // flashCure) so whichever extra the user toggles on resolves
  // against the right rate.
  //
  // NOTE: per-piece resolution moved AFTER `flatCost` is known so
  // percent-mode fees can apply against the line's garment cost.
  // The merged config table is still built here so flat fees that
  // need the shop-side rate (when quote.extras[k] === true rather
  // than a snapshotted number) keep working.
  const hasEmbroidery = sorted.some((i) => (i.technique || "Screen Print") === "Embroidery");
  const hasScreenPrint = sorted.some((i) => (i.technique || "Screen Print") === "Screen Print");
  // Custom-technique extras: merge in the extras for every custom
  // tech that appears on this line. Lets a "Specialty Foil" fee on
  // the DTF tab show up when the line has a DTF imprint, without
  // polluting screen-print-only lines with DTF-specific fees.
  const customExtras = {};
  const customBasis = {};
  const customTechs = pc?.custom_techniques || {};
  for (const imp of sorted) {
    const tech = imp.technique || "Screen Print";
    if (tech === "Screen Print" || tech === "Embroidery") continue;
    const techExtras = customTechs[tech]?.extras;
    if (techExtras && typeof techExtras === "object") {
      Object.assign(customExtras, techExtras);
    }
    const techBasis = customTechs[tech]?.extraBasis;
    if (techBasis && typeof techBasis === "object") {
      Object.assign(customBasis, techBasis);
    }
  }
  const er = {
    ...(hasScreenPrint ? (pc?.extras || EXTRA_RATES) : {}),
    ...(hasEmbroidery ? (pc?.embroidery?.extras || {}) : {}),
    ...customExtras,
  };
  // Merged category (basis) map — same scope-union as `er`, so a fee's category
  // resolves against the right technique's config when a snapshot doesn't carry
  // its own basis (older snapshots / true-toggles).
  const erBasis = {
    ...(hasScreenPrint ? (pc?.extraBasis || {}) : {}),
    ...(hasEmbroidery ? (pc?.embroidery?.extraBasis || {}) : {}),
    ...customBasis,
  };

  // Garment cost per size — use actual per-size prices from API when available,
  // fall back to flat garmentCost × markup for all sizes.
  const sizePrices = sizePricesOverride || li.sizePrices || {};
  const hasSizePrices = Object.keys(sizePrices).length > 0;
  const flatCost = parseFloat(li.garmentCost) || 0;
  const flatMarkup = getMarkup(flatCost, isBroker, pc);

  // Per-piece decoration cost — printCost is the total imprint cost
  // (first + additional locations × qty). Percent-mode extras apply
  // against THIS (not the garment), per the user's spec: a 10%
  // specialty-ink fee scales with the cost of decorating the
  // garment, not with the blank.
  const decorationPpp = qty > 0 ? printCost / qty : 0;

  // Resolve per-piece extras dollars. resolveExtraRatePerPiece handles:
  //   - number (legacy / flat snapshot)            → that many $/pc
  //   - { mode:"percent", rate:N } (new)           → decorationPpp × N/100
  //   - { mode:"flat",    rate:N }                 → N $/pc
  //   - true (no snapshot, look up shop rate)      → use er[k]
  const prints = printBreakdown.length;
  let extraPPP = 0;

  // LINE-level fees (li.extras): per_garment applies once per piece. per_job is
  // quote-level (skip). A per_print key here is LEGACY (fees were line-level with
  // a ×locations multiplier before per-print moved onto individual imprints,
  // 2026-07) — keep it working × prints so quotes saved in that window are exact.
  Object.entries(extras || {}).forEach(([k, on]) => {
    if (!on) return;
    const basis = _resolveExtraBasis(on, erBasis[k]);
    if (basis === "per_job") return;
    let ppp = on === true ? Number(er[k] || EXTRA_RATES[k] || 0) : _resolveExtraRatePerPiece(on, decorationPpp);
    if (basis === "per_print") ppp *= prints; // legacy line-level per-print
    extraPPP += ppp;
  });

  // PER-IMPRINT fees (imprint.extras): a per_print fee attaches to ONE specific
  // print, so it costs rate × qty for that print only — NOT × all locations.
  // Toggle underbase on the back and not the front → charged for the back alone.
  (li.imprints || []).forEach((imp) => {
    const impExtras = imp?.extras;
    if (!impExtras || typeof impExtras !== "object") return;
    Object.entries(impExtras).forEach(([k, on]) => {
      if (!on) return;
      const basis = _resolveExtraBasis(on, erBasis[k]);
      if (basis === "per_job") return; // never valid on an imprint; guard anyway
      extraPPP += on === true ? Number(er[k] || EXTRA_RATES[k] || 0) : _resolveExtraRatePerPiece(on, decorationPpp);
    });
  });

  const extraCost = Math.round(extraPPP * qty * 100) / 100;

  // Per-piece print + extras cost (same for all sizes)
  const printExtraPpp = qty > 0 ? Math.round((roundedPrintCost + extraCost) / qty * 100) / 100 : 0;

  // Build per-piece price for each size and compute garment cost total
  const sizeBreakdown = {}; // { size: { qty, garmentPpp, totalPpp } }
  let gCost = 0;
  // Count of pieces in big sizes (2XL+) — used as a denominator for the
  // size-averaged display prices below. NOT a surcharge anymore — the
  // 2XL upcharge was removed; per-size cost comes straight from the
  // supplier API.
  const twoXL = BIG_SIZES.reduce((sum, sz) => sum + (parseInt((li.sizes || {})[sz], 10) || 0), 0);

  Object.entries(li.sizes || {}).forEach(([sz, count]) => {
    const n = parseInt(count, 10) || 0;
    if (n <= 0) return;
    // Get the wholesale cost for this size
    const wholesaleCost = hasSizePrices && sizePrices[sz] > 0
      ? sizePrices[sz]
      : flatCost;
    const sizeMarkup = getMarkup(wholesaleCost, isBroker, pc);
    const garmentPpp = Math.round(wholesaleCost * sizeMarkup * 100) / 100;
    const totalPpp = Math.round((printExtraPpp + garmentPpp) * 100) / 100;
    sizeBreakdown[sz] = { qty: n, garmentPpp, totalPpp };
    gCost += Math.round(garmentPpp * n * 100) / 100;
  });

  // Base subtotal = sum of (totalPpp × qty) for each size — everything before rush
  let baseSubtotal = 0;
  Object.values(sizeBreakdown).forEach(({ qty: n, totalPpp }) => {
    baseSubtotal += Math.round(totalPpp * n * 100) / 100;
  });

  // Rush = percentage of base, rounded to cents
  const rushFee = rushRate > 0 ? Math.round(baseSubtotal * rushRate * 100) / 100 : 0;

  // Line total = what this line costs in full
  const lineTotal = baseSubtotal + rushFee;

  // Per-piece prices for size grid display (actual per-size, no rush)
  // regularPpp / oversizePpp are simplified averages for views that don't show per-size
  const regularQty = qty - twoXL;
  const regularPpp = regularQty > 0
    ? Math.round(Object.entries(sizeBreakdown)
        .filter(([sz]) => !BIG_SIZES.includes(sz))
        .reduce((s, [, v]) => s + v.totalPpp * v.qty, 0) / regularQty * 100) / 100
    : (qty > 0 ? Math.round(baseSubtotal / qty * 100) / 100 : 0);
  const oversizePpp = twoXL > 0
    ? Math.round(Object.entries(sizeBreakdown)
        .filter(([sz]) => BIG_SIZES.includes(sz))
        .reduce((s, [, v]) => s + v.totalPpp * v.qty, 0) / twoXL * 100) / 100
    : regularPpp;
  const ppp = qty > 0 ? Math.round(baseSubtotal / qty * 100) / 100 : 0;

  return {
    tier: displayTier,
    qty,
    twoXL,
    printCost: roundedPrintCost,
    gCost: Math.round(gCost * 100) / 100,
    extraCost,
    baseSubtotal: Math.round(baseSubtotal * 100) / 100,
    rushFee,
    lineTotal,
    regularPpp,
    oversizePpp,
    ppp,
    firstPPP,
    printBreakdown,
    sizeBreakdown, // { size: { qty, garmentPpp, totalPpp } } for detailed display
    sub: lineTotal,
  };
}

export function calcQuoteTotalsWithLinking(q, markup = STANDARD_MARKUP, configOverride) {
  // Defensive null/undefined: callers like effectiveQuoteTotals pre-
  // wrap with `q || {}`, but the bare function is also called from
  // analytics rollups where a missing row shouldn't crash. Test IT5
  // pins this contract.
  q = q || {};
  // CACHE-01: when the caller threads the quote-owner's config explicitly there
  // is no global to bleed from — pricing is config-explicit end to end. Only run
  // the telemetry detector on the legacy global path (no override supplied).
  if (!configOverride) detectPricingConfigBleed(q.shop_owner);
  const linkedQtyMap = buildLinkedQtyMap(q.line_items || []);
  let subtotal = 0;   // sum of baseSubtotals (before rush)
  let rushTotal = 0;   // sum of rushFees

  const respectOverride = markup === STANDARD_MARKUP;

  (q.line_items || []).forEach((li) => {
    const qty = getQty(li);
    const override = Number(li?.clientPpp);
    if (respectOverride && Number.isFinite(override) && override > 0 && qty > 0) {
      subtotal += override * qty;
      return;
    }
    const r = calcLinkedLinePrice(li, q.rush_rate, _getLineExtras(li, q), markup, linkedQtyMap, undefined, configOverride);
    if (r) {
      // Use ppp × qty so totals match the displayed average per-piece price
      subtotal += r.ppp * r.qty;
      rushTotal += r.rushFee;
    }
  });

  const sub = subtotal + rushTotal;
  const discVal = parseFloat(q.discount) || 0;
  const isFlat = q.discount_type === "flat" || (discVal > 100 && q.discount_type !== "percent");
  // Clamp the discount both ways: a flat discount can't push below $0, and a
  // PERCENT discount is bounded to 0..100 — without this, discount:150 yields a
  // NEGATIVE subtotal that flows into tax/total (and into the QB invoice). The
  // save-time helper (roundedQuoteTotals) already clamps; this matches it so the
  // displayed/emailed/QB numbers can't diverge or go negative.
  const pct = Math.min(Math.max(discVal, 0), 100);
  const afterDisc = isFlat ? Math.max(0, sub - discVal) : sub * (1 - pct / 100);

  // One-off additional fees: taxable charges join the taxed base; non-taxable
  // are added to the total after tax. (Setup fees are NOT folded in here — they
  // depend on shop config and are layered + snapshotted by the editor.) When a
  // quote has no additional_charges this is a no-op: tax/total are identical to
  // the legacy afterDisc+tax result, so existing snapshots are unaffected.
  // Per-job add-ons route through additional_charges (the JobFeesSection writes
  // a "jobfee_*" entry there), so they're summed by _sumAdditionalCharges below
  // — one pipeline, consistent everywhere (QB invoice, displays, PDF, payment).
  const addl = _sumAdditionalCharges(q.additional_charges);
  const taxBase = afterDisc + addl.taxable;
  const tax = taxBase * ((parseFloat(q.tax_rate) || 0) / 100);
  const total = taxBase + tax + addl.nonTaxable;

  return {
    subtotal,
    rushTotal,
    sub,
    subBeforeRush: subtotal, // deprecated alias
    afterDisc,
    additionalTaxable: addl.taxable,
    additionalNonTaxable: addl.nonTaxable,
    additionalTotal: addl.total,
    tax,
    total,
    deposit: total * ((parseFloat(q.deposit_pct) || 0) / 100),
  };
}

export function calcQuoteTotals(q, markup = STANDARD_MARKUP, configOverride) {
  return calcQuoteTotalsWithLinking(q, markup, configOverride);
}

// Product categories that drive both the line-item category picker and the
// QB item mapping. Keep this list in sync — adding one here automatically makes
// it available in the quote editor and as a distinct QB income item.
export const GARMENT_CATEGORIES = [
  "T-Shirts",
  "Long Sleeve",
  "Tank Tops",
  "Polos",
  "Hoodies & Sweatshirts",
  "Hats & Caps",
  "Bags & Accessories",
  "Jackets",
  "Customer Supplied",
  "Other",
];

// Translate an InkTracker line itemName (garment category, "Setup Fee", a fee
// label, "Embroidery", etc.) into the QuickBooks product/service item the shop
// wants it booked under. `qbItemMap` is a per-shop { inktrackerName: qbItemName }
// object stored in pricing_config.qb_item_map. When there's no mapping for a
// name, we return it unchanged — so behavior is IDENTICAL to today until a shop
// configures a mapping. This is what stops InkTracker from creating duplicate
// QB items (e.g. its "Hoodies & Sweatshirts" alongside the shop's existing
// "Sweatshirts") — point the category at the shop's real item and invoices land
// on it instead of spawning a new one.
export function mapQbItemName(name, qbItemMap) {
  if (!name || !qbItemMap || typeof qbItemMap !== "object") return name;
  const mapped = qbItemMap[name];
  return (typeof mapped === "string" && mapped.trim()) ? mapped.trim() : name;
}

// Split a garment line's customer-facing total into garment vs decoration
// portions, for per-technique QB revenue (the optional qb_split_lines mode).
// Allocates by COST ratio (garment cost vs print + extras) and returns
// whole-cent amounts that sum EXACTLY to `total` — the decoration portion
// absorbs the rounding remainder, so the QB invoice total never drifts from the
// quote (the line-sum = customer-total invariant holds). Edge cases:
//   no decoration cost  → all garment (caller emits a single line)
//   no garment cost     → all decoration (customer-supplied blanks)
// Returns { garment, decoration }.
export function allocateGarmentDecoration(total, gCost, printCost, extraCost = 0) {
  const t = Math.round((Number(total) || 0) * 100) / 100;
  const g = Math.max(0, Number(gCost) || 0);
  const p = Math.max(0, Number(printCost) || 0);
  const e = Math.max(0, Number(extraCost) || 0);
  const base = g + p + e;
  if (p + e <= 0 || base <= 0) return { garment: t, decoration: 0 };
  if (g <= 0) return { garment: 0, decoration: t };
  const garment = Math.round(t * (g / base) * 100) / 100;
  const decoration = Math.round((t - garment) * 100) / 100;
  return { garment, decoration };
}

// Map S&S data to one of our GARMENT_CATEGORIES.
// S&S's styleCategory is often empty, so we also scan the product description/title
// for keywords. Returns "" if we can't confidently classify (caller should leave the
// dropdown blank rather than guess).
export function mapSSCategoryToGarment(ssCategory, productDescription = "") {
  // IMPORTANT: check more specific keywords first. "Hooded" must beat "Sweatshirt".
  const s = `${ssCategory || ""} ${productDescription || ""}`.toLowerCase();
  if (!s.trim()) return "";
  if (s.includes("hood") || s.includes("sweatshirt") || s.includes("fleece") || s.includes("pullover") || s.includes("crewneck") || s.includes("crew sweat"))
                                                return "Hoodies & Sweatshirts";
  if (s.includes("jacket") || s.includes("outer") || s.includes("vest") || s.includes("coat") || s.includes("windbreaker"))
                                                return "Jackets";
  if (s.includes("polo"))                       return "Polos";
  if (s.includes("long sleeve") || s.includes("long-sleeve") || s.includes("longsleeve") || s.includes("l/s"))
                                                return "Long Sleeve";
  if (s.includes("tank") || s.includes("singlet") || s.includes("muscle"))
                                                return "Tank Tops";
  if (s.includes("hat") || s.includes("cap") || s.includes("beanie") || s.includes("headwear") || s.includes("visor") || s.includes("trucker") || s.includes("panel"))
                                                return "Hats & Caps";
  if (s.includes("bag") || s.includes("tote") || s.includes("backpack") || s.includes("accessor") || s.includes("scarf") || s.includes("glove") || s.includes("apron"))
                                                return "Bags & Accessories";
  if (s.includes("t-shirt") || s.includes("tee") || s.includes("t shirt"))
                                                return "T-Shirts";
  return "";
}

// Technique fallback mapping — used if a line has no explicit category
// (e.g. a quote created before categories existed).
function mapTechniqueToCategory(technique) {
  switch ((technique || "").trim()) {
    case "Embroidery":    return "Embroidery";
    case "Screen Print":  return "Custom Apparel";
    case "DTG":           return "Custom Apparel";
    case "DTF":           return "Custom Apparel";
    case "Heat Transfer": return "Custom Apparel";
    case "Sublimation":   return "Custom Apparel";
    default:              return "Custom Apparel";
  }
}

function primaryTechniqueForLine(li) {
  const imp = (li?.imprints || []).find((i) => (i.colors || 0) > 0) || (li?.imprints || [])[0];
  return imp?.technique || "";
}

// Pick the QB item name for a quote line. Prefers the explicit category, falls
// back to inferring from the primary imprint's technique for legacy quotes.
export function resolveLineCategory(li) {
  const explicit = (li?.category || "").trim();
  if (explicit) return explicit;
  return mapTechniqueToCategory(primaryTechniqueForLine(li));
}

export function buildQBInvoicePayload(quote, markup = STANDARD_MARKUP, configOverride) {
  const linkedQtyMap = buildLinkedQtyMap(quote.line_items || []);
  const lines = [];

  const isBroker = markup !== STANDARD_MARKUP;
  // Opt-in per-technique revenue: split each garment line into a garment line
  // + a decoration line (by technique). Off → identical single-line behavior.
  // configOverride keeps the QB payload config-explicit (CACHE-01) — defaults
  // to the module global for every existing caller.
  const splitEnabled = !!(configOverride ?? getShopPricingConfig())?.qb_split_lines;

  (quote.line_items || []).forEach((li) => {
    const qty = getQty(li);
    if (qty === 0) return;

    const styleLabel = [li.brand, li.style, li.garmentColor].filter(Boolean).join(" ") || "Garment";
    const sizeBreakdown = sortSizeEntries(Object.entries(li.sizes || {}))
      .filter(([, v]) => Number(v) > 0)
      .map(([k, v]) => `${k}:${v}`)
      .join(", ");
    const imprintDesc = (li.imprints || [])
      .map((imp) => [imp.title, imp.location, imp.technique].filter(Boolean).join(" / "))
      .filter(Boolean)
      .join("; ");
    // Add-on labels appear here only when the shop opted in (snapshotted onto
    // li._addon_labels at save time — empty otherwise).
    const addonLabels = Array.isArray(li._addon_labels) ? li._addon_labels.filter(Boolean) : [];
    const description = [styleLabel, sizeBreakdown, imprintDesc, addonLabels.join(", ")].filter(Boolean).join(" | ");

    const itemName = resolveLineCategory(li);

    // Emit this garment line as a single line (default) or, when the shop
    // opted into per-technique revenue, a garment line + a decoration line that
    // sum EXACTLY to `amount` (allocateGarmentDecoration preserves the total,
    // so the customer-facing total / line-sum invariant never changes).
    const emitGarmentLines = (amount) => {
      const amt = Number(Number(amount).toFixed(2));
      if (!splitEnabled) {
        lines.push({
          description, qty,
          unitPrice: Number((qty > 0 ? amt / qty : 0).toFixed(4)),
          amount: amt, itemName, taxable: true,
        });
        return;
      }
      let gCost = 0, printCost = 0, extraCost = 0;
      try {
        const br = calcLinkedLinePrice(li, quote.rush_rate, _getLineExtras(li, quote), markup, linkedQtyMap, undefined, configOverride);
        if (br) { gCost = br.gCost || 0; printCost = br.printCost || 0; extraCost = br.extraCost || 0; }
      } catch { /* fall back to all-garment */ }
      const { garment, decoration } = allocateGarmentDecoration(amt, gCost, printCost, extraCost);
      const garmentDesc = [styleLabel, sizeBreakdown, addonLabels.join(", ")].filter(Boolean).join(" | ");
      if (garment > 0 || decoration <= 0) {
        lines.push({
          description: garmentDesc, qty,
          unitPrice: Number((qty > 0 ? garment / qty : 0).toFixed(4)),
          amount: garment, itemName, taxable: true,
        });
      }
      if (decoration > 0) {
        const technique = primaryTechniqueForLine(li) || "Decoration";
        lines.push({
          description: imprintDesc || technique, qty,
          unitPrice: Number((qty > 0 ? decoration / qty : 0).toFixed(4)),
          amount: decoration, itemName: technique, taxable: true,
        });
      }
    };

    // Use saved pricing from "calculate once" — fall back to live
    // calc for legacy quotes or broker markup.
    //
    // CRITICAL — rush surcharge must surface in `amount`. The QB
    // invariant is sum(line.amount) === customer-facing subtotal.
    // The saved `_lineTotal` was historically `ppp × qty` (no rush);
    // the live-calc path was using `r.ppp × qty` (also no rush).
    // Both silently dropped the rush charge from QB invoices,
    // so customers paid one price (per the email/PDF) while QB
    // recorded a lower number. Pinned by numbersMatch.test.js N3.
    // Quote-snapshot invariant: prefer saved per-line stamps from
    // BrokerQuoteEditor/QuoteEditorModal at save time. The QB invoice's
    // lines must match what the customer saw on the quote PDF/email,
    // which means matching the same saved numbers — never a live
    // recompute with the current viewer's pricing config. See memory:
    // project_quote_immutability.md
    const hasSaved = Number.isFinite(li._ppp) && li._ppp > 0 && Number.isFinite(li._lineTotal);
    if (hasSaved) {
      const lineTotalWithRush = li._lineTotal + (Number.isFinite(li._rushFee) ? li._rushFee : 0);
      emitGarmentLines(lineTotalWithRush);
    } else {
      // Legacy fallback for line items predating the per-line stamping.
      // CRITICAL — clientPpp override (customer-negotiated per-piece
      // price) must win over the standard calc on admin quotes. The
      // calc helper itself doesn't honor it; calcQuoteTotalsWithLinking
      // applies it as a top-level subtotal substitution. Mirror that
      // here so the QB invoice doesn't quietly bill the standard
      // markup when the shop promised a discounted rate. Pinned by
      // pricingEdgeCases.test.js QI1.
      const override = Number(li?.clientPpp);
      const hasOverride = !isBroker && Number.isFinite(override) && override > 0;
      let lineTotalForQb;
      if (hasOverride) {
        lineTotalForQb = override * qty;
      } else {
        const r = calcLinkedLinePrice(li, quote.rush_rate, _getLineExtras(li, quote), markup, linkedQtyMap, undefined, configOverride);
        if (!r) return;
        lineTotalForQb = r.lineTotal;
      }
      emitGarmentLines(lineTotalForQb);
    }
  });

  // Setup / screen fees as their own QB line (taxable; part of the taxed base).
  // isFee=true keeps the discount-spread logic off it (discounts apply to
  // garments only, mirroring calcQuoteTotals where setup is added post-discount).
  const setupTotalForQb = Number(quote.setup_total) || 0;
  if (setupTotalForQb > 0) {
    lines.push({
      description: "Setup & Screen Fees",
      qty: 1,
      unitPrice: Number(setupTotalForQb.toFixed(2)),
      amount: Number(setupTotalForQb.toFixed(2)),
      itemName: "Setup Fee",
      taxable: true,
      isFee: true,
    });
  }

  // One-off additional fees (shipping, rush, …). Each carries its own taxable
  // flag so QB taxes only what the quote taxed.
  for (const c of _normalizeAdditionalCharges(quote.additional_charges)) {
    if (!(c.amount > 0)) continue;
    lines.push({
      description: c.label || "Additional fee",
      qty: 1,
      unitPrice: Number(c.amount.toFixed(2)),
      amount: Number(c.amount.toFixed(2)),
      itemName: c.label || "Additional Fee",
      taxable: !!c.taxable,
      isFee: true,
    });
  }

  // Use saved totals when available (calculate-once), fall back to live calc
  const hasSavedTotal = Number.isFinite(quote.total) && quote.total > 0;
  const totals = hasSavedTotal ? null : calcQuoteTotalsWithLinking(quote, markup, configOverride);
  const depositPct = parseFloat(quote.deposit_pct) || 0;
  const totalForDeposit = hasSavedTotal ? quote.total : (totals.afterDisc + totals.tax);
  const depositAmount = quote.deposit_paid && depositPct > 0
    ? Number((totalForDeposit * depositPct / 100).toFixed(2))
    : 0;

  const discVal = parseFloat(quote.discount) || 0;
  const isFlat = quote.discount_type === "flat" || (discVal > 100 && quote.discount_type !== "percent");

  // Apply the shop's QB item-name mapping (if any) to every line. No-op when
  // the shop hasn't configured one — so this is fully non-breaking.
  const qbItemMap = (configOverride ?? getShopPricingConfig())?.qb_item_map || null;
  if (qbItemMap) {
    for (const l of lines) l.itemName = mapQbItemName(l.itemName, qbItemMap);
  }

  return {
    lines,
    discountPercent: isFlat ? 0 : discVal,
    discountAmount: isFlat ? discVal : 0,
    discountType: isFlat ? "flat" : "percent",
    taxPercent: parseFloat(quote.tax_rate) || 0,
    depositAmount,
  };
}