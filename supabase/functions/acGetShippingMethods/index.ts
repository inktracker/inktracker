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

// AS Colour's response shape varies a bit between regions; normalise to a
// flat array of method-name strings the UI can drop into a <select>.
function extractMethodNames(data: any): string[] {
  if (!data) return [];
  if (Array.isArray(data)) {
    return data
      .map((m) => (typeof m === "string" ? m : m?.name || m?.method || m?.code || ""))
      .filter(Boolean);
  }
  if (Array.isArray(data.shippingMethods)) return extractMethodNames(data.shippingMethods);
  if (Array.isArray(data.methods)) return extractMethodNames(data.methods);
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

    const methods = extractMethodNames(res.data);
    return Response.json({ methods, raw: res.data }, { headers: CORS });
  } catch (err) {
    console.error("acGetShippingMethods error:", err);
    return Response.json({ error: (err as Error).message }, { status: 500, headers: CORS });
  }
});
