// Single source of truth for "is this inventory item low on stock?"
//
// Low stock means the shop OPTED the item into reorder tracking (set a
// positive reorder threshold) AND its on-hand quantity has fallen to or
// below that threshold. The `reorder > 0` guard is load-bearing: `reorder`
// has no DB default, so an untracked item's threshold is null → Number(null)
// is 0, and without the guard every zeroed-out item the shop never asked to
// track (qty 0 <= reorder 0) falsely reads as "needs reordering" — cluttering
// the shopping list, the row highlight, and the group flag with items that
// aren't reorder candidates at all.
//
// This definition previously lived inline in five places and had drifted:
// the Dashboard low-stock card, the Inventory count, and the reorder cart
// carried the guard, but the ShoppingList, the Inventory row/group highlight
// did not — so the same item showed as low in one surface and not another.
// Everything now routes through here so they can't diverge again.

export function isLowStock(item) {
  const reorder = Number(item?.reorder);
  const qty = Number(item?.qty);
  if (!(reorder > 0)) return false;
  return (Number.isFinite(qty) ? qty : 0) <= reorder;
}

export function filterLowStock(items) {
  return (items || []).filter(isLowStock);
}
