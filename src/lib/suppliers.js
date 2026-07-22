// Public-Shopify supply vendors browsable inside InkTracker. Each runs a
// public Shopify store (public /products.json + working /cart/{variant}:{qty}
// permalinks), so one code path serves all of them — adding a vendor is one
// entry here. This is the "public-Shopify supplier" adapter; API-based garment
// suppliers (S&S / AS Colour / SanMar) are a different path.
//
// Keep the keys in sync with SUPPLIER_STORES in supabase/functions/norcalCatalog.

export const SUPPLIERS = {
  norcal: { key: "norcal", label: "NorCal", storeUrl: "https://norcalsps.com", theme: "rose" },
  ryonet: { key: "ryonet", label: "Ryonet", storeUrl: "https://www.screenprinting.com", theme: "green" },
};

export const SUPPLIER_LIST = Object.values(SUPPLIERS);

// Resolve a supplier by key, or by matching a stored product URL's host (used
// when reordering an inventory item that was linked to one of these stores).
export function supplierForStoreUrl(url) {
  const u = String(url || "");
  return SUPPLIER_LIST.find((s) => u.includes(new URL(s.storeUrl).host)) || null;
}

// Shopify cart permalink: <store>/cart/{variantId}:{qty},{variantId}:{qty}
// Verified live against both stores (302 → pre-filled checkout). Skips lines
// with a non-numeric variant id or non-positive qty; returns null when nothing
// is orderable. refParams become the query string (e.g. { utm_source }).
export function supplierCartPermalink(storeUrl, lines, refParams = {}) {
  const store = String(storeUrl || "").replace(/\/+$/, "");
  if (!store) return null;
  const parts = (Array.isArray(lines) ? lines : [])
    .map((l) => ({
      id: String(l?.variantId ?? "").trim(),
      qty: Math.max(0, Math.floor(Number(l?.qty) || 0)),
    }))
    .filter((l) => /^\d+$/.test(l.id) && l.qty > 0)
    .map((l) => `${l.id}:${l.qty}`);
  if (parts.length === 0) return null;
  const qs = new URLSearchParams(refParams).toString();
  return `${store}/cart/${parts.join(",")}${qs ? `?${qs}` : ""}`;
}
