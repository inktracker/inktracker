// Tier-lookup leaf math — quantity price tier and embroidery per-piece rate.
// Extracted from components/shared/pricing.jsx (B2 of the money-path typing
// plan). Pure: callers pass the resolved tier arrays / config (the .jsx
// wrappers resolve the `_pc` fallback and the DEFAULT_EMB_* defaults), so these
// stay in the strict money type-gate and circular-import-free. Behavior is
// identical to the prior inlined versions.

import type { EmbTierPricing } from "@/types/pricing";

// Highest price tier the qty meets or exceeds (tiers need not be pre-sorted).
// Falls back to 25 when `tiers` is empty — matching the original `|| 25`.
export function tier(qty: number, tiers: number[]): number {
  const sorted = [...tiers].sort((a, b) => b - a);
  for (const t of sorted) {
    if (qty >= t) return t;
  }
  return sorted[sorted.length - 1] || 25;
}

// Embroidery per-piece rate for a stitch-count index at a given qty. `pricing`
// is keyed by stitch-tier label -> qty tier -> rate; `stitchTiers` are the
// ordered labels, `qtyTiers` the numeric quantity breaks. Returns 0 when the
// tier or its pricing cell is missing (same as the original).
export function embroideryPPP(
  stitchIdx: number,
  qty: number,
  pricing: Record<string, EmbTierPricing | undefined>,
  stitchTiers: string[],
  qtyTiers: number[],
): number {
  if (!stitchTiers.length) return 0;
  const stitchTier = stitchTiers[Math.min(stitchIdx, stitchTiers.length - 1)]!;
  // Best matching qty tier (highest break the qty meets).
  const sorted = [...qtyTiers].sort((a, b) => b - a);
  let tierQty = sorted[sorted.length - 1];
  for (const t of sorted) { if (qty >= t) { tierQty = t; break; } }
  const tierPricing = pricing[stitchTier];
  if (!tierPricing) return 0;
  // Try both the number and String(number) key (JSONB keys are strings). The
  // `as number` only lies in the empty-qtyTiers edge, where it resolves to the
  // "undefined" string key exactly as the original did.
  return tierPricing[tierQty as number] ?? tierPricing[String(tierQty)] ?? 0;
}
