// Shared domain types for the money-critical paths (pricing, quote/order
// totals, garment cost, billing). This is the anchor of the incremental
// TypeScript adoption described in docs/durability-and-typing-plan.md: the
// money modules are type-checked strictly against these shapes so the
// data-shape bug class (string prices, missing garmentCost, wrong fields)
// fails the compiler instead of shipping.
//
// Type-only module — no runtime code, so it is never bundled. Money modules
// reference it directly (import type) or via JSDoc `import("...")` types.

// A currency amount in dollars. Supplier APIs sometimes ship prices as
// strings ("3.18"), so anything sourced from an integration is `RawMoney`
// and MUST be coerced through Number() before arithmetic — the exact step
// whose absence let the string-coercion bug degrade downstream math.
export type Money = number;
export type RawMoney = number | string | null | undefined;

// Per-color blank pricing captured by the style enricher. `piecePrice` is
// the per-unit garment cost for that color; `RawMoney` because it can arrive
// as a string from S&S / AS Colour / SanMar.
export interface PriceMapEntry {
  piecePrice?: RawMoney;
}

// Map of color name -> per-color pricing (e.g. { "Black": { piecePrice: 3.18 } }).
export type PriceMap = Record<string, PriceMapEntry | undefined>;

// An enriched wizard style: the supplier catalog product plus the pricing
// the wizard needs. Both cost fields are optional and RawMoney because a
// given supplier may expose per-color pricing, a single flat catalog price,
// or (pre-sync) neither.
export interface WizardStyle {
  priceMap?: PriceMap;
  garmentCost?: RawMoney;
}

// One garment selection in the wizard: the chosen style and color.
export interface GarmentSelection {
  style?: WizardStyle | null;
  color?: string;
}
