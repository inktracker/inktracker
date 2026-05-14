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
  getAcBearerToken,
} from "../_shared/ascolour.ts";
import {
  canPlaceOrder,
  credsForOrderPlacement,
  validateOrderPayload,
  buildOrderRequestBody,
} from "../_shared/acOrderLogic.js";
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

    // Role gate — defense in depth on top of credsForOrderPlacement.
    // Even if an employee/broker/user somehow has AC creds on their
    // profile, ordering blanks isn't their job. Pinned by tests.
    if (!canPlaceOrder(profile)) {
      return Response.json(
        { error: "Your account role can't place supplier orders. Ask your shop owner or manager." },
        { status: 403, headers: CORS },
      );
    }

    // Subscription gate — order placement costs real money downstream.
    const blocked = requireActiveSubscription(profile);
    if (blocked) return blocked;

    // STRICT per-shop credentials only — NO env fallback. The platform's
    // env credentials are intentionally usable for catalog browsing
    // (acLookupStyle / acSearchCatalog) so shops without their own keys
    // can still let customers see garments. But order placement charges
    // money to whatever AS Colour account is on the request, so allowing
    // env fallback here would let any authenticated user trigger orders
    // against the platform's account. Pinned by acOrderLogic.test.js.
    const creds = credsForOrderPlacement(profile);
    if (!creds) {
      return Response.json(
        { error: "AS Colour ordering requires your own AS Colour account credentials (subscription key + email + password). Configure them in Account → Supplier API Keys before placing orders." },
        { status: 400, headers: CORS },
      );
    }

    // ── Validate the order payload ──────────────────────────────────
    const validationErrors = validateOrderPayload(body);
    if (validationErrors.length > 0) {
      return Response.json(
        { error: "Invalid order payload", details: validationErrors },
        { status: 400, headers: CORS },
      );
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
    const orderPayload = buildOrderRequestBody(body);
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
