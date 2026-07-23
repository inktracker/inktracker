// Pricing-domain types for the line-price engine (B2 of the money-path typing
// plan). Kept deliberately close to the real runtime shapes so the extracted
// calc in src/lib/pricing/linePrice.ts type-checks strictly without changing
// behavior. Shapes are permissive where the data genuinely is (supplier prices
// as strings, sparse rate tables, optional config) — the point is to catch the
// wrong-field / undefined-math bug class, not to over-constrain live data.

import type { RawMoney } from "@/types/money";
import type { MarkupConfig } from "@/lib/pricing/markup";

// colors -> tier qty -> per-piece rate. Sparse: a given colors/tier cell may
// be absent (the Account editor writes tables cell-by-cell).
export type RateTable = Record<number, Record<number, number> | undefined>;

// An extras toggle as stored on a line/imprint/quote: a bare boolean (look up
// the shop rate), a snapshotted number ($/pc), or a mode object.
export type ExtraToggle = boolean | number | { mode?: "percent" | "flat"; rate?: number };
export type ExtrasMap = Record<string, ExtraToggle | undefined>;
export type ExtraBasisMap = Record<string, string | undefined>;
export type RateMap = Record<string, number | undefined>;
export type LinkedQtyMap = Record<string, number | undefined>;

export interface LineImprint {
  id?: string;
  title?: string;
  location?: string;
  colors?: number;
  technique?: string;
  linked?: boolean;
  extras?: ExtrasMap;
}

export interface LineItem {
  qty?: number | string;
  sizes?: Record<string, number | string | undefined>;
  imprints?: LineImprint[];
  garmentCost?: RawMoney;
  sizePrices?: Record<string, number | undefined>;
  clientPpp?: RawMoney;
  _shortfall?: Record<string, number | string | undefined>;
}

export interface TechniqueRates {
  firstPrint: RateTable;
  addlPrint: RateTable;
  tiers: number[];
  maxColors: number;
}

export interface EmbroideryConfig {
  qtyTiers?: number[];
  extras?: RateMap;
  extraBasis?: ExtraBasisMap;
}

export interface CustomTechniqueConfig {
  firstPrint?: RateTable;
  addlPrint?: RateTable;
  tiers?: number[];
  maxColors?: number;
  extras?: RateMap;
  extraBasis?: ExtraBasisMap;
}

// The slice of a shop's pricing_config the line-price engine reads (plus the
// markup fields via MarkupConfig).
export interface LinePricingConfig extends MarkupConfig {
  firstPrintOrdering?: "fewest" | "most";
  tiers?: number[];
  firstPrint?: RateTable;
  addlPrint?: RateTable;
  maxColors?: number;
  embroidery?: EmbroideryConfig | null;
  custom_techniques?: Record<string, CustomTechniqueConfig | undefined> | null;
  extras?: RateMap;
  extraBasis?: ExtraBasisMap;
}

export interface PrintBreakdownEntry {
  // The port sets `id: imp.id` unconditionally, so the value may be undefined.
  id?: string | undefined;
  title: string;
  location: string;
  colors: number;
  technique: string;
  groupIndex: number;
  linked: boolean;
  tierQty: number;
  tier: number;
  rate: number;
  lineCost: number;
  isFirst: boolean;
}

export interface SizeBreakdownEntry {
  qty: number;
  garmentPpp: number;
  totalPpp: number;
}

export interface LinePriceResult {
  tier: number;
  qty: number;
  twoXL: number;
  printCost: number;
  gCost: number;
  extraCost: number;
  baseSubtotal: number;
  rushFee: number;
  lineTotal: number;
  regularPpp: number;
  oversizePpp: number;
  ppp: number;
  firstPPP: number;
  printBreakdown: PrintBreakdownEntry[];
  sizeBreakdown: Record<string, SizeBreakdownEntry>;
  sub: number;
}

// ---- Quote totals ---------------------------------------------------------

export interface AdditionalChargesSummary {
  taxable: number;
  nonTaxable: number;
  total: number;
}

// The slice of a quote the totals engine reads. Line items carry the pricing
// shape above; the rest are quote-level fields (discount, tax, deposit, fees).
export interface Quote {
  line_items?: LineItem[];
  shop_owner?: string;
  rush_rate?: number;
  discount?: RawMoney;
  discount_type?: string;
  tax_rate?: RawMoney;
  deposit_pct?: RawMoney;
  additional_charges?: unknown; // shape owned by @/lib/pricing/additionalCharges
}

export interface QuoteTotals {
  subtotal: number;
  rushTotal: number;
  sub: number;
  subBeforeRush: number; // deprecated alias for subtotal
  afterDisc: number;
  additionalTaxable: number;
  additionalNonTaxable: number;
  additionalTotal: number;
  tax: number;
  total: number;
  deposit: number;
}

export interface QuoteTotalsDeps {
  detectPricingConfigBleed: (shopOwner?: string) => void;
  buildLinkedQtyMap: (lineItems: LineItem[]) => LinkedQtyMap;
  getQty: (li: LineItem) => number;
  calcLinkedLinePrice: (
    li: LineItem,
    rushRate: number | undefined,
    extras: ExtrasMap,
    markup: number,
    linkedQtyMap: LinkedQtyMap,
    sizePricesOverride: Record<string, number | undefined> | undefined,
    configOverride: LinePricingConfig | null | undefined,
  ) => LinePriceResult | null;
  getLineExtras: (li: LineItem, quote: Quote) => ExtrasMap;
  sumAdditionalCharges: (charges: unknown) => AdditionalChargesSummary;
  STANDARD_MARKUP: number;
}

// Helpers the engine needs that still live in pricing.jsx (or extras.js).
// Injected rather than imported to keep the money type-gate pure-TS and to
// avoid a circular import back into pricing.jsx.
export interface LinePriceDeps {
  getQty: (li: LineItem) => number;
  getTier: (qty: number, tiers?: number[] | null) => number;
  getPrintKey: (imp: LineImprint) => string;
  getEmbroideryPPP: (stitchIdx: number, qty: number, config?: LinePricingConfig | null) => number;
  getTechniqueRates: (tech: string, config?: LinePricingConfig | null) => TechniqueRates | null;
  resolveExtraBasis: (on: ExtraToggle, configBasis?: string) => string;
  resolveExtraRatePerPiece: (on: ExtraToggle, decorationPpp: number) => number;
  FIRST_PRINT: RateTable;
  ADDL_PRINT: RateTable;
  EXTRA_RATES: RateMap;
  BIG_SIZES: string[];
  BROKER_MARKUP: number;
}
