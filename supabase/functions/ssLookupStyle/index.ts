// S&S Activewear style lookup — Supabase Edge Function
// Docs: https://api.ssactivewear.com/V2/Products.aspx
//       https://api.ssactivewear.com/V2/Styles.aspx
// Auth: HTTP Basic, username = account number, password = API key

import { createClient } from "npm:@supabase/supabase-js@2";
import { loadProfileWithSecrets } from "../_shared/profileSecrets.ts";

const SS_BASE = "https://api.ssactivewear.com/v2";
const GLOBAL_SS_ACCOUNT = Deno.env.get("SS_ACCOUNT_NUMBER")!;
const GLOBAL_SS_KEY = Deno.env.get("SS_API_KEY")!;
const FETCH_TIMEOUT_MS = 20_000;

const CORS = {
  "Access-Control-Allow-Origin": "https://www.inktracker.app",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Resolve per-shop or global S&S credentials
async function resolveSSAuth(accessToken?: string): Promise<string> {
  if (accessToken) {
    try {
      const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
      });
      const { data: { user } } = await supabase.auth.getUser(accessToken);
      if (user) {
        const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        const profile = await loadProfileWithSecrets(admin, { auth_id: user.id });
        if (profile?.ss_account && profile?.ss_api_key) {
          return btoa(`${profile.ss_account}:${profile.ss_api_key}`);
        }
      }
    } catch (err) {
      console.error("[ssLookupStyle] per-shop auth failed, using global:", err.message);
    }
  }
  return btoa(`${GLOBAL_SS_ACCOUNT}:${GLOBAL_SS_KEY}`);
}

let currentAuth = btoa(`${GLOBAL_SS_ACCOUNT}:${GLOBAL_SS_KEY}`);

function ssHeaders() {
  return { Authorization: `Basic ${currentAuth}`, Accept: "application/json" };
}

