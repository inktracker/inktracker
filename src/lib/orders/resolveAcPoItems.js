// Resolve aggregated AS Colour "needs" (style / colour / sizes) into canonical
// purchase-order items with REAL SKUs. AS Colour SKUs (STYLE-COLORCODE-FIT-SIZE)
// can't be generated — they come from acLookupStyle's variants — so a
// consolidated AS Colour PO must look each style up and match variants.
//
// We only ever emit an item on an EXACT (normalized) colour + size match; a
// miss goes to `unresolved` for the shop to add by hand. Ordering the wrong
// colour or size is worse than flagging it.

import { routeWarehouseForSku, mergeItem } from "@/lib/purchaseOrders";

const norm = (s) => String(s ?? "").trim().toUpperCase();

// Pure: match ONE need line against an acLookupStyle product.
// product = { styleCode|id, variants: [{sku, colour|color, size, price}],
//             stockBySkuWarehouse: { sku: { warehouse: qty } } }
export function matchAcVariantsForNeed(need, product, { defaultWarehouse = "CA" } = {}) {
  const items = [];
  const unresolved = [];
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const styleCode = product?.styleCode || product?.id || need?.styleNumber || "";
  const stockBySku = product?.stockBySkuWarehouse || {};
  const wantColor = norm(need?.color);

  for (const [size, qtyRaw] of Object.entries(need?.sizes || {})) {
    const qty = Number(qtyRaw) || 0;
    if (qty <= 0) continue;
    const wantSize = norm(size);
    const variant = variants.find(
      (v) => norm(v?.size) === wantSize && norm(v?.colour ?? v?.color) === wantColor,
    );
    if (!variant?.sku) {
      unresolved.push({ style: need?.styleNumber || styleCode, color: need?.color || "", size, qty });
      continue;
    }
    const { warehouse } = routeWarehouseForSku(stockBySku[variant.sku] || {}, defaultWarehouse, qty);
    items.push({
      sku: variant.sku,
      styleCode,
      color: variant.colour || variant.color || need?.color || "",
      size,
      quantity: qty,
      unitPrice: Number(variant.price) || Number(need?.unitCost) || 0,
      warehouse,
    });
  }
  return { items, unresolved };
}

// Async orchestrator: resolve every AS Colour need line via an injected
// `lookup(styleNumber) -> product|null` (one call per distinct style, cached),
// then merge the resulting items by sku+warehouse so the same variant needed by
// two jobs becomes one line. Returns the canonical PO items plus what couldn't
// be resolved (missing variant) or looked up (API error).
export async function resolveAcNeedsToItems(lines, { lookup, defaultWarehouse = "CA" } = {}) {
  const unresolved = [];
  const lookupErrors = [];
  const cache = new Map();
  let items = [];

  for (const need of Array.isArray(lines) ? lines : []) {
    let product = cache.get(need.styleNumber);
    if (!cache.has(need.styleNumber)) {
      try {
        product = await lookup(need.styleNumber);
      } catch (e) {
        product = null;
        lookupErrors.push({ style: need.styleNumber, message: e?.message || "lookup failed" });
      }
      cache.set(need.styleNumber, product);
    }
    if (!product) {
      for (const [size, qtyRaw] of Object.entries(need?.sizes || {})) {
        const qty = Number(qtyRaw) || 0;
        if (qty > 0) unresolved.push({ style: need.styleNumber, color: need.color, size, qty });
      }
      continue;
    }
    const res = matchAcVariantsForNeed(need, product, { defaultWarehouse });
    for (const it of res.items) items = mergeItem(items, it);
    unresolved.push(...res.unresolved);
  }

  return { items, unresolved, lookupErrors };
}
