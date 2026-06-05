import { todayInShopTz } from "@/lib/shopTimezone";

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
  // Future: add DTG, DTF, etc. when those pricing tabs are built
  return enabled;
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
export const BROKER_MARKUP_SHARE = 0.5;

// Per-shop pricing config — set via loadShopPricingConfig() on app startup.
// When null, all functions use the hardcoded defaults above.
let _pc = null;

export function loadShopPricingConfig(config) {
  _pc = config && Object.keys(config).length > 0 ? config : null;
}

export function getShopPricingConfig() { return _pc; }

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


export function getTier(qty) {
  const tiers = _pc?.tiers || [25, 50, 100, 200];
  // Find the highest tier the qty meets or exceeds
  const sorted = [...tiers].sort((a, b) => b - a);
  for (const t of sorted) {
    if (qty >= t) return t;
  }
  return sorted[sorted.length - 1] || 25;
}

export function getQty(li) {
  return Object.values(li?.sizes || {}).reduce((sum, v) => sum + (parseInt(v, 10) || 0), 0);
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

export function getAdminMarkup(garmentCost) {
  const cost = parseFloat(garmentCost) || 0;
  const tiers = _pc?.garmentMarkup;
  if (tiers && Array.isArray(tiers)) {
    // Config tiers: [{ above: 25, markup: 1.15 }, ...] sorted desc by "above"
    const sorted = [...tiers].sort((a, b) => b.above - a.above);
    for (const t of sorted) {
      if (cost > t.above) return t.markup;
    }
    return sorted[sorted.length - 1]?.markup || 1.4;
  }
  // Defaults
  if (cost > 25) return 1.15;
  if (cost > 15) return 1.22;
  if (cost > 8) return 1.3;
  return 1.4;
}

export function getBrokerMarkupShare() {
  return _pc?.brokerMarkupShare ?? BROKER_MARKUP_SHARE;
}

export function getBrokerMarkup(garmentCost, share) {
  // `share` is the broker's % DISCOUNT off the shop's standard markup.
  // The broker pays (1 - share) of the standard markup spread above
  // raw cost:
  //   share = 0   → broker pays full markup (no discount, no spread)
  //   share = 1   → broker pays raw cost (full discount, keeps all markup)
  //   share = 0.8 → broker pays 20% of the markup spread, keeps 80%
  // Pre-2026-06-03 the formula used `share` directly, which inverted
  // the UX — higher input gave smaller broker discount. See the
  // BROKER_MARKUP_SHARE constant header for the bug story.
  const s = share ?? getBrokerMarkupShare();
  const adminMarkup = getAdminMarkup(garmentCost);
  return 1 + ((adminMarkup - 1) * (1 - s));
}

export function getMarkup(garmentCost, isBroker = false) {
  return isBroker ? getBrokerMarkup(garmentCost) : getAdminMarkup(garmentCost);
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

  return getDisplayName(fallbackCustomer || order?.customer_name);
}

export function getOrderDisplayJobTitle(order, fallbackCustomer = null) {
  if (isBrokerRecord(order)) {
    return order?.job_title || order?.broker_client_name || getDisplayName(fallbackCustomer || order?.broker_client_name || order?.customer_name);
  }

  return "";
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
const DEFAULT_EMB_STITCH_TIERS = ["Under 5K", "5K-10K", "10K-15K", "15K+"];
const DEFAULT_EMB_QTY_TIERS = [12, 24, 48, 72, 144];

function getEmbroideryPPP(stitchIdx, qty) {
  const emb = _pc?.embroidery;
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
export function calcSetupScreenCount(lineItems) {
  const seen = new Map();  // print-key → max color count seen for this print
  (lineItems || []).forEach((li) => {
    (li.imprints || []).forEach((imp) => {
      const tech = imp?.technique || "Screen Print";
      if (tech !== "Screen Print") return;
      const colors = Math.max(0, Number(imp?.colors) || 0);
      if (colors === 0) return;
      const key = getPrintKey(imp);
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

export function calcLinkedLinePrice(li, rushRate, extras, markup, linkedQtyMap, sizePricesOverride) {
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
  const ordering = _pc?.firstPrintOrdering || "fewest";
  const sorted = ordering === "most"
    ? [...active].sort((a, b) => b.colors - a.colors)
    : [...active].sort((a, b) => a.colors - b.colors);
  const printBreakdown = [];

  let printCost = 0;
  let firstPPP = 0;
  let displayTier = getTier(qty);

  const fp = _pc?.firstPrint || FIRST_PRINT;
  const ap = _pc?.addlPrint || ADDL_PRINT;
  const maxColors = _pc?.maxColors || 8;

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

    const colors = Math.min(maxColors, Math.max(1, imp.colors || 1));
    const linkedKey = imp.linked ? getPrintKey(imp) : null;
    const tierQty = linkedKey && linkedQtyMap[linkedKey] ? linkedQtyMap[linkedKey] : qty;
    let tier, rate;
    if (isEmb) {
      const stitchIdx = Math.max(0, colors - 1);
      rate = getEmbroideryPPP(stitchIdx, tierQty);
      if (!isFirstInGroup) rate *= 0.7;
      const embTiers = _pc?.embroidery?.qtyTiers || [12, 24, 48, 72, 144];
      const stiers = [...embTiers].sort((a, b) => b - a);
      tier = stiers[stiers.length - 1];
      for (const t of stiers) { if (tierQty >= t) { tier = t; break; } }
    } else {
      tier = getTier(tierQty);
      const table = isFirstInGroup ? fp : ap;
      rate = table[colors]?.[tier] ?? table[Math.min(colors, 8)]?.[tier] ?? 0;
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
  const hasEmbroidery = sorted.some((i) => (i.technique || "Screen Print") === "Embroidery");
  const hasScreenPrint = sorted.some((i) => (i.technique || "Screen Print") !== "Embroidery");
  const er = {
    ...(hasScreenPrint ? (_pc?.extras || EXTRA_RATES) : {}),
    ...(hasEmbroidery ? (_pc?.embroidery?.extras || {}) : {}),
  };
  let extraPPP = 0;
  Object.entries(extras || {}).forEach(([k, on]) => {
    if (on) extraPPP += typeof on === "number" ? on : (er[k] || EXTRA_RATES[k] || 0);
  });
  const extraCost = Math.round(extraPPP * qty * 100) / 100;

  // Per-piece print + extras cost (same for all sizes)
  const printExtraPpp = qty > 0 ? Math.round((roundedPrintCost + extraCost) / qty * 100) / 100 : 0;

  // Garment cost per size — use actual per-size prices from API when available,
  // fall back to flat garmentCost × markup for all sizes.
  const sizePrices = sizePricesOverride || li.sizePrices || {};
  const hasSizePrices = Object.keys(sizePrices).length > 0;
  const flatCost = parseFloat(li.garmentCost) || 0;
  const flatMarkup = getMarkup(flatCost, isBroker);

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
    const sizeMarkup = getMarkup(wholesaleCost, isBroker);
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

export function calcQuoteTotalsWithLinking(q, markup = STANDARD_MARKUP) {
  // Defensive null/undefined: callers like effectiveQuoteTotals pre-
  // wrap with `q || {}`, but the bare function is also called from
  // analytics rollups where a missing row shouldn't crash. Test IT5
  // pins this contract.
  q = q || {};
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
    const r = calcLinkedLinePrice(li, q.rush_rate, q.extras, markup, linkedQtyMap);
    if (r) {
      // Use ppp × qty so totals match the displayed average per-piece price
      subtotal += r.ppp * r.qty;
      rushTotal += r.rushFee;
    }
  });

  const sub = subtotal + rushTotal;
  const discVal = parseFloat(q.discount) || 0;
  const isFlat = q.discount_type === "flat" || (discVal > 100 && q.discount_type !== "percent");
  const afterDisc = isFlat ? Math.max(0, sub - discVal) : sub * (1 - discVal / 100);
  const tax = afterDisc * ((parseFloat(q.tax_rate) || 0) / 100);

  return {
    subtotal,
    rushTotal,
    sub,
    subBeforeRush: subtotal, // deprecated alias
    afterDisc,
    tax,
    total: afterDisc + tax,
    deposit: (afterDisc + tax) * ((parseFloat(q.deposit_pct) || 0) / 100),
  };
}

export function calcQuoteTotals(q, markup = STANDARD_MARKUP) {
  return calcQuoteTotalsWithLinking(q, markup);
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

export function buildQBInvoicePayload(quote, markup = STANDARD_MARKUP) {
  const linkedQtyMap = buildLinkedQtyMap(quote.line_items || []);
  const lines = [];

  const isBroker = markup !== STANDARD_MARKUP;

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
    const description = [styleLabel, sizeBreakdown, imprintDesc].filter(Boolean).join(" | ");

    const itemName = resolveLineCategory(li);

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
      const unitPriceWithRush = qty > 0 ? lineTotalWithRush / qty : 0;
      lines.push({
        description,
        qty,
        unitPrice: Number(unitPriceWithRush.toFixed(4)),
        amount: Number(lineTotalWithRush.toFixed(2)),
        itemName,
      });
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
      let unitPriceForQb;
      if (hasOverride) {
        lineTotalForQb = override * qty;
        unitPriceForQb = override;
      } else {
        const r = calcLinkedLinePrice(li, quote.rush_rate, quote.extras, markup, linkedQtyMap);
        if (!r) return;
        lineTotalForQb = r.lineTotal;
        unitPriceForQb = qty > 0 ? r.lineTotal / qty : 0;
      }
      lines.push({
        description,
        qty,
        unitPrice: Number(unitPriceForQb.toFixed(4)),
        amount: Number(lineTotalForQb.toFixed(2)),
        itemName,
      });
    }
  });

  // Use saved totals when available (calculate-once), fall back to live calc
  const hasSavedTotal = Number.isFinite(quote.total) && quote.total > 0;
  const totals = hasSavedTotal ? null : calcQuoteTotalsWithLinking(quote, markup);
  const depositPct = parseFloat(quote.deposit_pct) || 0;
  const totalForDeposit = hasSavedTotal ? quote.total : (totals.afterDisc + totals.tax);
  const depositAmount = quote.deposit_paid && depositPct > 0
    ? Number((totalForDeposit * depositPct / 100).toFixed(2))
    : 0;

  const discVal = parseFloat(quote.discount) || 0;
  const isFlat = quote.discount_type === "flat" || (discVal > 100 && quote.discount_type !== "percent");

  return {
    lines,
    discountPercent: isFlat ? 0 : discVal,
    discountAmount: isFlat ? discVal : 0,
    discountType: isFlat ? "flat" : "percent",
    taxPercent: parseFloat(quote.tax_rate) || 0,
    depositAmount,
  };
}