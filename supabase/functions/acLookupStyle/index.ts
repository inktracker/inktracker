// AS Colour single-style lookup — Supabase Edge Function
//
// Body: { styleCode: string, includeInventory?: boolean, debug?: boolean }
// Returns a single normalised product with variants, images, and (optionally)
// per-colour/size inventory pulled from /v1/inventory/items?skuFilter=<style>.
//
// Mirrors the shape of ssLookupStyle so the front-end can swap suppliers with
// minimal branching.

import {
  AC_BASE,
  CORS,
  acFetch,
  credsFromProfile,
  getAcBearerToken,
  normalizeProduct,
  type AcCreds,
} from "../_shared/ascolour.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { loadProfileWithSecrets, loadShopProfileForUser } from "../_shared/profileSecrets.ts";
import { buildSupplierCacheKey, readSupplierCache, writeSupplierCache } from "../_shared/supplierCache.ts";

// Returns the AcCreds bundle to use for this request.
//
// Three paths, in priority order:
//   1. shopOwner email   — anonymous public wizard at <shop>.com/quote-wizard.
//                          Service role lookup by email; no user session.
//   2. authenticated user — in-app calls. Resolves broker → assigned shop too.
//   3. platform env       — last-ditch fallback.
async function resolveAcCredentials(accessToken?: string, shopOwner?: string): Promise<AcCreds | null> {
  // Path 1 — shopOwner email lookup.
  if (shopOwner && typeof shopOwner === "string") {
    try {
      const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const profile = await loadProfileWithSecrets(admin, { email: shopOwner });
      const perShop = credsFromProfile(profile);
      if (perShop) return perShop;
    } catch (err) {
      console.error("[acLookupStyle] shopOwner lookup failed:", (err as Error).message);
    }
  }
  // Path 2 — authenticated user.
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
      console.error("[acLookupStyle] per-shop auth failed, falling back to env:", (err as Error).message);
    }
  }
  // Path 3 — env defaults.
  return credsFromProfile(null);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json().catch(() => ({}));
    const { styleCode, includeInventory = true, debug = false, accessToken, shopOwner } = body;

    const authHeader = req.headers.get("Authorization")?.replace("Bearer ", "") || "";
    const hasShopOwner = typeof shopOwner === "string" && shopOwner.trim().length > 0;

    // Per-shop hourly rate limit on the anonymous (public-wizard) path.
    // Authenticated calls (the shop's own config editor + broker / quote
    // editors) hit this function via Authorization header and are
    // exempt — they already require a logged-in shop user.
    if (hasShopOwner && !authHeader) {
      const rateAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const { data: allowed, error: rateErr } = await rateAdmin.rpc(
        "check_supplier_lookup_rate",
        { p_shop_owner: shopOwner },
      );
      if (rateErr) {
        // Fail-open on RPC error — better to occasionally serve over-limit
        // than to take the public wizard offline if the rate table is
        // unreachable.
        console.warn("[acLookupStyle] rate check failed:", rateErr.message);
      } else if (allowed === false) {
        return Response.json(
          { error: "Too many requests — please try again shortly." },
          { status: 429, headers: CORS },
        );
      }
    }

    // ── Read-through cache (anonymous public-wizard path only) ──────────────
    // Only the wizard passes shopOwner; authenticated in-app calls don't, so
    // they always hit live AS Colour below. Pricing/inventory are per-shop, so
    // the cache key is scoped by shopOwner. Skip debug requests. Fail-open: a
    // miss or error just falls through to the live lookup.
    const cacheable =
      hasShopOwner && !debug &&
      typeof styleCode !== "undefined" && String(styleCode).trim().length > 0;
    let cacheAdmin: ReturnType<typeof createClient> | null = null;
    const cacheKey = cacheable
      ? buildSupplierCacheKey({ code: String(styleCode), inv: includeInventory ? "1" : "0" })
      : "";
    if (cacheable) {
      cacheAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const cached = await readSupplierCache(cacheAdmin, { supplier: "ac", shopOwner, cacheKey });
      if (cached) {
        console.error(`[acLookupStyle] cache HIT for "${styleCode}" (shop ${shopOwner})`);
        return Response.json(cached, { headers: CORS });
      }
    }

    const creds = await resolveAcCredentials(accessToken || authHeader, shopOwner);
    if (!creds) {
      return Response.json({ error: "AS Colour credentials not configured" }, { status: 500, headers: CORS });
    }

    if (!styleCode) {
      return Response.json(
        { error: "styleCode required" },
        { status: 400, headers: CORS },
      );
    }

    const code = String(styleCode).trim();
    const logs: object[] = [];

    // Fetch product and images in parallel. Variants may need pagination.
    const [productRes, imagesRes] = await Promise.all([
      acFetch(creds, `${AC_BASE}/catalog/products/${encodeURIComponent(code)}`, {}, "acLookupStyle:product"),
      acFetch(creds, `${AC_BASE}/catalog/products/${encodeURIComponent(code)}/images`, {}, "acLookupStyle:images"),
    ]);

    logs.push(
      { call: "product", status: productRes.status, ok: productRes.ok },
      { call: "images", status: imagesRes.status, ok: imagesRes.ok },
    );

    if (!productRes.ok) {
      return Response.json(
        { error: `AS Colour product lookup failed (${productRes.status})`, details: productRes.data },
        { status: productRes.status || 502, headers: CORS },
      );
    }

    const productJson = Array.isArray(productRes.data) ? productRes.data[0] : productRes.data;
    if (!productJson) {
      return Response.json({ error: "Style not found" }, { status: 404, headers: CORS });
    }

    // Paginate variants (AS Colour returns max 250 per page)
    const variantsArr: any[] = [];
    for (let pg = 1; pg <= 5; pg++) {
      const vRes = await acFetch(
        creds,
        `${AC_BASE}/catalog/products/${encodeURIComponent(code)}/variants?pageNumber=${pg}&pageSize=250`,
        {}, `acLookupStyle:variants:p${pg}`,
      );
      const items = Array.isArray(vRes.data?.data) ? vRes.data.data : Array.isArray(vRes.data) ? vRes.data : [];
      variantsArr.push(...items);
      if (items.length < 250) break;
    }
    logs.push({ call: "variants", count: variantsArr.length });

    const imagesArr = Array.isArray(imagesRes.data?.data)
      ? imagesRes.data.data
      : Array.isArray(imagesRes.data) ? imagesRes.data
      : [];

    const product = normalizeProduct({
      ...productJson,
      variants: variantsArr,
      images: imagesArr,
    });

    // Fetch live inventory (requires Bearer token, same as pricelist).
    let inventoryMap: Record<string, Record<string, number>> = {};
    try {
      const bearerToken2 = await getAcBearerToken(creds);
      if (bearerToken2) {
        const allInv: any[] = [];
        for (let pg = 1; pg <= 5; pg++) {
          const invRes = await acFetch(
            creds,
            `${AC_BASE}/inventory/items?skuFilter=${encodeURIComponent(code)}&pageNumber=${pg}&pageSize=250`,
            { headers: { Authorization: `Bearer ${bearerToken2}` } },
            `acLookupStyle:inv:p${pg}`,
          );
          const items = Array.isArray(invRes.data?.data) ? invRes.data.data : [];
          allInv.push(...items);
          logs.push({ call: `inv:p${pg}`, count: items.length });
          if (items.length < 250) break;
        }
        // Build colour → size → total qty map (sum across warehouses)
        for (const row of allInv) {
          // SKU format: "5001-ARC_B-G-S" — need to match colour from variant
          const variant = product.variants.find((v: any) => v.sku === row.sku);
          const colour = variant?.colour || "";
          const size = variant?.size || "";
          if (!colour) continue;
          if (!inventoryMap[colour]) inventoryMap[colour] = {};
          inventoryMap[colour][size] = (inventoryMap[colour][size] || 0) + (Number(row.quantity) || 0);
        }
        // Per-SKU per-warehouse stock map drives auto-routing on the
        // PO page (item ships from default warehouse if in stock there,
        // otherwise falls back to the other). Keyed by exact AS Colour
        // SKU so the frontend can look up "what's the right warehouse
        // for sku X assuming default Y?" without re-running inventory.
        const stockBySkuWarehouse: Record<string, Record<string, number>> = {};
        for (const row of allInv) {
          if (!row.sku) continue;
          const wh = String(row.warehouse ?? row.location ?? "").trim();
          if (!wh) continue;
          if (!stockBySkuWarehouse[row.sku]) stockBySkuWarehouse[row.sku] = {};
          stockBySkuWarehouse[row.sku][wh] =
            (stockBySkuWarehouse[row.sku][wh] || 0) + (Number(row.quantity) || 0);
        }
        (product as any).stockBySkuWarehouse = stockBySkuWarehouse;
        // Surface unique warehouse strings AS Colour uses for this style —
        // these are the canonical values the /v1/orders endpoint expects
        // on items[].warehouse. Without this the UI ends up guessing
        // (e.g. "Carson, CA" might or might not be the right format).
        const whSet = new Set<string>();
        for (const row of allInv) {
          const w = row.warehouse ?? row.location ?? "";
          if (w) whSet.add(String(w));
        }
        if (debug) logs.push({ call: "warehouses_unique", values: Array.from(whSet) });
        (product as any).warehouses = Array.from(whSet);
      }
    } catch (invErr) {
      console.error("[acLookupStyle] inventory fetch failed:", invErr);
    }

    // Fetch wholesale prices from the pricelist (requires Bearer token).
    // Build a SKU → price map, then group by colour for the UI priceMap.
    const skuPriceMap: Record<string, number> = {};
    try {
      const bearerToken = await getAcBearerToken(creds);
      if (bearerToken) {
        // Paginate pricelist filtered by styleCode
        for (let pg = 1; pg <= 5; pg++) {
          const priceRes = await acFetch(
            creds,
            `${AC_BASE}/catalog/pricelist?skuFilter=${encodeURIComponent(code)}&pageNumber=${pg}&pageSize=250`,
            { headers: { Authorization: `Bearer ${bearerToken}` } },
            `acLookupStyle:prices:p${pg}`,
          );
          const priceItems = Array.isArray(priceRes.data?.data) ? priceRes.data.data : [];
          for (const p of priceItems) {
            if (p.sku && p.price != null) skuPriceMap[p.sku] = Number(p.price);
          }
          logs.push({ call: `prices:p${pg}`, count: priceItems.length });
          if (priceItems.length < 250) break;
        }
      }
    } catch (priceErr) {
      console.error("[acLookupStyle] pricelist fetch failed:", priceErr);
    }

    // Assign prices to variants from pricelist, then build colour priceMap.
    for (const v of product.variants) {
      if (skuPriceMap[v.sku]) v.price = skuPriceMap[v.sku];
    }

    const priceMap: Record<string, { piecePrice: number; casePrice: number }> = {};
    for (const v of product.variants) {
      const cn = v.colour;
      if (!cn || !v.price) continue;
      if (!priceMap[cn]) priceMap[cn] = { piecePrice: v.price, casePrice: v.price };
      if (v.price < priceMap[cn].piecePrice) priceMap[cn].piecePrice = v.price;
    }

    const matchUiShape = {
      id: product.id,
      styleNumber: product.styleCode,
      resolvedStyleNumber: product.styleCode,
      productNumber: product.id,
      brandName: "AS Colour",
      styleName: product.styleCode,
      resolvedTitle: product.title,
      title: product.title,
      description: product.description,
      categories: product.category ? [product.category] : [],
      styleCategory: product.category,
      styleImage: product.primaryImage,
      colors: product.colours.map((c: any) => {
        // Match image by colour name (imageType field) — case-insensitive
        const colImg = product.images.find((i: any) =>
          i.colour && c.name && i.colour.toUpperCase() === c.name.toUpperCase()
        );
        // Also check variant imageUrl as fallback
        const varImg = product.variants.find((v: any) =>
          v.colour && c.name && v.colour.toUpperCase() === c.name.toUpperCase() && v.imageUrl
        );
        return {
          colorName: c.name,
          colorCode: c.code,
          sku: "",
          piecePrice: priceMap[c.name]?.piecePrice ?? 0,
          casePrice: priceMap[c.name]?.casePrice ?? 0,
          imageUrl: colImg?.url || varImg?.imageUrl || product.primaryImage,
          sizeQuantities: inventoryMap[c.name] ?? {},
        };
      }),
      variants: product.variants,
      images: product.images,
      inventoryMap,
      priceMap,
      piecePrice: Math.min(
        ...Object.values(priceMap).map((p) => p.piecePrice).filter(Boolean),
        Infinity,
      ),
    };

    const response: any = { matches: [matchUiShape], product };
    if (debug) response._debug = logs;

    // Cache only a clean successful result (we're past the 404 / error paths).
    if (cacheable && cacheAdmin) {
      await writeSupplierCache(
        cacheAdmin,
        { supplier: "ac", shopOwner, cacheKey },
        { matches: [matchUiShape], product },
      );
    }

    return Response.json(response, { headers: CORS });
  } catch (err) {
    console.error("acLookupStyle top-level error:", err);
    return Response.json(
      { error: (err as Error).message },
      { status: 500, headers: CORS },
    );
  }
});