async function ssFetch(url: string): Promise<{ ok: boolean; status: number; data: any }> {
  let status = 0;
  try {
    const res = await fetch(url, {
      headers: ssHeaders(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    status = res.status;
    const text = await res.text();
    console.error(`[ssLookupStyle] ${url} → ${status} (${text.length} chars)`);

    let data: any;
    try { data = JSON.parse(text); } catch { data = text; }

    if (!res.ok) {
      console.error(`[ssLookupStyle] error body: ${text.slice(0, 300)}`);
      return { ok: false, status, data };
    }
    return { ok: true, status, data };
  } catch (err) {
    console.error(`[ssLookupStyle] fetch exception (${url}): ${err.message}`);
    return { ok: false, status, data: { error: err.message } };
  }
}

/**
 * S&S products endpoint returns ONE FLAT ROW PER SKU (style × color × size).
 * Group rows by brandName first, then by colorName within each brand.
 * Returns one product object per brand so the UI can show a brand picker.
 */
function groupRowsByBrand(rows: any[]): any[] {
  if (!rows.length) return [];

  const first = rows[0];
  console.error(`[ssLookupStyle] first row keys: ${Object.keys(first).join(", ")}`);
  console.error(`[ssLookupStyle] first row values: ${JSON.stringify(first).slice(0, 400)}`);

  // Group flat rows by brandName
  const brandMap: Record<string, any[]> = {};
  for (const row of rows) {
    const brand = String(row.brandName ?? row.brand ?? "Unknown").trim();
    if (!brandMap[brand]) brandMap[brand] = [];
    brandMap[brand].push(row);
  }

  const products: any[] = [];

  for (const [brandName, brandRows] of Object.entries(brandMap)) {
    const firstRow = brandRows[0];
    // _styleName is the user-facing style number (e.g. "1717") from the styles endpoint
    // _styleTitle is the human-readable product name (e.g. "Unisex Garment-Dyed Heavyweight T-Shirt")
    const partNumber = String(firstRow._styleName ?? firstRow.styleName ?? firstRow.partNumber ?? "").toUpperCase();
    const styleDesc  = firstRow._styleTitle || "";
    const styleID    = String(firstRow.styleID ?? "");
    const title      = styleDesc || [brandName, partNumber].filter(Boolean).join(" — ");
    const styleCategory = firstRow._styleCategory || "";

    const colorMap: Record<string, {
      colorName: string; colorCode: string; sku: string;
      piecePrice: number; casePrice: number;
      imageUrl: string; sizeQuantities: Record<string, number>;
    }> = {};

    for (const row of brandRows) {
      const colorName = row.colorName ?? row.color ?? "";
      if (!colorName) continue;

      if (!colorMap[colorName]) {
        const frontRaw = row.colorFrontImage ?? row.colorImage ?? "";
        const backRaw = row.colorBackImage ?? row.colorSideImage ?? "";
        colorMap[colorName] = {
          colorName,
          colorCode: row.colorCode ?? "",
          sku: String(row.sku ?? "").replace(/-[^-]+$/, ""),
          piecePrice: Number(row.piecePrice ?? row.piece_price ?? 0),
          casePrice:  Number(row.casePrice  ?? row.case_price  ?? 0),
          imageUrl: frontRaw ? (frontRaw.startsWith("http") ? frontRaw : `https://www.ssactivewear.com/${frontRaw}`) : "",
          backImageUrl: backRaw ? (backRaw.startsWith("http") ? backRaw : `https://www.ssactivewear.com/${backRaw}`) : "",
          sizeQuantities: {},
        };
      }

      const sizeName = row.sizeName ?? row.size ?? "";
      if (sizeName) {
        colorMap[colorName].sizeQuantities[sizeName] = Number(row.qty ?? 0);
      }
    }

    const colors = Object.values(colorMap);

    const inventoryMap: Record<string, Record<string, number>> = {};
    const priceMap: Record<string, { piecePrice: number; casePrice: number }> = {};
    for (const c of colors) {
      inventoryMap[c.colorName] = c.sizeQuantities;
      priceMap[c.colorName]     = { piecePrice: c.piecePrice, casePrice: c.casePrice };
    }

    const prices     = colors.map((c) => c.piecePrice).filter(Boolean);
    const casePrices = colors.map((c) => c.casePrice).filter(Boolean);

    const styleImage = colors.find(c => c.imageUrl)?.imageUrl || "";

    // Build images array with front/back per color (matches AS Colour format)
    const images: any[] = [];
    for (const c of colors) {
      if (c.imageUrl) images.push({ colour: c.colorName.toUpperCase(), url: c.imageUrl, type: c.colorName.toUpperCase() });
      if (c.backImageUrl) images.push({ colour: c.colorName.toUpperCase() + " - BACK", url: c.backImageUrl, type: c.colorName.toUpperCase() + " - BACK" });
    }

    products.push({
      id:                  styleID || `${brandName}-${partNumber}`,
      styleNumber:         partNumber,
      resolvedStyleNumber: partNumber,
      productNumber:       styleID,
      brandName,
      styleName:           styleDesc || partNumber,
      resolvedTitle:       title,
      title,
      description:         styleDesc,
      categories:          styleCategory ? [styleCategory] : [],
      styleCategory,
      styleImage,
      colors,
      images,
      inventoryMap,
      priceMap,
      piecePrice: prices.length     ? Math.min(...prices)     : 0,
      casePrice:  casePrices.length ? Math.min(...casePrices) : 0,
    });
  }

  return products;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();
    const { styleNumber, action, color, debug = false, accessToken } = body;

    // Resolve per-shop or global S&S credentials
    // accessToken can come from the body or from the Authorization header
    const authHeader = req.headers.get("Authorization")?.replace("Bearer ", "") || "";
    currentAuth = await resolveSSAuth(accessToken || authHeader);

    // Raw SKU lookup: returns per-size SKUs for a style+color
    if (action === "rawSkus") {
      if (!styleNumber) return Response.json({ error: "styleNumber required" }, { status: 400, headers: CORS });
      const q = String(styleNumber).trim();
      // Find the styleID first
      const stylesUrl = `${SS_BASE}/styles?search=${encodeURIComponent(q)}`;
      const { ok: sOk, data: sData } = await ssFetch(stylesUrl);
      if (!sOk || !Array.isArray(sData) || !sData.length) {
        return Response.json({ error: "Style not found" }, { status: 404, headers: CORS });
      }
      const qUpper = q.toUpperCase();
      const style = sData.find((s: any) =>
        String(s.styleName ?? "").toUpperCase() === qUpper ||
        String(s.partNumber ?? "").toUpperCase() === qUpper
      ) || sData[0];
      // Fetch raw product rows
      const productsUrl = `${SS_BASE}/products?styleid=${style.styleID}`;
      const { ok: pOk, data: pData } = await ssFetch(productsUrl);
      if (!pOk || !Array.isArray(pData)) {
        return Response.json({ error: "Failed to fetch products" }, { status: 502, headers: CORS });
      }
      // Filter by color if specified, return size→sku map
      const targetColor = (color || "").toLowerCase();
      const skuMap: Record<string, { sku: string; price: number }> = {};
      for (const row of pData) {
        const cn = (row.colorName ?? row.color ?? "").toLowerCase();
        if (targetColor && cn !== targetColor) continue;
        const size = String(row.sizeName ?? row.size ?? "").toUpperCase();
        skuMap[size] = { sku: row.sku, price: row.piecePrice ?? row.piece_price ?? 0 };
      }
      return Response.json({ skus: skuMap, style: style.styleName, brand: style.brandName }, { headers: CORS });
    }

    if (!styleNumber) {
      return Response.json({ error: "styleNumber required" }, { status: 400, headers: CORS });
    }

    const query = String(styleNumber).trim();
    const queryUpper = query.toUpperCase();
    const logs: object[] = [];

    // Collect all raw product rows from every source, keyed by SKU to deduplicate
    const rowsBySku = new Map<string, any>();

    function mergeRows(newRows: any[]) {
      for (const row of newRows) {
        const key = String(row.sku ?? row.partNumber ?? Math.random());
        if (!rowsBySku.has(key)) rowsBySku.set(key, row);
      }
    }

    // ── Source 1: products?partnumber= ───────────────────────────────────────
    // Returns all SKUs whose manufacturer part number matches exactly.
    {
      const url = `${SS_BASE}/products?partnumber=${encodeURIComponent(query)}`;
      const { ok, status, data } = await ssFetch(url);
      logs.push({ strategy: "partnumber", url, status });
      if (ok && Array.isArray(data) && data.length > 0) {
        mergeRows(data);
        console.error(`[ssLookupStyle] partnumber: ${data.length} rows`);
      }
    }

    // ── Source 2: styles search → products for ALL matching styleIDs ──────────
    // S&S styles search returns every style whose partNumber or title contains the
    // query. Fetch products for each matching styleID so we capture every brand
    // that uses this style number (e.g. both Bayside 5000 and Gildan 5000).
    {
      const stylesUrl = `${SS_BASE}/styles?search=${encodeURIComponent(query)}`;
      const { ok, status, data } = await ssFetch(stylesUrl);
      logs.push({ strategy: "styles-search", url: stylesUrl, status });

      if (ok && Array.isArray(data) && data.length > 0) {
        console.error(`[ssLookupStyle] styles search: ${data.length} styles`);

        // Filter to styles whose partNumber OR styleName matches what was typed.
        // S&S uses partNumber = internal code (e.g. "00708") and styleName = user-facing
        // code (e.g. "1717"), so we must check both to find the right style.
        const matchingStyles = data.filter((s: any) =>
          String(s.partNumber ?? "").toUpperCase() === queryUpper ||
          String(s.styleName ?? "").toUpperCase() === queryUpper ||
          String(s.styleID ?? "") === query
        );
        // Fall back to all results if no exact match
        const stylesToFetch = matchingStyles.length > 0 ? matchingStyles : data.slice(0, 5);

        // Fetch products for each matching style in parallel
        const productFetches = stylesToFetch.map(async (style: any) => {
          const styleID = style.styleID;
          if (!styleID) return;
          const productsUrl = `${SS_BASE}/products?styleid=${styleID}`;
          const { ok: pOk, data: pData } = await ssFetch(productsUrl);
          if (pOk && Array.isArray(pData) && pData.length > 0) {
            // Tag each row with the human-readable title from the styles endpoint
            // (products endpoint only has styleName = style code, not the real title)
            const taggedRows = pData.map((row: any) => ({
              ...row,
              _styleTitle: style.title ?? "",
              _styleName: style.styleName ?? row.styleName ?? "",
              _styleCategory: style.styleCategory ?? style.category ?? "",
            }));
            mergeRows(taggedRows);
            console.error(`[ssLookupStyle] styleid ${styleID} (${style.brandName ?? "?"}): ${pData.length} rows`);
          }
        });

        await Promise.all(productFetches);
      }
    }

    // ── Source 3: products?style= fallback ───────────────────────────────────
    if (rowsBySku.size === 0) {
      const url = `${SS_BASE}/products?style=${encodeURIComponent(query)}`;
      const { ok, status, data } = await ssFetch(url);
      logs.push({ strategy: "style-param", url, status });
      if (ok && Array.isArray(data) && data.length > 0) {
        mergeRows(data);
        console.error(`[ssLookupStyle] style-param: ${data.length} rows`);
      }
    }

    const allRows = Array.from(rowsBySku.values());
    const matches = allRows.length > 0 ? groupRowsByBrand(allRows) : [];

    console.error(`[ssLookupStyle] final: ${matches.length} match(es) for "${query}"`);

    const response: any = { matches };
    if (debug) response._debug = logs;

    return Response.json(response, { headers: CORS });
  } catch (err) {
    console.error("ssLookupStyle top-level error:", err);
    return Response.json({ error: String(err.message ?? err) }, { status: 500, headers: CORS });
  }
});
