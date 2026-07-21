// SanMar single-style lookup — Supabase Edge Function
//
// Body: { styleNumber: string, color?: string, debug?: boolean,
//         accessToken?: string, shopOwner?: string }
// Returns { matches: [matchUiShape] } in the same shape as ssLookupStyle /
// acLookupStyle so the front-end can swap suppliers with minimal branching.
//
// Two SOAP calls in parallel (see _shared/sanmar.ts):
//   getProductInfoByStyleColorSize — style data, per-color images, catalog price
//   getPricing                     — myPrice, the shop's contracted cost
// The pricing call is best-effort: if it fails (e.g. platform env creds with
// no contract pricing), we fall back to the catalog piecePrice rather than
// failing the whole lookup.
//
// SanMar has NO keyword-search endpoint — exact style numbers only (PC61,
// K420, DT6000...). Live inventory is a later phase (Product Inventory
// Service); colors[].sizeQuantities ships empty.

import {
  CORS,
  buildMatchFromEntries,
  buildPricingEnvelope,
  buildProductInfoEnvelope,
  credsFromProfile,
  parsePricingResponse,
  parseInventoryResponse,
  buildInventoryEnvelope,
  parseProductInfoResponse,
  smBase,
  smSoapCall,
  type SmCreds,
} from "../_shared/sanmar.ts";
import { createClient } from "npm:@supabase/supabase-js@2.102.1";
import { loadProfileWithSecrets, loadShopProfileForUser } from "../_shared/profileSecrets.ts";
import { buildSupplierCacheKey, readSupplierCache, writeSupplierCache } from "../_shared/supplierCache.ts";

