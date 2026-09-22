// Which sizes ON an order actually cost more than the garment's base
// (cheapest) size. Drives the Quote Builder's "these sizes cost more" note.
//
// Most garments are flat-priced across sizes (e.g. AS Colour 5001 is $5.85 for
// every size), so this returns [] and the note stays hidden. It appears only on
// a genuine per-size upcharge — e.g. AS Colour 5101 charges $16 for XS–3XL but
// $19 for 4XL/5XL, or a Comfort Colors tee with a 2XL premium — and names the
// exact sizes affected. (Joe 2026-09-15: show it only when there's a real price
// increase, not just because a 2XL is on the order.)
//
// `sizePrices` is the same per-size COST map the pricing engine marks up from
// (supplier lookup, or a sale line's per-size map). `order` optionally supplies
// the size display order; the result follows it so the note reads S→5XL.

export function getUpchargedSizes(sizes, sizePrices, order) {
  if (!sizePrices || typeof sizePrices !== "object") return [];
  const costs = Object.values(sizePrices).map(Number).filter((n) => n > 0);
  if (costs.length === 0) return [];
  const base = Math.min(...costs);
  const keys = Array.isArray(order) && order.length ? order : Object.keys(sizes || {});
  const seen = new Set();
  return keys.filter((sz) => {
    if (seen.has(sz)) return false;
    seen.add(sz);
    const qty = parseInt((sizes || {})[sz], 10) || 0;
    return qty > 0 && Number(sizePrices[sz]) > base;
  });
}
