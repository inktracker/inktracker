// AS Colour inventory query — Supabase Edge Function
//
// Body: { sku?: string, skuFilter?: string, pageNumber?: number, pageSize?: number }
//   - sku: exact SKU lookup → /v1/inventory/items/{sku}
//   - skuFilter: wildcard → /v1/inventory/items?skuFilter=...
//   - neither: paginated full list
//
// Returns: { items: NormalisedInventoryItem[], pageNumber, pageSize, total? }

import {
  AC_BASE,
  CORS,
  acFetch,
  normalizeInventoryItem,
} from "../_shared/ascolour.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json().catch(() => ({}));
    const { sku, skuFilter, pageNumber = 1, pageSize = 250 } = body;

    let url: string;
    if (sku) {
      url = `${AC_BASE}/inventory/items/${encodeURIComponent(String(sku).trim())}`;
    } else if (skuFilter) {
      const params = new URLSearchParams({
        skuFilter: String(skuFilter).trim(),
        pageNumber: String(pageNumber),
        pageSize: String(Math.min(250, pageSize)),
      });
      url = `${AC_BASE}/inventory/items?${params.toString()}`;
    } else {
      const params = new URLSearchParams({
        pageNumber: String(pageNumber),
        pageSize: String(Math.min(250, pageSize)),
      });
      url = `${AC_BASE}/inventory/items?${params.toString()}`;
    }

    const { ok, status, data } = await acFetch(url, {}, "acGetInventory");
    if (!ok) {
      return Response.json(
        { error: `AS Colour inventory error ${status}`, details: data },
        { status: status || 502, headers: CORS },
      );
    }

    const rawRows: any[] = Array.isArray(data)
      ? data
      : Array.isArray(data?.items) ? data.items
      : data && typeof data === "object" ? [data]
      : [];

    const items = rawRows.map(normalizeInventoryItem);

    return Response.json(
      { items, pageNumber, pageSize, total: items.length },
      { headers: CORS },
    );
  } catch (err) {
    console.error("acGetInventory error:", err);
    return Response.json(
      { error: (err as Error).message },
      { status: 500, headers: CORS },
    );
  }
});
