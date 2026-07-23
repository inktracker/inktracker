// Markup engine — the pure math behind garment markup and broker pricing,
// extracted from components/shared/pricing.jsx (B2 of the money-path typing
// plan, docs/durability-and-typing-plan.md). These functions are total and
// state-free: they take the resolved pricing config explicitly, so the
// module-level `_pc` fallback stays in pricing.jsx's thin wrappers and
// consumers see no change. Behavior is identical to the prior inlined
// versions — same tiers, same operators, same defaults.

import type { RawMoney } from "@/types/money";

export interface MarkupTier {
  above: number; // apply `markup` when cost is strictly greater than this
  markup: number; // multiplier on raw garment cost (e.g. 1.4 = +40%)
}

// The slice of a shop's pricing_config this engine reads. Both optional —
// when absent the built-in defaults apply.
export interface MarkupConfig {
  garmentMarkup?: MarkupTier[] | null;
  brokerMarkupShare?: number | null;
}

// Default broker share (50/50 split). See the BROKER_MARKUP_SHARE header in
// pricing.jsx for the semantics and the 2026-06-03 inversion bug story.
export const DEFAULT_BROKER_MARKUP_SHARE = 0.5;

// Multiplier applied to raw garment cost, tiered by cost. Config tiers win
// (sorted desc by threshold, first match on strict `>`), else the defaults.
export function adminMarkup(garmentCost: RawMoney, config?: MarkupConfig | null): number {
  const cost = parseFloat(String(garmentCost)) || 0;
  const tiers = config?.garmentMarkup;
  if (tiers && Array.isArray(tiers)) {
    const sorted = [...tiers].sort((a, b) => b.above - a.above);
    for (const t of sorted) {
      if (cost > t.above) return t.markup;
    }
    // `|| 1.4` (not ??): a 0/absent terminal markup falls back to default.
    return sorted[sorted.length - 1]?.markup || 1.4;
  }
  if (cost > 25) return 1.15;
  if (cost > 15) return 1.22;
  if (cost > 8) return 1.3;
  return 1.4;
}

export function brokerMarkupShare(config?: MarkupConfig | null): number {
  return config?.brokerMarkupShare ?? DEFAULT_BROKER_MARKUP_SHARE;
}

// Broker's effective multiplier: they pay (1 - share) of the markup spread
// above raw cost. share=0 → full markup; share=1 → raw cost; 0.8 → keep 80%.
export function brokerMarkup(
  garmentCost: RawMoney,
  share: number | undefined,
  config?: MarkupConfig | null,
): number {
  const s = share ?? brokerMarkupShare(config);
  const m = adminMarkup(garmentCost, config);
  return 1 + (m - 1) * (1 - s);
}

export function markup(
  garmentCost: RawMoney,
  isBroker: boolean,
  config?: MarkupConfig | null,
): number {
  return isBroker
    ? brokerMarkup(garmentCost, undefined, config)
    : adminMarkup(garmentCost, config);
}
