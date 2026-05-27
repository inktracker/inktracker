// Build a draft PurchaseOrder payload from an order's per-size
// shortfall data. Used by OrderDetailModal's "Reorder Shortfall"
// button — pulls every line item's _shortfall map, expands it into
// PO items keyed by SKU, and returns a payload ready for
// PurchaseOrder.create.
//
// Returns null when there's nothing to reorder (no line items have
// non-zero shortfall) so the caller can short-circuit cleanly.
//
// Supplier default: AS Colour (most common across InkTracker shops).
// Operator can change inside the PO editor before sending — the same
// editor used by manually-created POs.
//
// SKU shape: matches the Inventory restock CSV format
// (Inventory.jsx downloadCSV): "{style}{color-cleaned}-{size}". The
// 6-char color cap is a quirk of S&S's expected format; AC parses
// fine with longer color codes too, and operators can edit the SKU
// in the PO editor if needed.
//
// source_order_id links the PO back to the originating order so the
// PurchaseOrders page can surface "reorder for ORD-2026-XYZ" and
// future reporting can attribute waste to specific jobs.

import { SUPPLIERS } from "@/api/suppliers";

export function buildShortfallReorderPayload(order, user) {
  if (!order || !user?.email) return null;

  const items = [];
  for (const li of order.line_items || []) {
    const shortfall = li?._shortfall || {};
    for (const [size, raw] of Object.entries(shortfall)) {
      const qty = parseInt(raw, 10) || 0;
      if (qty <= 0) continue;
      const style = li.style || "";
      const color = li.garmentColor || li.color || "";
      const colorClean = String(color)
        .replace(/[^A-Z0-9]/gi, "")
        .toUpperCase()
        .slice(0, 6);
      const sku = li.sku || (style ? `${style}${colorClean}-${size}` : "");
      items.push({ sku, qty, color, size, style });
    }
  }

  if (items.length === 0) return null;

  return {
    shop_owner: user.email,
    supplier: SUPPLIERS.AC,
    status: "draft",
    reference: `Reorder — ${order.order_id || "order"}`,
    ship_to: "",
    items,
    source_order_id: order.order_id || order.id,
  };
}

// Convenience — total shortfall across the whole order. Useful for
// the button label ("Reorder Shortfall (6 pcs)").
export function totalOrderShortfall(order) {
  if (!order) return 0;
  let total = 0;
  for (const li of order.line_items || []) {
    for (const v of Object.values(li?._shortfall || {})) {
      total += parseInt(v, 10) || 0;
    }
  }
  return total;
}