// Same three-path resolution as resolveAcCredentials in acLookupStyle:
//   1. shopOwner email   — anonymous public wizard (service-role lookup)
//   2. authenticated user — in-app calls (broker → assigned shop)
//   3. platform env       — last-ditch fallback
async function resolveSmCredentials(accessToken?: string, shopOwner?: string): Promise<SmCreds | null> {
  if (shopOwner && typeof shopOwner === "string") {
    try {
      const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const profile = await loadProfileWithSecrets(admin, { email: shopOwner });
      const perShop = credsFromProfile(profile);
      if (perShop) return perShop;
    } catch (err) {
      console.error("[smLookupStyle] shopOwner lookup failed:", (err as Error).message);
    }
  }
  if (accessToken) {
    try {
      const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
      });
      const { data: { user } } = await supabase.auth.getUser(accessToken);
      if (user) {
        const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        const { profile } = await loadShopProfileForUser(admin, user.id);
        const perShop = credsFromProfile(profile);
        if (perShop) return perShop;
      }
    } catch (err) {
      console.error("[smLookupStyle] per-shop auth failed, falling back to env:", (err as Error).message);
    }
  }
  return credsFromProfile(null);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json().catch(() => ({}));
    const { styleNumber, color = "", debug = false, accessToken, shopOwner } = body;

    const authHeader = req.headers.get("Authorization")?.replace("Bearer ", "") || "";
    const hasShopOwner = typeof shopOwner === "string" && shopOwner.trim().length > 0;

    // Same rate-limit posture as acLookupStyle: the anonymous public-wizard
    // path gets a server-derived per-IP cap (client-supplied shopOwner can be
    // rotated, so it can't be the only key) plus the per-shop hourly limiter.
    if (hasShopOwner && !authHeader) {
      const rateAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
      const { data: ipUnder } = await rateAdmin.rpc("check_request_rate", {
        p_key: `sm_lookup:${ip}`, p_limit_per_hr: 100,
      });
      if (ipUnder === false) {
        return Response.json(
          { error: "Too many requests — please try again shortly." },
          { status: 429, headers: CORS },
        );
      }
      const { data: allowed, error: rateErr } = await rateAdmin.rpc(
        "check_supplier_lookup_rate",
        { p_shop_owner: shopOwner },
      );
      if (rateErr) {
        console.warn("[smLookupStyle] rate check failed:", rateErr.message);
      } else if (allowed === false) {
        return Response.json(
          { error: "Too many requests — please try again shortly." },
          { status: 429, headers: CORS },
        );
      }
    }

    if (!styleNumber || !String(styleNumber).trim()) {
      return Response.json({ error: "styleNumber required" }, { status: 400, headers: CORS });
    }
    const style = String(styleNumber).trim();

    // Read-through cache on the anonymous public-wizard path only (pricing is
    // per-shop, so the key is shopOwner-scoped). Fail-open.
    const cacheable = hasShopOwner && !debug;
    let cacheAdmin: ReturnType<typeof createClient> | null = null;
    const cacheKey = cacheable ? buildSupplierCacheKey({ code: style, color }) : "";
    if (cacheable) {
      cacheAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const cached = await readSupplierCache(cacheAdmin, { supplier: "sm", shopOwner, cacheKey });
      if (cached) {
        console.error(`[smLookupStyle] cache HIT for "${style}" (shop ${shopOwner})`);
        return Response.json(cached, { headers: CORS });
      }
    }

    const creds = await resolveSmCredentials(accessToken || authHeader, shopOwner);
    if (!creds) {
      return Response.json({ error: "SanMar credentials not configured" }, { status: 500, headers: CORS });
    }

    const logs: object[] = [];
    const base = smBase();
    const [infoRes, priceRes, invRes] = await Promise.all([
      smSoapCall(`${base}/SanMarProductInfoServicePort`, buildProductInfoEnvelope(creds, style, color), "smLookupStyle:info"),
      smSoapCall(`${base}/SanMarPricingServicePort`, buildPricingEnvelope(creds, style, color), "smLookupStyle:pricing"),
      // Inventory rides the same round-trip. Note: the inventory service
      // filters by CATALOG color, so we deliberately pass no color filter
      // and let the by-style response cover everything.
      smSoapCall(`${base}/SanMarWebServicePort`, buildInventoryEnvelope(creds, style), "smLookupStyle:inventory"),
    ]);
    logs.push(
      { call: "productInfo", status: infoRes.status, ok: infoRes.ok, error: infoRes.error },
      { call: "pricing", status: priceRes.status, ok: priceRes.ok, error: priceRes.error },
      { call: "inventory", status: invRes.status, ok: invRes.ok, error: invRes.error },
    );

    if (!infoRes.ok) {
      // "Invalid Style + Color + Size specified." = style not found.
      const notFound = /invalid style/i.test(infoRes.error || "");
      return Response.json(
        { error: notFound ? "Style not found" : `SanMar product lookup failed: ${infoRes.error}` },
        { status: notFound ? 404 : 502, headers: CORS },
      );
    }

    const entries = parseProductInfoResponse(infoRes.xml);
    if (entries.length === 0) {
      return Response.json({ error: "Style not found" }, { status: 404, headers: CORS });
    }
    // Pricing is best-effort — a failure falls back to catalog prices.
    const pricing = priceRes.ok ? parsePricingResponse(priceRes.xml) : [];
    // Inventory is best-effort too — a failure just means empty quantities.
    const inventory = invRes.ok ? parseInventoryResponse(invRes.xml) : [];
    logs.push({ call: "parsed", entries: entries.length, pricingRows: pricing.length, inventoryRows: inventory.length });

    const match = buildMatchFromEntries(entries, pricing, inventory);
    if (!match) {
      return Response.json({ error: "Style not found" }, { status: 404, headers: CORS });
    }

    const response: any = { matches: [match] };
    if (debug) response._debug = logs;

    if (cacheable && cacheAdmin) {
      await writeSupplierCache(cacheAdmin, { supplier: "sm", shopOwner, cacheKey }, { matches: [match] });
    }

    return Response.json(response, { headers: CORS });
  } catch (err) {
    console.error("smLookupStyle top-level error:", err);
    return Response.json(
      { error: (err as Error).message },
      { status: 500, headers: CORS },
    );
  }
});
