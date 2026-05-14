// AS Colour shipping methods lookup — Supabase Edge Function.
//
// GET /v1/orders/shippingmethods against the AS Colour API, returns the
// list of valid shippingMethod strings shops can submit on an order.
//
// Auth: per-shop creds preferred (so the shop sees their account's
// available methods); falls back to platform env creds so a shop without
// their own AS Colour account can still browse / preview. Same fallback
// pattern as the catalog endpoints — order PLACEMENT (acPlaceOrder)
// stays strict per-shop only.

import {
  AC_BASE,
  CORS,
  acFetch,
  credsFromProfile,
  type AcCreds,
} from "../_shared/ascolour.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { loadProfileWithSecrets } from "../_shared/profileSecrets.ts";

async function resolveCreds(accessToken?: string): Promise<AcCreds | null> {
  if (accessToken) {
    try {
      const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
      });
      const { data: { user } } = await supabase.auth.getUser(accessToken);
      if (user) {
        const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        const profile = await loadProfileWithSecrets(admin, { auth_id: user.id });
        const perShop = credsFromProfile(profile);
        if (perShop) return perShop;
      }
    } catch (err) {
      console.error("[acGetShippingMethods] per-shop auth failed, falling back to env:", (err as Error).message);
    }
  }
  return credsFromProfile(null);
}

// AS Colour US returns {data: [{shippingMethod, description}, ...]}.
// Older regions returned a flat string array or shippingMethods/methods
// arrays — keep those code paths for safety. Normalise to a flat list
// of {name, description} so the UI can show both the dropdown value and
// a helpful explanation.
function extractMethods(data: any): { name: string; description: string }[] {
  if (!data) return [];
  if (Array.isArray(data)) {
    return data
      .map((m) => {
        if (typeof m === "string") return { name: m, description: "" };
        const name = m?.shippingMethod || m?.name || m?.method || m?.code || "";
        const description = m?.description || "";
        return name ? { name, description } : null;
      })
      .filter(Boolean) as { name: string; description: string }[];
  }
  if (Array.isArray(data.data)) return extractMethods(data.data);
  if (Array.isArray(data.shippingMethods)) return extractMethods(data.shippingMethods);
  if (Array.isArray(data.methods)) return extractMethods(data.methods);
  return [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json().catch(() => ({}));
    const { accessToken } = body;
    const authHeader = req.headers.get("Authorization")?.replace("Bearer ", "") || "";

    const creds = await resolveCreds(accessToken || authHeader);
    if (!creds) {
      return Response.json({ error: "AS Colour credentials not configured" }, { status: 500, headers: CORS });
    }

    const res = await acFetch(
      creds,
      `${AC_BASE}/orders/shippingmethods`,
      {},
      "acGetShippingMethods",
    );

    if (!res.ok) {
      return Response.json(
        { error: `AS Colour shipping methods lookup failed (${res.status})`, details: res.data },
        { status: res.status || 502, headers: CORS },
      );
    }

    const parsed = extractMethods(res.data);
    // Keep `methods` as a string array (backwards compatible with the
    // current getShippingMethods wrapper) AND add `methodDetails` with
    // descriptions for richer UI rendering later.
    const methods = parsed.map((m) => m.name);
    return Response.json({ methods, methodDetails: parsed }, { headers: CORS });
  } catch (err) {
    console.error("acGetShippingMethods error:", err);
    return Response.json({ error: (err as Error).message }, { status: 500, headers: CORS });
  }
});
