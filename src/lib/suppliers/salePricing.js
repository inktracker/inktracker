import { round2 } from "@/lib/pricing/round2";
// Click-to-apply sale pricing (Joe 2026-07-20): clicking a supplier's sale
// line under Garment Cost used to fill one flat number and wipe the line's
// per-size prices — a 2XL that costs $2 more than a Small suddenly priced
// like a Small. This builds the per-size cost map the click applies instead.
//
// Per size, in order:
//   1. the supplier's actual per-size SALE price (colors[].sizeSalePrices),
//   2. a size the supplier did NOT put on sale:
//      a. when the supplier reported per-size sales at all (saleMap non-empty),
//         that size is GENUINELY not on sale → keep its full STANDARD price.
//         S&S gives exact per-size sales and leaves e.g. 3XL/4XL off sale; the
//         cost matrix must price those from their real $10.11, not a shifted
//         number (Joe 2026-09-15: "be sure the pricing matrix is applied to
//         the actual cost of each garment").
//      b. when the supplier reported NO per-size sales (saleMap empty — a
//         color-level sale only, e.g. SanMar, or an older cached lookup),
//         shift that size's standard price down by the base discount
//         (standard base − clicked sale) so the single sale still spreads
//         across sizes while preserving each size's upcharge.
// and {} when the option has no per-size data at all (blank-cost styles) —
// the flat clicked price is all there is to apply.
//
// `option` is a brandOptions entry; its `colors` array passes through
// normalization untouched, which is why this reads the colors channel and
// not sizePriceMap (getResultCandidates drops top-level sizePriceMap).


export function buildSaleSizePrices(option, colorName, salePrice) {
  const sale = Number(salePrice);
  if (!(sale > 0)) return {};
  const colorObj = (option?.colors || []).find((c) => c?.colorName === colorName);
  const stdMap = colorObj?.sizePrices || {};
  const saleMap = colorObj?.sizeSalePrices || {};
  // Did the supplier report per-size sales? If so, a size absent from the map
  // is not on sale and must hold its standard cost (2a). Only a supplier that
  // gave no per-size sales at all gets the discount spread across sizes (2b).
  const hasPerSizeSale = Object.keys(saleMap).length > 0;

  const base = Number(option?.priceMap?.[colorName]?.piecePrice) || 0;
  const discount = base > sale ? base - sale : 0;

  const out = {};
  for (const [size, stdRaw] of Object.entries(stdMap)) {
    const std = Number(stdRaw);
    if (!(std > 0)) continue;
    const sizeSale = Number(saleMap[size]);
    if (sizeSale > 0 && sizeSale < std) {
      out[size] = round2(sizeSale);              // 1: supplier's real per-size sale
    } else if (hasPerSizeSale) {
      out[size] = round2(std);                   // 2a: not on sale → actual standard cost
    } else {
      out[size] = round2(Math.max(std - discount, 0.01)); // 2b: spread color-level sale
    }
  }
  return out;
}
