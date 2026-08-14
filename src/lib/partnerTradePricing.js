// Partner trade-sheet PRICING (pure — no Supabase import, so it's unit-
// testable). docs/shop-partnerships-design.md, Phase 2.
//
// Pricing REUSES the real engine (calcLinkedLinePrice): the decoration cost
// (`printCost`) is computed purely from the sheet's rate tables, independent
// of garment cost, so a partner trade price is decoration-only at the
// receiver's rates. No forked math.
import { buildScaledSheet } from "@/lib/broker/brokerPricing";
import {
  calcLinkedLinePrice,
  buildLinkedQtyMap,
  STANDARD_MARKUP,
} from "@/components/shared/pricing";

// Turn a "% of my own standard rates" into a resolved decoration sheet in the
// shape the pricing engine reads (custom_techniques, embroidery.enabled).
// Known limitation (acceptance-gated, so a suggestion nit not a money bug):
// per-piece decoration EXTRAS and the embroidery digitizing fee are not
// carried, so a line with an imprint extra toggled prices its extra at the
// platform default and digitizing isn't surfaced. The receiver still confirms
// the number by accepting; the sender can adjust before sending.
export function buildTradeSheetConfig(shopConfig, scalePct) {
  const s = buildScaledSheet(shopConfig, scalePct);
  return {
    tiers: s.tiers,
    maxColors: s.maxColors,
    firstPrint: s.firstPrint,
    addlPrint: s.addlPrint,
    embroidery: s.embroidery ? { ...s.embroidery, enabled: true } : undefined,
    custom_techniques: s.customTechniques || {},
    firstPrintOrdering: shopConfig?.firstPrintOrdering || "fewest",
  };
}

// Trade total for a set of order lines priced at `config`. Decoration + any
// per-imprint decoration extras; garment cost is intentionally ignored (the
// receiver decorates goods the sender/customer supplies).
export function computeTradeTotal(lines, config) {
  const arr = Array.isArray(lines) ? lines : [];
  if (!arr.length || !config) return 0;
  const linkedQtyMap = buildLinkedQtyMap(arr);
  let total = 0;
  for (const li of arr) {
    const r = calcLinkedLinePrice(li, 0, {}, STANDARD_MARKUP, linkedQtyMap, null, config);
    if (r) total += (r.printCost || 0) + (r.extraCost || 0);
  }
  return Math.round(total * 100) / 100;
}
