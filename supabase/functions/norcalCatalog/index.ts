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
import { normalizeNorcalProducts, norcalSubcategories, NORCAL_STORE_URL_DEFAULT } from "../_shared/norcal.ts";
import { readSupplierCache, writeSupplierCache, buildSupplierCacheKey } from "../_shared/supplierCache.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PAGE_SIZE = 250;

// Public-Shopify supply vendors we can browse + build carts for. Keep keys in
// sync with src/lib/suppliers.js on the frontend. Each is a public Shopify store
// (public /products.json + working cart permalinks) — one code path serves all.
const SUPPLIER_STORES: Record<string, string> = {
  norcal: Deno.env.get("NORCAL_STORE_URL") || NORCAL_STORE_URL_DEFAULT,
  ryonet: Deno.env.get("RYONET_STORE_URL") || "https://www.screenprinting.com",
};

// The catalog is PUBLIC and identical for every shop, so it's cached under one
// global key PER SUPPLIER (not per-shop). Bump CACHE_VERSION whenever the
// normalized shape or category mapping changes so a fresh normalize runs.
const CACHE_VERSION = 4;
function cacheRefFor(supplierKey: string) {
  return {
    supplier: `catalog:${supplierKey}`,
    shopOwner: "__global__",
    cacheKey: buildSupplierCacheKey({ catalog: supplierKey, v: CACHE_VERSION }),
  };
}

// deno-lint-ignore no-explicit-any
async function fetchWholeCatalog(storeUrl: string): Promise<any[]> {
  // deno-lint-ignore no-explicit-any
  const all: any[] = [];
  for (let pg = 1; pg <= 6; pg++) {
    const res = await fetch(`${storeUrl}/products.json?limit=${PAGE_SIZE}&page=${pg}`, {
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
    const { query = "", category = "", subcategory = "", limit = 24, page = 1 } = body ?? {};

    // Which vendor's catalog. Defaults to norcal for back-compat with the
    // original single-supplier callers.
    const supplierKey = String(body?.supplier || "norcal").toLowerCase();
    const storeUrl = (SUPPLIER_STORES[supplierKey] || SUPPLIER_STORES.norcal).replace(/\/+$/, "");
    const cacheRef = cacheRefFor(supplierKey);

    // Normalized full catalog, cached ~1h globally per supplier (public data).
    // Fail-open: any cache miss/error falls through to a live fetch.
    let normalized = await readSupplierCache(admin, cacheRef);
    if (!Array.isArray(normalized)) {
      const raw = await fetchWholeCatalog(storeUrl);
      normalized = normalizeNorcalProducts(raw, storeUrl);
      await writeSupplierCache(admin, cacheRef, normalized);
    }

    const q = String(query).trim().toLowerCase();
    const cat = String(category).trim().toLowerCase();
    const sub = String(subcategory).trim().toLowerCase();

    // Everything in the selected top-level bucket ("Inks", "Screens", …).
    // "all" / empty = no category filter. Subcategory tabs are derived from
    // THIS set (the whole bucket) so they're complete regardless of paging.
    // deno-lint-ignore no-explicit-any
    const inBucket = (normalized as any[]).filter(
      (p) => !cat || cat === "all" || String(p.category).toLowerCase() === cat,
    );
    const subcategories = norcalSubcategories(inBucket);

    const filtered = inBucket.filter((p) => {
      if (q) {
        const hay = `${p.title} ${p.sku} ${p.size} ${p.vendor} ${p.productType}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      // Exact product_type match for the sub-tab ("Plastisol Inks", …).
      if (sub && sub !== "all" && String(p.productType).toLowerCase() !== sub) return false;
      return true;
    });

    const lim = Math.max(1, Math.min(Number(limit) || 24, 100));
    const pg = Math.max(1, Number(page) || 1);
    const start = (pg - 1) * lim;
    const products = filtered.slice(start, start + lim);

    return Response.json(
      { products, total: filtered.length, page: pg, limit: lim, subcategories },
      { headers: CORS },
    );
  } catch (err) {
    console.error("norcalCatalog error:", err);
    return Response.json({ error: (err as Error).message }, { status: 500, headers: CORS });
  }
});
