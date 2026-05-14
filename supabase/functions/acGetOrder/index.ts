// AS Colour order lookup — Supabase Edge Function.
//
// GET /v1/orders/{id} against the AS Colour API to confirm a previously-
// placed order exists and read back its current state (Pending /
// Awaiting Fulfilment / Shipped / etc.). Also supports listing all
// orders for the shop's account when no id is supplied — useful for
// "did the order actually land?" verification.
//
// Auth: STRICT per-shop credentials, same rule as acPlaceOrder. We're
// querying real-money order data; env fallback would let a caller read
// any platform-account order history. No env fallback here.

import {
  AC_BASE,
  CORS,
  acFetch,
  getAcBearerToken,
} from "../_shared/ascolour.ts";
import { credsForOrderPlacement } from "../_shared/acOrderLogic.js";
import { createClient } from "npm:@supabase/supabase-js@2";
import { loadProfileWithSecrets } from "../_shared/profileSecrets.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json().catch(() => ({}));
    const { id, accessToken: bodyToken } = body;
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

    // STRICT per-shop creds. No env fallback — see acPlaceOrder for why.
    const creds = credsForOrderPlacement(profile);
    if (!creds) {
      return Response.json(
        { error: "AS Colour API requires your own credentials (subscription key + email + password). Configure them in Account → Supplier API Keys." },
        { status: 400, headers: CORS },
      );
    }

    const bearer = await getAcBearerToken(creds);
    if (!bearer) {
      return Response.json(
        { error: "AS Colour authentication failed. Verify the account email/password works on the AS Colour website." },
        { status: 401, headers: CORS },
      );
    }

    const url = id
      ? `${AC_BASE}/orders/${encodeURIComponent(String(id))}`
      : `${AC_BASE}/orders`;
    const res = await acFetch(
      creds,
      url,
      { headers: { Authorization: `Bearer ${bearer}` } },
      `acGetOrder:${id || "list"}`,
    );

    if (!res.ok) {
      return Response.json(
        { error: `AS Colour order lookup failed (${res.status})`, details: res.data },
        { status: res.status || 502, headers: CORS },
      );
    }

    // Echo the account email back so the caller can confirm WHICH AS
    // Colour account the order actually lives under. Useful when you
    // submitted with one credentials set but expected the order to
    // show up in a different account's portal.
    return Response.json(
      { order: res.data, accountEmail: creds.email },
      { headers: CORS },
    );
  } catch (err) {
    console.error("acGetOrder error:", err);
    return Response.json({ error: (err as Error).message }, { status: 500, headers: CORS });
  }
});
