// Post-reorder stock additions.
//
// After a supplier reorder cart is submitted, the shop is asked whether the
// ordered quantities should be added to on-hand stock — with a per-line
// checkbox, because a vendor cart isn't a purchase: something may have been
// out of stock at checkout, and phantom inventory is worse than none
// (Joe, 2026-08-26: "in case something was out of stock, then we would not
// want it added").
//
// Pure functions; the Inventory page does the actual writes.

/**
 * Match reorder-cart lines to inventory rows by supplier variant id.
 *
 * @param {Array<{id: string, supplier_variant_id?: string|null, qty?: number}>} items
 * @param {Array<{variantId: string|number, qty: number}>} lines
 * @returns {Array<{ line: object, item: object|null }>} one entry per cart
 *          line, `item` null when nothing in inventory tracks that variant.
 */
export function matchLinesToItems(items, lines) {
  const byVariant = new Map();
  for (const it of items || []) {
    if (it?.supplier_variant_id != null && it.supplier_variant_id !== "") {
      // First match wins; duplicate-variant rows are a data smell we don't
      // compound by double-adding.
      const key = String(it.supplier_variant_id);
      if (!byVariant.has(key)) byVariant.set(key, it);
    }
  }
  return (lines || []).map((line) => ({
    line,
    item: byVariant.get(String(line?.variantId)) ?? null,
  }));
}

/**
 * Compute the qty updates for the SELECTED lines.
 *
 * @param {Array<{line: object, item: object|null}>} matches  from matchLinesToItems
 * @param {Set<string>} selectedVariantIds  variant ids the shop left checked
 * @returns {{ updates: Array<{id: string, qty: number, added: number}>, totalAdded: number, skippedUnmatched: number }}
 */
export function buildStockUpdates(matches, selectedVariantIds) {
  const updates = [];
  let totalAdded = 0;
  let skippedUnmatched = 0;
  for (const { line, item } of matches || []) {
    const vid = String(line?.variantId ?? "");
    if (!selectedVariantIds?.has(vid)) continue;
    const added = Math.max(0, parseInt(line?.qty, 10) || 0);
    if (!added) continue;
    if (!item) { skippedUnmatched++; continue; }
    updates.push({
      id: item.id,
      qty: (parseInt(item.qty, 10) || 0) + added,
      added,
    });
    totalAdded += added;
  }
  return { updates, totalAdded, skippedUnmatched };
}
