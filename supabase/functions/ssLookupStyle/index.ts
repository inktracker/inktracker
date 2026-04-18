// S&S Activewear style lookup — Supabase Edge Function
// Docs: https://api.ssactivewear.com/V2/Products.aspx
//       https://api.ssactivewear.com/V2/Styles.aspx
// Auth: HTTP Basic, username = account number, password = API key

const SS_BASE = "https://api.ssactivewear.com/v2";
const SS_ACCOUNT = Deno.env.get("SS_ACCOUNT_NUMBER") ?? "61047";
const SS_KEY = Deno.env.get("SS_API_KEY") ?? "e3fde568-dd4a-4b7a-9258-02e92fac3498";
const AUTH = btoa(`${SS_ACCOUNT}:${SS_KEY}`);
const FETCH_TIMEOUT_MS = 20_000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function ssHeaders() {
  return { Authorization: `Basic ${AUTH}`, Accept: "application/json" };
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
    const title      = [brandName, partNumber].filter(Boolean).join(" — ");
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
        colorMap[colorName] = {
          colorName,
          colorCode: row.colorCode ?? "",
          sku: String(row.sku ?? "").replace(/-[^-]+$/, ""),
          piecePrice: Number(row.piecePrice ?? row.piece_price ?? 0),
          casePrice:  Number(row.casePrice  ?? row.case_price  ?? 0),
          imageUrl:   (() => {
            const raw = row.colorFrontImage ?? row.colorImage ?? "";
            if (!raw) return "";
            return raw.startsWith("http") ? raw : `https://www.ssactivewear.com/${raw}`;
          })(),
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

    products.push({
      id:                  styleID || `${brandName}-${partNumber}`,
      styleNumber:         partNumber,
      resolvedStyleNumber: partNumber,
      productNumber:       styleID,
      brandName,
      styleName:           partNumber,
      resolvedTitle:       title,
      title,
      description:         styleDesc,
      categories:          styleCategory ? [styleCategory] : [],
      styleCategory,
      styleImage,
      colors,
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
    const { styleNumber, debug = false } = body;

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
