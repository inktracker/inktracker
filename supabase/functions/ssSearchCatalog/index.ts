// S&S Activewear catalog search — Supabase Edge Function

const SS_BASE = "https://api.ssactivewear.com/v2";
const SS_ACCOUNT = Deno.env.get("SS_ACCOUNT_NUMBER")!;
const SS_KEY = Deno.env.get("SS_API_KEY")!;
const AUTH = btoa(`${SS_ACCOUNT}:${SS_KEY}`);

const CORS = {
  "Access-Control-Allow-Origin": "https://www.inktracker.app",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function ssHeaders() {
  return { Authorization: `Basic ${AUTH}`, Accept: "application/json" };
}

function buildInventoryMap(colors: any[]) {
  const map: Record<string, Record<string, number>> = {};
  for (const c of colors) {
    const name = c.colorName ?? c.color ?? "";
    map[name] = c.sizeQuantities ?? c.inventory ?? c.sizes ?? {};
  }
  return map;
}

function buildPriceMap(colors: any[]) {
  const map: Record<string, { piecePrice: number; casePrice: number }> = {};
  for (const c of colors) {
    const name = c.colorName ?? c.color ?? "";
    map[name] = {
      piecePrice: Number(c.piecePrice ?? c.piece_price ?? 0),
      casePrice: Number(c.casePrice ?? c.case_price ?? 0),
    };
  }
  return map;
}

function normalizeProduct(p: any) {
  const colors = Array.isArray(p.colors) ? p.colors : [];
  const prices = colors.map((c: any) => Number(c.piecePrice ?? c.piece_price ?? 0)).filter(Boolean);
  return {
    id: String(p.styleID ?? p.id ?? ""),
    styleNumber: String(p.styleName ?? p.styleNumber ?? "").toUpperCase(),
    brandName: p.brandName ?? p.brand ?? "",
    title: p.title ?? p.productTitle ?? "",
    description: p.description ?? "",
    categories: p.categories ?? [],
    imageUrl: p.imageUrl ?? p.image ?? p.colorFrontImage ?? "",
    colorCount: colors.length,
    piecePrice: prices.length ? Math.min(...prices) : 0,
    maxPrice: prices.length ? Math.max(...prices) : 0,
    colors: colors.map((c: any) => ({
      colorName: c.colorName ?? c.color ?? "",
      colorCode: c.colorCode ?? "",
      sku: c.sku ?? "",
      piecePrice: Number(c.piecePrice ?? c.piece_price ?? 0),
      casePrice: Number(c.casePrice ?? c.case_price ?? 0),
      sizeQuantities: c.sizeQuantities ?? c.inventory ?? {},
      imageUrl: c.colorFrontImage ?? c.colorImage ?? c.imageUrl ?? "",
    })),
    inventoryMap: buildInventoryMap(colors),
    priceMap: buildPriceMap(colors),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { query, category, brand, limit = 48, page = 1 } = await req.json();

    const params = new URLSearchParams();
    if (query) params.set("terms", query);
    if (category) params.set("categories", category);
    if (brand) params.set("brand", brand);

    const url = `${SS_BASE}/products/?${params.toString()}`;
    const res = await fetch(url, { headers: ssHeaders() });

    if (!res.ok) {
      const text = await res.text();
      return Response.json(
        { error: `S&S API error ${res.status}: ${text}` },
        { status: res.status, headers: CORS }
      );
    }

    const raw = await res.json();
    const all: any[] = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.products) ? raw.products
      : Array.isArray(raw?.items) ? raw.items
      : [];

    const normalized = all.map(normalizeProduct);
    const start = (page - 1) * limit;
    const products = normalized.slice(start, start + limit);

    return Response.json(
      { products, total: normalized.length, page, limit },
      { headers: CORS }
    );
  } catch (err) {
    console.error("ssSearchCatalog error:", err);
    return Response.json({ error: err.message }, { status: 500, headers: CORS });
  }
});
