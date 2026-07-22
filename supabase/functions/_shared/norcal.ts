// NorCal (Shopify) integration helpers — pure, unit-tested, no Deno/Node APIs
// so both the edge function and vitest can import them.
//
// NorCal Screen Print Supply (norcalsps.com) runs on Shopify and exposes its
// full catalog publicly at /products.json. These helpers normalize that shape
// and build the Shopify cart permalink used to hand a shop's reorder list off
// to NorCal's checkout in one click.

export const NORCAL_STORE_URL_DEFAULT = "https://norcalsps.com";

// Top-level catalog categories, mirroring NorCal's own store navigation
// (norcalsps.com) rather than an invented grouping — Inks, Screens, Chemicals,
// Equipment, plus Squeegees and Tape surfaced on their own as their site does.
// The sub-tabs under each are NorCal's exact product_type strings. "Supplies"
// is their "Miscellaneous Supplies" catch-all.
export const NORCAL_CATEGORIES = ["Inks", "Screens", "Chemicals", "Equipment", "Squeegees", "Tape", "Supplies"] as const;

// Explicit product_type → category. NorCal's product_type is a small, stable
// set, so an explicit map matches their taxonomy exactly and avoids the
// mis-bucketing a loose regex causes (e.g. "Screen Printing Kit" is Equipment,
// not Screens). Keyed lower-cased.
const TYPE_TO_CATEGORY: Record<string, string> = {
  "plastisol inks": "Inks",
  "waterbase inks": "Inks",
  "waterbased inks": "Inks",
  "discharge inks": "Inks",
  "aluminum screens": "Screens",
  "chemicals": "Chemicals",
  "emulsion": "Chemicals",
  "adhesives": "Chemicals",
  "equipment": "Equipment",
  "heat press": "Equipment",
  "flash dryer": "Equipment",
  "conveyor dryer": "Equipment",
  "washout booth": "Equipment",
  "platens": "Equipment",
  "screen printing kit": "Equipment",
  "racks & press carts": "Equipment",
  "squeegee": "Squeegees",
  "tape": "Tape",
  "supplies": "Supplies",
};

// Fallback for any product_type NorCal adds later that isn't in the map above,
// so a new type still lands somewhere sensible instead of disappearing.
const CATEGORY_FALLBACK: ReadonlyArray<readonly [RegExp, string]> = [
  [/ink|film/i, "Inks"],
  [/screen|mesh/i, "Screens"],
  [/chemical|emulsion|adhesive|wash|degreas/i, "Chemicals"],
  [/press|dryer|heat|exposure|platen|rack|cart|equipment|kit/i, "Equipment"],
  [/squeegee/i, "Squeegees"],
  [/tape/i, "Tape"],
];

// Map a raw Shopify product_type to a top-level NorCal category. Unknown /
// empty types fall through to "Supplies" (their misc catch-all).
export function norcalCategory(productType: unknown): string {
  const t = String(productType ?? "").trim().toLowerCase();
  if (!t) return "Supplies";
  if (TYPE_TO_CATEGORY[t]) return TYPE_TO_CATEGORY[t];
  for (const [re, cat] of CATEGORY_FALLBACK) if (re.test(t)) return cat;
  return "Supplies";
}

// The distinct raw product_types present in a set of normalized variants, with
// counts, most-common first. These are the sub-tabs shown under a selected
// category (e.g. Inks → Plastisol Inks / Waterbase Inks / Discharge Inks).
// deno-lint-ignore no-explicit-any
export function norcalSubcategories(variants: any[]): Array<{ type: string; count: number }> {
  const counts = new Map<string, number>();
  for (const v of Array.isArray(variants) ? variants : []) {
    const t = String(v?.productType ?? "").trim();
    if (!t) continue;
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
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
