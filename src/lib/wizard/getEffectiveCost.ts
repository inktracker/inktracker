// Per-color garment cost resolution for the customer-facing wizard.
//
// Extracted from OrderWizard.jsx so the contract test (configContract.test.js)
// can import the REAL function instead of an inlined replica. The prior
// inlined-copy pattern meant changes to the wizard's actual lookup didn't
// fail tests — exactly the gap that let the string-coercion bug ship.
//
// Cascading fallback chain (first non-zero wins):
//   1. priceMap[selectedColor].piecePrice — per-color blank price.
//      Authoritative when the supplier exposes per-color pricing.
//   2. style.garmentCost — flat fallback when the supplier ships one
//      catalog price (and our enricher captured it).
//   3. ANY priceMap entry's piecePrice — the "Black wasn't synced but
//      White was" edge case. Better to charge the average garment than
//      to silently invoice $0 for the blank.
//   4. 0 — true unknown. The wizard UI surfaces "Add quantities to
//      see pricing" until the shop re-syncs the style.
//
// Every read coerces through Number(). Some supplier APIs ship prices
// as strings ("3.18"); the prior `||` chain treated them as truthy
// without parsing, and the math downstream silently degraded.

import type { GarmentSelection, Money } from "@/types/money";

export function getEffectiveCost(gg: GarmentSelection | null | undefined): Money {
  if (!gg?.style) return 0;
  const pm = gg.style.priceMap || {};
  const direct = Number(pm[gg.color ?? ""]?.piecePrice);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const flat = Number(gg.style.garmentCost);
  if (Number.isFinite(flat) && flat > 0) return flat;
  for (const v of Object.values(pm)) {
    const p = Number(v?.piecePrice);
    if (Number.isFinite(p) && p > 0) return p;
  }
  return 0;
}
