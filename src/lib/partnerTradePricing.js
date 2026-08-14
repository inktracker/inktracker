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

// Quick-seed: "% of my own standard rates" → a resolved DECORATION sheet in
// engine shape. Used by the editor's Quick Price slider.
// Known limitation (acceptance-gated, so a suggestion nit not a money bug):
// per-piece decoration EXTRAS and the embroidery digitizing fee aren't carried,
// so a line with an imprint extra toggled prices its extra at the platform
// default. The receiver still confirms by accepting; the sender can adjust.
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

// Full editor draft → the resolved config stored on the sheet. Garment markup
// rides along ONLY when the receiver supplies the blanks; otherwise the sheet
// is decoration-only and `receiver_supplies_garments` stays false.
export function tradeConfigFromDraft(draft, shopConfig, receiverSuppliesGarments) {
  const cfg = {
    tiers: draft.tiers,
    maxColors: draft.maxColors,
    firstPrint: draft.firstPrint,
    addlPrint: draft.addlPrint,
    embroidery: draft.embroidery
      ? {
          enabled: true,
          digitizingFee: draft.embroidery.digitizingFee,
          qtyTiers: draft.embroidery.qtyTiers,
          stitchTiers: draft.embroidery.stitchTiers,
          pricing: draft.embroidery.pricing,
        }
      : undefined,
    custom_techniques: draft.customTechniques || {},
    firstPrintOrdering: shopConfig?.firstPrintOrdering || "fewest",
    receiver_supplies_garments: !!receiverSuppliesGarments,
  };
  if (receiverSuppliesGarments) cfg.garmentMarkup = draft.garmentMarkup || [];
  return cfg;
}

// Trade total for a set of order lines priced at `config`.
//   - sender supplies blanks (default): DECORATION only (printCost + extras) —
//     garment cost ignored.
//   - receiver supplies blanks (config.receiver_supplies_garments): the FULL
//     line total (garment × the receiver's markup + decoration), using the
//     order line's garment cost as the basis (the sender still confirms).
export function computeTradeTotal(lines, config) {
  const arr = Array.isArray(lines) ? lines : [];
  if (!arr.length || !config) return 0;
  const withGarment = !!config.receiver_supplies_garments;
  const linkedQtyMap = buildLinkedQtyMap(arr);
  let total = 0;
  for (const li of arr) {
    const r = calcLinkedLinePrice(li, 0, {}, STANDARD_MARKUP, linkedQtyMap, null, config);
    if (!r) continue;
    total += withGarment ? (r.baseSubtotal || 0) : (r.printCost || 0) + (r.extraCost || 0);
  }
  return Math.round(total * 100) / 100;
}
