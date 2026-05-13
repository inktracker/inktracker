// Shared AS Colour API helpers.
// Docs reference: AS Colour NZ — API Overview (api@ascolour.com)
// Base URL: https://api.ascolour.co.nz/v1
//
// Auth tiers:
//   - Most endpoints: Subscription-Key header only.
//   - /catalog/pricelist: Subscription-Key + Bearer token from POST /api/authentication.
//
// SECURITY: This module used to hold credentials and a Bearer-token cache in
// module-level mutable state (`let _acSubKey`, `let cachedToken`, plus
// `setAcCredentials()` / `resetAcCredentials()`). That pattern is unsafe under
// Deno Edge runtime isolate reuse — two concurrent invocations on the same
// warm isolate could clobber each other's credentials mid-request, leading to
// cross-shop credential cross-contamination (Shop A's request finishing its
// fetch using Shop B's subscription key, or reusing a cached Bearer token
// minted under different credentials).
//
// Refactored 2026-05-13 so every call takes credentials explicitly. Callers
// build an `AcCreds` and pass it to `acFetch` / `getAcBearerToken`. The
// Bearer-token cache is keyed by email so a token minted for shop A is never
// returned to shop B.

export const AC_BASE = "https://api.ascolour.com/v1";

export interface AcCreds {
  subKey: string;
  email: string;
  password: string;
}

/**
 * Build credentials from a profile row, falling back to platform-level env
 * defaults. Returns null if no usable credentials exist (caller should refuse
 * the request rather than silently using env credentials in an authenticated
 * context).
 */
export function credsFromProfile(profile: { ac_subscription_key?: string | null; ac_email?: string | null; ac_password?: string | null } | null | undefined): AcCreds | null {
  const subKey   = profile?.ac_subscription_key || Deno.env.get("ASCOLOUR_SUBSCRIPTION_KEY") || "";
  const email    = profile?.ac_email             || Deno.env.get("ASCOLOUR_EMAIL")             || "";
  const password = profile?.ac_password          || Deno.env.get("ASCOLOUR_PASSWORD")          || "";
  if (!subKey) return null;
  return { subKey, email, password };
}

export const FETCH_TIMEOUT_MS = 20_000;

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export function acHeaders(creds: AcCreds, extra: Record<string, string> = {}) {
  return {
    "Ocp-Apim-Subscription-Key": creds.subKey,
    "Subscription-Key": creds.subKey,
    Accept: "application/json",
    "Content-Type": "application/json",
    ...extra,
  };
}

export type AcFetchResult = { ok: boolean; status: number; data: any };

