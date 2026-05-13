// AS Colour inventory query — Supabase Edge Function
//
// Body: { sku?: string, skuFilter?: string, pageNumber?: number, pageSize?: number }
//   - sku: exact SKU lookup → /v1/inventory/items/{sku}
//   - skuFilter: wildcard → /v1/inventory/items?skuFilter=...
//   - neither: paginated full list
//
// Returns: { items: NormalisedInventoryItem[], pageNumber, pageSize, total? }
//
// Auth required: this endpoint can otherwise be used by anyone with the
// public URL to drain the shop's AS Colour quota and pull wholesale
// inventory data. The frontend doesn't currently call it; locking it down
// preserves future callers and removes a defense-in-depth gap.

import {
  AC_BASE,
  CORS,
  acFetch,
  credsFromProfile,
  normalizeInventoryItem,
} from "../_shared/ascolour.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { loadProfileWithSecrets } from "../_shared/profileSecrets.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json().catch(() => ({}));
    const { sku, skuFilter, pageNumber = 1, pageSize = 250, accessToken } = body;

    // Require an authenticated user. Per-shop credentials are preferred;
    // env credentials are a fallback only when the shop hasn't configured
    // their own AS Colour account yet. Anonymous callers are refused.
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

    const { ok, status, data } = await acFetch(creds, url, {}, "acGetInventory");
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
