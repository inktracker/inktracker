// Line-price engine — the per-line quote math, extracted from
// components/shared/pricing.jsx (B2 of the money-path typing plan). This is a
// faithful, behavior-identical port of calcLinkedLinePrice: same tiers, same
// per-technique grouping, same sparse-table fallbacks, same extras resolution,
// same size breakdown and rush, same rounding (Math.round(x*100)/100) at every
// step. Nothing about the arithmetic changed — only types were added.
//
// It is pure: the shop pricing config `pc` is passed in (the .jsx wrapper
// resolves configOverride ?? _pc), and the handful of helpers/constants that
// still live in pricing.jsx / extras.js are injected via `deps` — both to keep
// this module in the strict money type-gate and to avoid a circular import.

import { markup as markupCore } from "@/lib/pricing/markup";
import type {
  LineItem,
  LinePriceDeps,
  LinePriceResult,
  LinePricingConfig,
  LinkedQtyMap,
  ExtrasMap,
  PrintBreakdownEntry,
  RateMap,
  ExtraBasisMap,
  SizeBreakdownEntry,
} from "@/types/pricing";

export function computeLinkedLinePrice(
  li: LineItem,
  rushRate: number,
  extras: ExtrasMap | null | undefined,
  markup: number,
  linkedQtyMap: LinkedQtyMap,
  sizePricesOverride: Record<string, number | undefined> | null | undefined,
  pc: LinePricingConfig | null | undefined,
  deps: LinePriceDeps,
): LinePriceResult | null {
  const qty = deps.getQty(li);
  if (!qty || qty < 1 || !li.imprints || li.imprints.length === 0) return null;

  const active = li.imprints.filter((i) => (i.colors || 0) > 0);
  if (active.length === 0) return null;

  // firstPrintOrdering: which imprint absorbs the first-print rate.
  const ordering = pc?.firstPrintOrdering || "fewest";
  const sorted = ordering === "most"
    ? [...active].sort((a, b) => (b.colors || 0) - (a.colors || 0))
    : [...active].sort((a, b) => (a.colors || 0) - (b.colors || 0));
  const printBreakdown: PrintBreakdownEntry[] = [];

  let printCost = 0;
  let firstPPP = 0;
  let displayTier = deps.getTier(qty, pc?.tiers);

  const fp = pc?.firstPrint || deps.FIRST_PRINT;
  const ap = pc?.addlPrint || deps.ADDL_PRINT;
  const maxColors = pc?.maxColors || 8;

  // technique -> count seen so far (group-local "first" index).
  const groupCount: Record<string, number> = {};

  sorted.forEach((imp, overallIndex) => {
    const tech = imp.technique || "Screen Print";
    const isEmb = tech === "Embroidery";
    const gIdx = groupCount[tech] = (groupCount[tech] ?? -1) + 1;
    const isFirstInGroup = gIdx === 0;

    const techCfg = isEmb ? null : deps.getTechniqueRates(tech, pc);
    const techFp        = techCfg ? techCfg.firstPrint : fp;
    const techAp        = techCfg ? techCfg.addlPrint  : ap;
    const techTiers     = techCfg ? techCfg.tiers      : (pc?.tiers || [25, 50, 100, 200]);
    const techMaxColors = techCfg ? techCfg.maxColors  : maxColors;

    const colors = Math.min(techMaxColors, Math.max(1, imp.colors || 1));
    const linkedKey = imp.linked ? deps.getPrintKey(imp) : null;
    const tierQty = linkedKey && linkedQtyMap[linkedKey] ? linkedQtyMap[linkedKey]! : qty;
    let tier: number;
    let rate: number;
    if (isEmb) {
      const stitchIdx = Math.max(0, colors - 1);
      rate = deps.getEmbroideryPPP(stitchIdx, tierQty, pc);
      if (!isFirstInGroup) rate *= 0.7;
      const embTiers = pc?.embroidery?.qtyTiers || [12, 24, 48, 72, 144];
      const stiers = [...embTiers].sort((a, b) => b - a);
      tier = stiers[stiers.length - 1]!;
      for (const t of stiers) { if (tierQty >= t) { tier = t; break; } }
    } else {
      tier = deps.getTier(tierQty, techTiers);
      const table = isFirstInGroup ? techFp : techAp;
      // Per-cell fallback to the base Screen Print rate for a missing custom cell.
      const baseTable = isFirstInGroup ? fp : ap;
      const baseTier = deps.getTier(tierQty, pc?.tiers || [25, 50, 100, 200]);
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
      technique: tech,
      groupIndex: gIdx,
      linked: !!imp.linked,
      tierQty,
      tier,
      rate,
      lineCost,
      isFirst: isFirstInGroup,
    });
  });

  const isBroker = markup === deps.BROKER_MARKUP;
  const roundedPrintCost = Math.round(printCost * 100) / 100;

  // Extras config table — union of the technique scopes present on the line.
  const hasEmbroidery = sorted.some((i) => (i.technique || "Screen Print") === "Embroidery");
  const hasScreenPrint = sorted.some((i) => (i.technique || "Screen Print") === "Screen Print");
  const customExtras: RateMap = {};
  const customBasis: ExtraBasisMap = {};
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
  const er: RateMap = {
    ...(hasScreenPrint ? (pc?.extras || deps.EXTRA_RATES) : {}),
    ...(hasEmbroidery ? (pc?.embroidery?.extras || {}) : {}),
    ...customExtras,
  };
  const erBasis: ExtraBasisMap = {
    ...(hasScreenPrint ? (pc?.extraBasis || {}) : {}),
    ...(hasEmbroidery ? (pc?.embroidery?.extraBasis || {}) : {}),
    ...customBasis,
  };

  // Garment cost per size — actual per-size prices when available, else the
  // flat garmentCost. (The original also computed a flat markup here that was
  // never read; omitted — getMarkup is pure, so dropping it is behavior-safe.)
  const sizePrices = sizePricesOverride || li.sizePrices || {};
  const hasSizePrices = Object.keys(sizePrices).length > 0;
  const flatCost = parseFloat(String(li.garmentCost)) || 0;

  const decorationPpp = qty > 0 ? printCost / qty : 0;
  const prints = printBreakdown.length;
  let extraPPP = 0;

  // LINE-level fees (li.extras): per_garment once per piece; per_job is skipped
  // (quote-level); a per_print key here is LEGACY (× locations).
  Object.entries(extras || {}).forEach(([k, on]) => {
    if (!on) return;
    const basis = deps.resolveExtraBasis(on, erBasis[k]);
    if (basis === "per_job") return;
    let ppp = on === true ? Number(er[k] || deps.EXTRA_RATES[k] || 0) : deps.resolveExtraRatePerPiece(on, decorationPpp);
    if (basis === "per_print") ppp *= prints;
    extraPPP += ppp;
  });

  // PER-IMPRINT fees (imprint.extras): a per_print fee costs rate × qty for that
  // print only — never × all locations.
  (li.imprints || []).forEach((imp) => {
    const impExtras = imp?.extras;
    if (!impExtras || typeof impExtras !== "object") return;
    Object.entries(impExtras).forEach(([k, on]) => {
      if (!on) return;
      const basis = deps.resolveExtraBasis(on, erBasis[k]);
      if (basis === "per_job") return; // never valid on an imprint; guard anyway
      extraPPP += on === true ? Number(er[k] || deps.EXTRA_RATES[k] || 0) : deps.resolveExtraRatePerPiece(on, decorationPpp);
    });
  });

  const extraCost = Math.round(extraPPP * qty * 100) / 100;
  const printExtraPpp = qty > 0 ? Math.round((roundedPrintCost + extraCost) / qty * 100) / 100 : 0;

  const sizeBreakdown: Record<string, SizeBreakdownEntry> = {};
  let gCost = 0;
  const twoXL = deps.BIG_SIZES.reduce((sum, sz) => sum + (parseInt(String((li.sizes || {})[sz]), 10) || 0), 0);

  Object.entries(li.sizes || {}).forEach(([sz, count]) => {
    const n = parseInt(String(count), 10) || 0;
    if (n <= 0) return;
    const sp = sizePrices[sz];
    const wholesaleCost = hasSizePrices && sp && sp > 0 ? sp : flatCost;
    const sizeMarkup = markupCore(wholesaleCost, isBroker, pc);
    const garmentPpp = Math.round(wholesaleCost * sizeMarkup * 100) / 100;
    const totalPpp = Math.round((printExtraPpp + garmentPpp) * 100) / 100;
    sizeBreakdown[sz] = { qty: n, garmentPpp, totalPpp };
    gCost += Math.round(garmentPpp * n * 100) / 100;
  });

  let baseSubtotal = 0;
  Object.values(sizeBreakdown).forEach(({ qty: n, totalPpp }) => {
    baseSubtotal += Math.round(totalPpp * n * 100) / 100;
  });

  const rushFee = rushRate > 0 ? Math.round(baseSubtotal * rushRate * 100) / 100 : 0;
  const lineTotal = baseSubtotal + rushFee;

  const regularQty = qty - twoXL;
  const regularPpp = regularQty > 0
    ? Math.round(Object.entries(sizeBreakdown)
        .filter(([sz]) => !deps.BIG_SIZES.includes(sz))
        .reduce((s, [, v]) => s + v.totalPpp * v.qty, 0) / regularQty * 100) / 100
    : (qty > 0 ? Math.round(baseSubtotal / qty * 100) / 100 : 0);
  const oversizePpp = twoXL > 0
    ? Math.round(Object.entries(sizeBreakdown)
        .filter(([sz]) => deps.BIG_SIZES.includes(sz))
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
    sizeBreakdown,
    sub: lineTotal,
  };
}
