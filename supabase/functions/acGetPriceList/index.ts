// AS Colour pricelist — Supabase Edge Function
//
// The pricelist endpoint requires a Bearer token from POST /v1/api/authentication
// in addition to the standard Subscription-Key header. This function logs in
// (using cached credentials), then fetches /v1/catalog/pricelist.
//
// Body: { styleCode?: string, refreshAuth?: boolean }
//   - styleCode: filter the returned price rows to one style
//   - refreshAuth: bypass the in-memory token cache and re-login
//
// Returns: { prices: { sku, styleCode, colour, size, price }[], total }

import {
  AC_BASE,
  CORS,
  acFetch,
  acHeaders,
  getAcBearerToken,
} from "../_shared/ascolour.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json().catch(() => ({}));
    const { styleCode, refreshAuth = false } = body;

    const token = await getAcBearerToken(refreshAuth);
    if (!token) {
      return Response.json(
        {
          error:
            "AS Colour authentication failed. Set ASCOLOUR_EMAIL / ASCOLOUR_PASSWORD secrets and verify the AS Colour website login works.",
        },
        { status: 401, headers: CORS },
      );
    }

    const url = `${AC_BASE}/catalog/pricelist`;
    const res = await fetch(url, {
      method: "GET",
      headers: { ...acHeaders({ Authorization: `Bearer ${token}` }) },
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let data: any;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }

    if (!res.ok) {
      console.error(`[acGetPriceList] ${res.status} body: ${String(text).slice(0, 300)}`);
      // If the cached token went stale, give the caller a hint to retry.
      const hint = res.status === 401 ? " (try { refreshAuth: true })" : "";
      return Response.json(
        { error: `AS Colour pricelist error ${res.status}${hint}`, details: data },
        { status: res.status, headers: CORS },
      );
    }

    const rows: any[] = Array.isArray(data)
      ? data
      : Array.isArray(data?.prices) ? data.prices
      : Array.isArray(data?.items) ? data.items
      : [];

    const prices = rows
      .map((r) => ({
        sku: r.sku ?? r.skuCode ?? "",
        styleCode: String(r.styleCode ?? r.style ?? ""),
        colour: r.colourName ?? r.colorName ?? r.colour ?? "",
        size: r.size ?? r.sizeName ?? "",
        price: Number(r.price ?? r.unitPrice ?? r.wholesalePrice ?? 0),
        currency: r.currency ?? "NZD",
      }))
      .filter((r) => !styleCode || r.styleCode === String(styleCode));

    return Response.json({ prices, total: prices.length }, { headers: CORS });
  } catch (err) {
    console.error("acGetPriceList error:", err);
    return Response.json(
      { error: (err as Error).message },
      { status: 500, headers: CORS },
    );
  }
});