export async function acFetch(
  creds: AcCreds,
  url: string,
  init: RequestInit = {},
  ctx = "ascolour",
): Promise<AcFetchResult> {
  let status = 0;
  try {
    const res = await fetch(url, {
      ...init,
      headers: { ...acHeaders(creds), ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    status = res.status;
    const text = await res.text();
    console.error(`[${ctx}] ${init.method ?? "GET"} ${url} → ${status} (${text.length} chars)`);
    let data: any;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      console.error(`[${ctx}] error body: ${String(text).slice(0, 300)}`);
      return { ok: false, status, data };
    }
    return { ok: true, status, data };
  } catch (err) {
    console.error(`[${ctx}] fetch exception (${url}): ${(err as Error).message}`);
    return { ok: false, status, data: { error: (err as Error).message } };
  }
}

// --- Auth (Bearer token cache for pricelist) ---------------------------------
//
// Cache is keyed by the caller's AS Colour email so concurrent invocations
// from different shops never receive each other's tokens. Each entry holds
// the token + an expiry timestamp (50min TTL — AS Colour tokens are 1h).
//
// One isolate-wide Map is fine: it's just a perf cache for legitimately-issued
// tokens, scoped per credential set. A wrong key returns a cache miss and we
// re-auth.

interface CachedToken { token: string; expiresAt: number }
const tokenCache = new Map<string, CachedToken>();
const TOKEN_TTL_MS = 50 * 60 * 1000;

export async function getAcBearerToken(creds: AcCreds, force = false): Promise<string | null> {
  if (!creds.email || !creds.password) return null;
  const key = creds.email.toLowerCase();
  if (!force) {
    const hit = tokenCache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.token;
  }
  const { ok, data } = await acFetch(
    creds,
    `${AC_BASE}/api/authentication`,
    { method: "POST", body: JSON.stringify({ email: creds.email, password: creds.password }) },
    "ascolour-auth",
  );
  if (!ok) return null;
  // Tolerate a few possible token field names; AS Colour returns a Bearer token string.
  const token =
    (typeof data === "string" && data) ||
    data?.token ||
    data?.accessToken ||
    data?.bearer ||
    data?.authorization ||
    null;
  if (!token) return null;
  tokenCache.set(key, { token: String(token), expiresAt: Date.now() + TOKEN_TTL_MS });
  return String(token);
}

function stripHtml(str: string): string {
  return str.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

// --- Normalisers -------------------------------------------------------------
//
// AS Colour returns camelCase JSON. Field names vary slightly between catalog and
// inventory endpoints, so the normalisers tolerate a few aliases (similar to how
// the S&S helpers handle alternate keys).

export function normalizeColour(c: any) {
  return {
    name: c.colourName ?? c.colorName ?? c.name ?? "",
    code: c.colourCode ?? c.colorCode ?? c.code ?? "",
    hex: c.hex ?? c.hexValue ?? c.swatchHex ?? "",
  };
}

export function normalizeImage(img: any) {
  return {
    url: img.urlStandard ?? img.urlZoom ?? img.url ?? img.imageUrl ?? img.href ?? "",
    thumbnail: img.urlThumbnail ?? img.urlTiny ?? "",
    type: img.imageType ?? img.type ?? img.kind ?? "",
    colour: img.imageType ?? img.colour ?? img.colourName ?? img.colorName ?? "",
  };
}

export function normalizeVariant(v: any) {
  return {
    sku: v.sku ?? v.skuCode ?? "",
    styleCode: String(v.styleCode ?? v.style ?? ""),
    colour: v.colour ?? v.colourName ?? v.colorName ?? v.color ?? "",
    size: v.sizeCode ?? v.size ?? v.sizeName ?? "",
    barcode: v.GTIN12 ?? v.barcode ?? v.gtin ?? "",
    price: Number(v.price ?? v.unitPrice ?? 0),
    imageUrl: v.imageUrl ?? "",
    discontinued: v.discontinued ?? false,
  };
}

export function normalizeInventoryItem(i: any) {
  return {
    sku: i.sku ?? i.skuCode ?? "",
    styleCode: String(i.styleCode ?? ""),
    colour: i.colourName ?? i.colorName ?? i.colour ?? "",
    size: i.size ?? i.sizeName ?? "",
    qty: Number(i.qtyAvailable ?? i.quantity ?? i.qty ?? 0),
    warehouse: i.warehouse ?? i.location ?? "",
  };
}

export function normalizeProduct(p: any) {
  const variants = Array.isArray(p.variants) ? p.variants.map(normalizeVariant) : [];
  const images = Array.isArray(p.images) ? p.images.map(normalizeImage) : [];

  // AS Colour doesn't return a colours array — derive unique colours from variants
  let colours = Array.isArray(p.colours ?? p.colors)
    ? (p.colours ?? p.colors).map(normalizeColour)
    : [];
  if (colours.length === 0 && variants.length > 0) {
    const seen = new Set<string>();
    for (const v of variants) {
      if (v.colour && !seen.has(v.colour)) {
        seen.add(v.colour);
        colours.push({ name: v.colour, code: "", hex: "" });
      }
    }
  }

  // Derive unique sizes from variants
  let sizes = Array.isArray(p.sizes) ? p.sizes : [];
  if (sizes.length === 0 && variants.length > 0) {
    const seen = new Set<string>();
    for (const v of variants) {
      if (v.size && !seen.has(v.size)) {
        seen.add(v.size);
        sizes.push(v.size);
      }
    }
  }

  return {
    id: String(p.styleCode ?? p.id ?? p.code ?? ""),
    styleCode: String(p.styleCode ?? p.code ?? p.id ?? ""),
    title: (p.styleName ?? p.title ?? p.name ?? "").replace(/\s*\|\s*\d+\s*$/, ""),
    description: stripHtml(p.description ?? ""),
    category: p.productType ?? p.category ?? p.styleCategory ?? "",
    fabric: p.composition ?? p.fabric ?? "",
    weight: p.fabricWeight ?? p.weight ?? p.gsm ?? "",
    sizes,
    colours,
    images,
    variants,
    primaryImage: images.find((i: any) => i.url)?.url ?? "",
    raw: p,
  };
}

// Group inventory rows into a colour → size → qty map (UI-friendly shape).
export function buildInventoryMap(rows: any[]) {
  const map: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    const item = normalizeInventoryItem(r);
    if (!item.colour) continue;
    if (!map[item.colour]) map[item.colour] = {};
    map[item.colour][item.size] = (map[item.colour][item.size] ?? 0) + item.qty;
  }
  return map;
}
