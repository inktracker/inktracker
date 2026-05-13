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
//
// Auth required: anonymous access would expose AS Colour wholesale pricing
// to anyone with the public URL. The frontend doesn't currently invoke this
// endpoint, so locking it down has no breakage risk.

import {
  AC_BASE,
  CORS,
  acHeaders,
  credsFromProfile,
  getAcBearerToken,
} from "../_shared/ascolour.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { loadProfileWithSecrets } from "../_shared/profileSecrets.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json().catch(() => ({}));
    const { styleCode, refreshAuth = false, accessToken } = body;

    const authHeader = req.headers.get("Authorization")?.replace("Bearer ", "") || accessToken;
    if (!authHeader) {
      return Response.json({ error: "Unauthorized" }, { status: 401, headers: CORS });
    }
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${authHeader}` } },
    });
    const { data: { user } } = await supabase.auth.getUser(authHeader);
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401, headers: CORS });
    }
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const profile = await loadProfileWithSecrets(admin, { auth_id: user.id });
    const creds = credsFromProfile(profile);
    if (!creds) {
      return Response.json({ error: "AS Colour credentials not configured" }, { status: 500, headers: CORS });
    }

    const token = await getAcBearerToken(creds, refreshAuth);
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
      headers: { ...acHeaders(creds, { Authorization: `Bearer ${token}` }) },
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
