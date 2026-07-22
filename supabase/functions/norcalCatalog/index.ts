// NorCal catalog — Supabase Edge Function (NorCal integration — Slice 1).
//
// NorCal Screen Print Supply runs on Shopify (norcalsps.com) and exposes its
// full catalog publicly at /products.json. This function fetches + caches that
// catalog server-side (Shopify does NOT send CORS headers that would let the
// browser fetch it directly), normalizes each variant, and returns a filtered,
// paginated list so a shop can link one of its supplies to a NorCal variant.
//
// No credentials — the catalog is public. Rate-limited by client IP so it can't
// be turned into a scraping / cost-amplification vector. Anonymous-callable
// (verify_jwt = false in config.toml); the data it returns is public anyway.
//
// Body:    { query?, category?, limit?, page? }
// Returns: { products: NorcalVariant[], total, page, limit }

import { createClient } from "npm:@supabase/supabase-js@2.102.1";
import { normalizeNorcalProducts, NORCAL_STORE_URL_DEFAULT } from "../_shared/norcal.ts";
import { readSupplierCache, writeSupplierCache, buildSupplierCacheKey } from "../_shared/supplierCache.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STORE_URL = (Deno.env.get("NORCAL_STORE_URL") || NORCAL_STORE_URL_DEFAULT).replace(/\/+$/, "");
const PAGE_SIZE = 250;

// The catalog is PUBLIC and identical for every shop, so it's cached under one
// global key (not per-shop) — one upstream fetch per TTL window serves everyone.
const CACHE_REF = {
  supplier: "nc",
  shopOwner: "__norcal_global__",
  cacheKey: buildSupplierCacheKey({ catalog: "all" }),
};

// deno-lint-ignore no-explicit-any
async function fetchWholeCatalog(): Promise<any[]> {
  // deno-lint-ignore no-explicit-any
  const all: any[] = [];
  for (let pg = 1; pg <= 6; pg++) {
    const res = await fetch(`${STORE_URL}/products.json?limit=${PAGE_SIZE}&page=${pg}`, {
      headers: { "User-Agent": "InkTracker/1.0 (+https://inktracker.app)" },
    });
    if (!res.ok) {
      if (pg === 1) throw new Error(`NorCal catalog fetch failed: ${res.status}`);
      break; // partial catalog is better than none
    }
    const data = await res.json().catch(() => ({}));
    const items = Array.isArray(data?.products) ? data.products : [];
    all.push(...items);
    if (items.length < PAGE_SIZE) break; // last page
  }
  return all;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    // Rate-limit by client IP — a server-derived key, never client-supplied.
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: underLimit } = await admin.rpc("check_request_rate", {
      p_key: `nc_catalog:${ip}`,
      p_limit_per_hr: 120,
    });
    if (underLimit === false) {
      return Response.json(
        { error: "Too many catalog requests — please slow down and try again shortly." },
        { status: 429, headers: CORS },
      );
    }

    const body = await req.json().catch(() => ({}));
    const { query = "", category = "", limit = 24, page = 1 } = body ?? {};

    // Normalized full catalog, cached ~1h globally (public data). Fail-open:
    // any cache miss/error falls through to a live fetch.
    let normalized = await readSupplierCache(admin, CACHE_REF);
    if (!Array.isArray(normalized)) {
      const raw = await fetchWholeCatalog();
      normalized = normalizeNorcalProducts(raw, STORE_URL);
      await writeSupplierCache(admin, CACHE_REF, normalized);
    }

    const q = String(query).trim().toLowerCase();
    const cat = String(category).trim().toLowerCase();
    // deno-lint-ignore no-explicit-any
    const filtered = (normalized as any[]).filter((p) => {
      if (q) {
        const hay = `${p.title} ${p.sku} ${p.size} ${p.vendor}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      // Filter on the browsable category bucket ("Inks", "Screens", …).
      // "all" / empty = no category filter.
      if (cat && cat !== "all" && String(p.category).toLowerCase() !== cat) return false;
      return true;
    });

    const lim = Math.max(1, Math.min(Number(limit) || 24, 100));
    const pg = Math.max(1, Number(page) || 1);
    const start = (pg - 1) * lim;
    const products = filtered.slice(start, start + lim);

    return Response.json({ products, total: filtered.length, page: pg, limit: lim }, { headers: CORS });
  } catch (err) {
    console.error("norcalCatalog error:", err);
    return Response.json({ error: (err as Error).message }, { status: 500, headers: CORS });
  }
});
