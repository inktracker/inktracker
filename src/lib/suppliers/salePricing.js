// Click-to-apply sale pricing (Joe 2026-07-20): clicking a supplier's sale
// line under Garment Cost used to fill one flat number and wipe the line's
// per-size prices — a 2XL that costs $2 more than a Small suddenly priced
// like a Small. This builds the per-size cost map the click applies instead.
//
// Per size, in order:
//   1. the supplier's actual per-size SALE price (colors[].sizeSalePrices),
//   2. otherwise that size's STANDARD price shifted down by the base
//      discount (standard base − clicked sale) — preserves the upcharge
//      even when the supplier only reported a sale on some sizes,
// and {} when the option has no per-size data at all (older cached lookups,
// blank-cost styles) — the flat clicked price is all there is to apply.
//
// `option` is a brandOptions entry; its `colors` array passes through
// normalization untouched, which is why this reads the colors channel and
// not sizePriceMap (getResultCandidates drops top-level sizePriceMap).

function round2(n) {
  return Math.round(n * 100) / 100;
}

export function buildSaleSizePrices(option, colorName, salePrice) {
  const sale = Number(salePrice);
  if (!(sale > 0)) return {};
  const colorObj = (option?.colors || []).find((c) => c?.colorName === colorName);
  const stdMap = colorObj?.sizePrices || {};
  const saleMap = colorObj?.sizeSalePrices || {};

  const base = Number(option?.priceMap?.[colorName]?.piecePrice) || 0;
  const discount = base > sale ? base - sale : 0;

  const out = {};
  for (const [size, stdRaw] of Object.entries(stdMap)) {
    const std = Number(stdRaw);
    if (!(std > 0)) continue;
    const sizeSale = Number(saleMap[size]);
    out[size] =
      sizeSale > 0 && sizeSale < std
        ? round2(sizeSale)
        : round2(Math.max(std - discount, 0.01));
  }
  return out;
}
