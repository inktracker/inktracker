// Build draft PurchaseOrder payloads from an order's per-size
// shortfall data. Used by OrderDetailModal's "Reorder Shortfall"
// button — pulls every line item's _shortfall map, expands it into
// PO items keyed by SKU, BUCKETS BY SUPPLIER, and returns one payload
// per supplier ready for PurchaseOrder.create.
//
// Returns an empty array when there's nothing to reorder so callers
// can short-circuit cleanly.
//
// Multi-supplier behavior — added 2026-05-29 after AS Colour shipped
// their Order Assistant. Previously this function lumped every
// shortfall line into a single AS Colour PO regardless of the
// originating line item's supplier — which meant a mixed-supplier
// order (some S&S, some AC) produced a single mis-labeled PO that
// couldn't actually be submitted to either supplier. Now each
// supplier gets its own draft PO.
//
// Items with no `li.supplier` set fall back to AS Colour (the most
// common shop default). The operator can still change the supplier
// inside the PO editor.
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
//
// Why we don't import SUPPLIERS from @/api/suppliers: that file's
// first line is `import { supabase } from "@/api/supabaseClient"`,
// which calls createClient at module load time. In CI (no
// VITE_SUPABASE_URL) that throws and the whole test file fails to
// load. Inlining the literal keeps the helper pure and importable
// from tests. The shop-side supplier dropdown still uses SUPPLIERS
// directly, so the string remains the source of truth there.

const DEFAULT_SUPPLIER = "AS Colour";

/**
 * Returns an array of draft PO payloads — one per supplier. Empty
 * array when nothing to reorder. Each payload's reference suffixes
 * the supplier name when there are multiple, so the operator can
 * distinguish the rows in the Purchase Orders list at a glance.
 */
export function buildShortfallReorderPayloads(order, user) {
  if (!order || !user?.email) return [];

  // First pass — collect ALL shortfall items, tagged with their
  // resolved supplier. Resolution: explicit `li.supplier` wins;
  // otherwise default. Doing this in a single pass lets us decide
  // afterward whether to suffix references (single supplier doesn't
  // need a suffix).
  const itemsBySupplier = new Map();
  for (const li of order.line_items || []) {
    const shortfall = li?._shortfall || {};
    const supplier = li?.supplier || DEFAULT_SUPPLIER;
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
      const bucket = itemsBySupplier.get(supplier) || [];
      bucket.push({ sku, qty, color, size, style });
      itemsBySupplier.set(supplier, bucket);
    }
  }

  if (itemsBySupplier.size === 0) return [];

  const multiSupplier = itemsBySupplier.size > 1;
  const orderRef = order.order_id || "order";
  // Stable iteration order: alphabetical by supplier name so the
  // resulting POs sort predictably regardless of how line items
  // were ordered upstream.
  const suppliers = [...itemsBySupplier.keys()].sort();
  return suppliers.map((supplier) => ({
    shop_owner: user.email,
    supplier,
    status: "draft",
    reference: multiSupplier
      ? `Reorder — ${orderRef} (${supplier})`
      : `Reorder — ${orderRef}`,
    ship_to: "",
    items: itemsBySupplier.get(supplier),
    source_order_id: order.order_id || order.id,
  }));
}

/**
 * Back-compat single-payload wrapper. Returns the FIRST payload
 * (alphabetically by supplier) or null. Existing callers that haven't
 * migrated to the multi-supplier flow still work — they just only see
 * the first supplier's items. Prefer `buildShortfallReorderPayloads`
 * for new code.
 */
export function buildShortfallReorderPayload(order, user) {
  const list = buildShortfallReorderPayloads(order, user);
  return list[0] || null;
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
