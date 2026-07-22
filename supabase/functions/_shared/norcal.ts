// NorCal (Shopify) integration helpers — pure, unit-tested, no Deno/Node APIs
// so both the edge function and vitest can import them.
//
// NorCal Screen Print Supply (norcalsps.com) runs on Shopify and exposes its
// full catalog publicly at /products.json. These helpers normalize that shape
// and build the Shopify cart permalink used to hand a shop's reorder list off
// to NorCal's checkout in one click.

export const NORCAL_STORE_URL_DEFAULT = "https://norcalsps.com";

// Browsable category buckets, derived from NorCal's Shopify product_type
// (which is well-populated but granular: "Plastisol Inks", "Waterbase Inks",
// "Aluminum Screens", "Squeegee", …). These are the tabs the catalog browser
// shows. "Other" catches blanks/service/uncategorized.
export const NORCAL_CATEGORIES = ["Inks", "Chemicals", "Screens", "Equipment", "Supplies", "Other"] as const;

const CATEGORY_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/ink/i, "Inks"],
  [/screen/i, "Screens"],
  [/chemical|emulsion|adhesive/i, "Chemicals"],
  [/equipment|press|squeegee/i, "Equipment"],
  [/suppl|tape/i, "Supplies"],
];

// Map a raw Shopify product_type to one of NORCAL_CATEGORIES.
export function norcalCategory(productType: unknown): string {
  const t = String(productType ?? "");
  for (const [re, bucket] of CATEGORY_RULES) if (re.test(t)) return bucket;
  return "Other";
}

// Shopify "infinite options" apps publish hidden helper products with this
// product_type — never a real orderable item, so we drop them from the catalog.
const HIDDEN_PRODUCT_TYPE = "OPTIONS_HIDDEN_PRODUCT";

export interface NorcalVariant {
  variantId: string;
  productId: string;
  title: string;
  size: string;
  sku: string;
  price: number;
  available: boolean;
  image: string;
  productType: string;
  category: string;
  vendor: string;
  url: string;
}

function stripTrailingSlash(u: string): string {
  return String(u || NORCAL_STORE_URL_DEFAULT).replace(/\/+$/, "");
}

// Flatten Shopify /products.json into one row per orderable variant. Tolerant
// of missing fields — a product with no variants or a variant with no id is
// skipped rather than throwing.
// deno-lint-ignore no-explicit-any
export function normalizeNorcalProducts(products: any, storeUrl: string = NORCAL_STORE_URL_DEFAULT): NorcalVariant[] {
  const store = stripTrailingSlash(storeUrl);
  const out: NorcalVariant[] = [];
  const list = Array.isArray(products) ? products : [];
  for (const p of list) {
    const productType = String(p?.product_type ?? "").trim();
    if (productType === HIDDEN_PRODUCT_TYPE) continue; // Shopify options-app helper product
    const productImage =
      Array.isArray(p?.images) && p.images[0]?.src ? String(p.images[0].src) : "";
    const variants = Array.isArray(p?.variants) ? p.variants : [];
    for (const v of variants) {
      if (v?.id == null) continue;
      const variantImage = v?.featured_image?.src ? String(v.featured_image.src) : "";
      out.push({
        variantId: String(v.id),
        productId: String(p?.id ?? ""),
        title: String(p?.title ?? "").trim(),
        size: String(v?.title ?? v?.option1 ?? "").trim(),
        sku: String(v?.sku ?? "").trim(),
        price: Number(v?.price) || 0,
        available: Boolean(v?.available),
        image: variantImage || productImage,
        productType,
        category: norcalCategory(productType),
        vendor: String(p?.vendor ?? "").trim(),
        url: p?.handle ? `${store}/products/${p.handle}?variant=${v.id}` : store,
      });
    }
  }
  return out;
}

// Shopify cart permalink: /cart/{variantId}:{qty},{variantId}:{qty}
// Verified live against norcalsps.com (302 → pre-filled checkout). Ignores
// lines with a non-numeric variant id or a non-positive qty; returns null when
// nothing orderable remains (caller falls back to opening the store). Optional
// refParams become query string (e.g. { ref: "inktracker" }) for attribution.
// deno-lint-ignore no-explicit-any
export function norcalCartPermalink(
  lines: any[],
  storeUrl: string = NORCAL_STORE_URL_DEFAULT,
  refParams: Record<string, string> = {},
): string | null {
  const store = stripTrailingSlash(storeUrl);
  const parts = (Array.isArray(lines) ? lines : [])
    .map((l) => ({
      id: String(l?.variantId ?? "").trim(),
      qty: Math.max(0, Math.floor(Number(l?.qty) || 0)),
    }))
    .filter((l) => /^\d+$/.test(l.id) && l.qty > 0)
    .map((l) => `${l.id}:${l.qty}`);
  if (parts.length === 0) return null;
  const qs = new URLSearchParams(refParams).toString();
  return `${store}/cart/${parts.join(",")}${qs ? `?${qs}` : ""}`;
}
