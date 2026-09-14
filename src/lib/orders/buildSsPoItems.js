// Build canonical PO items for an S&S Activewear consolidated order from
// aggregated needs. Unlike AS Colour, S&S resolves the real SKU server-side
// (ssPlaceOrder looks the style up), so we DON'T need a lookup here — a line
// only needs style + colour + size + qty. We still stamp a "guessed" SKU so
// mergeItem has a stable per-variant key and the PO detail has something to
// show; ssPlaceOrder reads the explicit style/colour/size from the payload, so
// the guess never has to be a real SKU.

import { mergeItem } from "@/lib/purchaseOrders";

const norm = (s) => String(s ?? "").trim();

function guessedSku(style, color, size) {
  return [norm(style), norm(color).replace(/\s+/g, ""), norm(size)]
    .filter(Boolean)
    .join("-")
    .toUpperCase();
}

export function buildSsPoItems(lines) {
  let items = [];
  for (const need of Array.isArray(lines) ? lines : []) {
    const style = norm(need?.styleNumber);
    const color = norm(need?.color);
    if (!style) continue;
    for (const [size, qtyRaw] of Object.entries(need?.sizes || {})) {
      const qty = Number(qtyRaw) || 0;
      if (qty <= 0) continue;
      items = mergeItem(items, {
        sku: guessedSku(style, color, size),
        styleCode: style,
        color,
        size: norm(size),
        quantity: qty,
        unitPrice: Number(need?.unitCost) || 0,
        warehouse: "",
      });
    }
  }
  return items;
}
