// AS Colour place-order — Supabase Edge Function
//
// POST /v1/orders against the AS Colour API. Spec from the "AS Colour US -
// Order API Overview" PDF (api@ascolour.com).
//
// Body (sent by frontend):
//   {
//     reference: string,                   // shop's PO number
//     shippingMethod: string,              // from /orders/shippingmethods
//     orderNotes?: string,                 // visible to AS Colour staff
//     courierInstructions?: string,        // for the carrier driver
//     shippingAddress: {
//       company, firstName, lastName, address1, address2,
//       city, state, zip, countryCode, email, phone
//     },
//     items: [{ sku, warehouse, quantity }],
//     accessToken?: string,                // optional, also accepted via Authorization header
//   }
//
// Auth required. Uses the caller's per-shop AS Colour subscription key +
// account email/password (stored on profiles via profileSecrets) to mint
// a Bearer token, then POSTs the order. Anonymous callers are refused —
// orders place real-money commitments against a real AS Colour account.

import {
  AC_BASE,
  CORS,
  acHeaders,
  credsFromProfile,
  getAcBearerToken,
} from "../_shared/ascolour.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { loadProfileWithSecrets } from "../_shared/profileSecrets.ts";
import { requireActiveSubscription } from "../_shared/subscriptionGuard.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    // ── Auth required ────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const { accessToken: bodyToken } = body;
    const headerToken = req.headers.get("Authorization")?.replace("Bearer ", "") || "";
    const token = bodyToken || headerToken;
    if (!token) {
      return Response.json({ error: "Unauthorized" }, { status: 401, headers: CORS });
    }
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user } } = await userClient.auth.getUser(token);
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401, headers: CORS });
    }
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const profile = await loadProfileWithSecrets(admin, { auth_id: user.id });

    // Subscription gate — order placement costs real money downstream.
    const blocked = requireActiveSubscription(profile);
    if (blocked) return blocked;

    // Per-shop AS Colour credentials, with env fallback (matches the
    // pattern used by acLookupStyle / acSearchCatalog). credsFromProfile
    // returns null if neither per-shop nor env subscription key is set.
    const creds = credsFromProfile(profile);
    if (!creds) {
      return Response.json(
        { error: "AS Colour credentials not configured for this shop. Add the subscription key in Account → Supplier API Keys." },
        { status: 500, headers: CORS },
      );
    }

    // ── Validate the order payload ──────────────────────────────────
    const { reference, shippingMethod, orderNotes, courierInstructions, shippingAddress, items } = body;
    if (!reference) {
      return Response.json({ error: "reference (PO number) required" }, { status: 400, headers: CORS });
    }
    if (!shippingMethod) {
      return Response.json({ error: "shippingMethod required (call /orders/shippingmethods to list)" }, { status: 400, headers: CORS });
    }
    if (!shippingAddress?.address1 || !shippingAddress?.city || !shippingAddress?.zip || !shippingAddress?.countryCode) {
      return Response.json({ error: "shippingAddress is missing required fields (address1, city, zip, countryCode)" }, { status: 400, headers: CORS });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return Response.json({ error: "At least one order item required" }, { status: 400, headers: CORS });
    }
    for (const it of items) {
      if (!it.sku || !it.quantity) {
        return Response.json({ error: "Every item needs a sku and quantity" }, { status: 400, headers: CORS });
      }
    }

    // ── Mint a Bearer token (cached per-creds) ──────────────────────
    const bearer = await getAcBearerToken(creds);
    if (!bearer) {
      return Response.json(
        { error: "AS Colour authentication failed. Verify the account email/password works on the AS Colour website." },
        { status: 401, headers: CORS },
      );
    }

    // ── POST the order ──────────────────────────────────────────────
    const orderPayload = {
      reference,
      shippingMethod,
      orderNotes: orderNotes ?? "",
      courierInstructions: courierInstructions ?? "",
      shippingAddress,
      items: items.map((it: any) => ({
        sku: String(it.sku),
        warehouse: String(it.warehouse ?? ""),
        quantity: Number(it.quantity),
      })),
    };

    console.error("[acPlaceOrder] POST /v1/orders payload:", JSON.stringify(orderPayload));

    const res = await fetch(`${AC_BASE}/orders`, {
      method: "POST",
      headers: {
        ...acHeaders(creds, { Authorization: `Bearer ${bearer}` }),
        Accept: "application/json",
      },
      body: JSON.stringify(orderPayload),
      signal: AbortSignal.timeout(30_000),
    });

    const text = await res.text();
    let data: any;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }

    if (!res.ok) {
      console.error(`[acPlaceOrder] ${res.status} ${text.slice(0, 400)}`);
      return Response.json(
        { error: `AS Colour order failed (${res.status})`, details: data },
        { status: res.status || 502, headers: CORS },
      );
    }

    return Response.json({ success: true, order: data }, { headers: CORS });
  } catch (err) {
    console.error("acPlaceOrder error:", err);
    return Response.json({ error: (err as Error).message }, { status: 500, headers: CORS });
  }
});
