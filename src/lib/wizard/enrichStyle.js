// Relative import + .js extension on purpose: node scripts (audit-wizard-styles,
// resync-*) import this module directly and cannot resolve Vite's @/ alias.
import { effectiveOptionCost } from "../suppliers/preference.js";
// Shared style-enrichment helpers used by:
//   1. WizardConfigEditor — at shop-config save time, persists supplier
//      data into the saved `wizard_styles[]` so the public wizard renders
//      images + cost data without runtime API calls.
//   2. OrderWizard — at customer-runtime, when a customer hand-types a
//      style number that isn't in the curated list.
//
// Single source of truth is intentional. Previously these two callers had
// two independent implementations and one of them (the config-save side)
// silently dropped `garmentCost` + `priceMap`, which made the public
// wizard ignore the blank cost. Centralizing here means a new field added
// for one consumer is automatically available to the other.

/**
 * Given a single match object from S&S Activewear's `ssLookupStyle` or
 * AS Colour's `acLookupStyle` edge functions, normalize it into the
 * exact shape the wizard's saved-config + runtime code reads.
 *
 * Pure function — accepts raw API data, returns plain data. No fetch,
 * no globals, no React. Trivial to unit-test.
 *
 * The returned shape MUST include every field consumers read:
 *   - name, description, weight              (display)
 *   - styleImage, colorImages, colors        (visuals)
 *   - sizes, brand                           (display + math fallback)
 *   - garmentCost, priceMap                  (PRICING — easy to forget)
 *   - enrichedAt, enrichedFrom               (provenance)
 *
 * @param {object}  match       Single supplier API match record.
 * @param {object?} opts
 * @param {string?} opts.brandHint    Caller's known brand (preserves it
 *                                    when supplier returns ambiguous data).
 * @param {string}  opts.source       "ss" | "ac" | "sanmar" — which supplier matched.
 * @param {string?} opts.styleNumber  Fallback style number if match lacks one.
 * @returns {object|null}
 */
export function normalizeSupplierMatch(match, { brandHint, source, styleNumber } = {}) {
  if (!match) return null;

  const colorImages = {};
  const colors = [];
  const priceMap = {};
  for (const c of match.colors || []) {
    if (c && c.colorName) colors.push(c.colorName);
    if (c && c.colorName && c.imageUrl) colorImages[c.colorName] = c.imageUrl;
    if (c && c.colorName && (c.piecePrice || c.price)) {
      // Use whichever cost field the supplier exposes. Stored as an
      // object (not a flat number) to match the shape the pricing
      // engine reads: `priceMap[color].piecePrice`.
      priceMap[c.colorName] = { piecePrice: c.piecePrice || c.price };
    }
  }

  // Base garment cost — fallback when a color isn't in priceMap (e.g.
  // discontinued color, or the supplier ships only a generic base price).
  // Try every cost field both suppliers expose.
  const garmentCost =
    match.garmentCost ||
    match.piecePrice ||
    match.basePrice ||
    match.colors?.[0]?.piecePrice ||
    match.colors?.[0]?.price ||
    0;

  return {
    name: match.name || match.styleName || match.description || styleNumber || "",
    description: match.description || "",
    weight: match.weight || match.colors?.[0]?.weight || "",
    // Supplier's primary styleImage wins (AS Colour ships varied —
    // Atlantic, Forest, etc.; S&S ships first-listed-color). Falling
    // back to Black previously flattened the wizard category grid to a
    // wall of identical black tees.
    styleImage:
      match.styleImage ||
      colorImages[colors[0]] ||
      match.colors?.[0]?.imageUrl ||
      colorImages["Black"] ||
      "",
    colorImages,
    colors,
    sizes: match.sizes || [],
    garmentCost,
    priceMap,
    // Caller's brand hint wins — supplier match results can be ambiguous
    // when the same style number exists across catalogs (Red Kap 5080 on
    // S&S vs. AS Colour Heavy Tee 5080).
    brand: brandHint || match.brandName || match.brand || "",
    enrichedAt: new Date().toISOString(),
    enrichedFrom: source,
  };
}

/**
 * Given parallel S&S + AS Colour + SanMar responses, pick the best match
 * using the brand hint (if any) and normalize. Returns null when no
 * supplier knows the style number.
 *
 * Centralizes the brand-disambiguation logic so collisions like
 * "5080" (Red Kap on S&S vs. AS Colour Heavy Tee on AC) always resolve
 * to the correct supplier when the row already has a known brand.
 *
 * @param {object?} ssData    Resolved data from `ssLookupStyle` (or null).
 * @param {object?} acData    Resolved data from `acLookupStyle` (or null).
 * @param {object?} smData    Resolved data from `smLookupStyle` (or null).
 * @param {object?} opts
 * @param {string?} opts.brandHint
 * @param {string?} opts.styleNumber
 * @param {string?} opts.supplierHint  "ss" | "ac" | "sanmar" — pins the pick to
 *   that supplier's response, strictly (no cross-supplier fallback). Brand
 *   hints alone can't disambiguate: the same brand+style often exists on
 *   BOTH S&S and SanMar (Gildan 5000, Bella 3001, Comfort Colors 1717...),
 *   and without the pin a re-sync would silently flip a SanMar style to
 *   S&S pricing. Callers pass the row's saved `enrichedFrom` (or the
 *   search result's source) here.
 */
export function pickAndNormalize(ssData, acData, smData, { brandHint, styleNumber, supplierHint, preferredSource } = {}) {
  let ssMatches = (ssData && Array.isArray(ssData.matches)) ? ssData.matches : [];
  let acMatches = (acData && Array.isArray(acData.matches)) ? acData.matches : [];
  let smMatches = (smData && Array.isArray(smData.matches)) ? smData.matches : [];

  // Supplier pin: empty the other pools so every rule below (brand hints,
  // first-match fallback) can only ever pick from the pinned supplier.
  if (supplierHint === "ss") { acMatches = []; smMatches = []; }
  else if (supplierHint === "ac") { ssMatches = []; smMatches = []; }
  else if (supplierHint === "sanmar") { ssMatches = []; acMatches = []; }
  const brandLower = (brandHint || "").toLowerCase().trim();
  const isAsColourHint = /as ?colour/.test(brandLower);

  let match = null;
  let source = null;

  const findBrandMatch = (matches) => matches.find(m => {
    const b = (m.brandName || "").toLowerCase();
    return b && (b.includes(brandLower) || brandLower.includes(b));
  });

  if (isAsColourHint) {
    // Brand hint pins us to AS Colour. If AC has no match for this
    // style number, return null instead of falling through to S&S
    // — silently substituting an S&S product (e.g. a women's polo
    // when the wizard asked for AS Colour 5029 L/S Tee) is worse
    // than showing nothing. The wizard tile just won't enrich and
    // the audit gate flags it.
    if (acMatches[0]) { match = acMatches[0]; source = "ac"; }
  } else if (brandLower) {
    // Brand hint specifies a brand. Same strict semantics: only a row
    // whose brand actually matches wins — never "any product with that
    // style number"; the collision risk is exactly the bug we're
    // guarding against. S&S checked first (legacy preference), then
    // SanMar — both carry overlapping brands (Port Authority, District,
    // Sport-Tek live in both catalogs).
    // Shop's default supplier takes priority when both carry the brand
    // (Joe 2026-07-20); "cheapest" compares the sale-aware effective
    // price across the suppliers' brand matches; otherwise legacy
    // S&S-then-SanMar order.
    const brandPools = preferredSource === "sanmar"
      ? [["sanmar", smMatches], ["ss", ssMatches]]
      : [["ss", ssMatches], ["sanmar", smMatches]];
    if (preferredSource === "cheapest") {
      let bestCost = Infinity;
      for (const [src, pool] of brandPools) {
        const m = findBrandMatch(pool);
        if (!m) continue;
        const c = effectiveOptionCost(m);
        if (c < bestCost) { match = m; source = src; bestCost = c; }
      }
    }
    if (!match) {
      for (const [src, pool] of brandPools) {
        const m = findBrandMatch(pool);
        if (m) { match = m; source = src; break; }
      }
    }
  } else {
    // No brand hint — first match wins. S&S preferred when several
    // suppliers have a match (legacy compat; predates the wizard
    // brand field), then AS Colour, then SanMar. Used by free-form
    // lookups where the caller has no opinion about the brand.
    const pools = [["ss", ssMatches], ["ac", acMatches], ["sanmar", smMatches]];
    if (preferredSource === "cheapest") {
      let bestCost = Infinity;
      for (const [src, pool] of pools) {
        if (!pool[0]) continue;
        const c = effectiveOptionCost(pool[0]);
        if (c < bestCost) { match = pool[0]; source = src; bestCost = c; }
      }
    } else if (preferredSource) {
      pools.sort((a, b) => (a[0] === preferredSource ? -1 : b[0] === preferredSource ? 1 : 0));
    }
    if (!match) {
      for (const [src, pool] of pools) {
        if (pool[0]) { match = pool[0]; source = src; break; }
      }
    }
  }

  if (!match) return null;
  return normalizeSupplierMatch(match, { brandHint, source, styleNumber });
}

/**
 * Fetch + pick + normalize. Calls both supplier edge functions in
 * parallel via the passed-in Supabase client. Used by both
 * WizardConfigEditor (at save time) and any other caller that needs
 * to enrich a single style number.
 *
 * Supabase is injected so this function is independently testable —
 * pass a stub `{ functions: { invoke: jest.fn() } }`.
 */
export async function fetchEnrichedStyle(styleNumber, brandHint, supabase, supplierHint, preferredSource) {
  if (!styleNumber || typeof styleNumber !== "string") return null;
  const styleNum = styleNumber.trim().toUpperCase();
  if (!styleNum) return null;
  // Catching a missing client here instead of letting the inner
  // `supabase.functions.invoke` throw a TypeError that the catch{}
  // below would silently swallow. Previously this footgun let the
  // "Sync from Suppliers" button spin forever with no visible error.
  if (!supabase?.functions?.invoke) {
    console.error("[fetchEnrichedStyle] called without a Supabase client — pass `supabase` as the 3rd argument.");
    return null;
  }
  try {
    const [ssRes, acRes, smRes] = await Promise.allSettled([
      supabase.functions.invoke("ssLookupStyle", { body: { styleNumber: styleNum } }),
      supabase.functions.invoke("acLookupStyle", { body: { styleCode: styleNum } }),
      supabase.functions.invoke("smLookupStyle", { body: { styleNumber: styleNum } }),
    ]);
    const ssData = ssRes.status === "fulfilled" ? ssRes.value?.data : null;
    const acData = acRes.status === "fulfilled" ? acRes.value?.data : null;
    const smData = smRes.status === "fulfilled" ? smRes.value?.data : null;
    return pickAndNormalize(ssData, acData, smData, { brandHint, styleNumber: styleNum, supplierHint, preferredSource });
  } catch (err) {
    // Surface what actually failed instead of pretending success.
    // Callers still treat null as "couldn't enrich" but at least the
    // root cause shows up in the console for debugging.
    console.error("[fetchEnrichedStyle] failed for", styleNum, err);
    return null;
  }
}

/**
 * Predicate — has this style been fully enriched with everything the
 * public wizard needs to render + price? Used by the save-time
 * auto-enrich pass to detect rows that need a refetch.
 *
 * Requires:
 *   - styleImage (so the curated tile renders without a load spinner)
 *   - colorImages with at least one entry (so the color picker has data)
 *   - cost data — either a flat garmentCost > 0 OR a non-empty priceMap.
 *     Without cost data, the public wizard charges only for imprints and
 *     ignores the blank.
 */
export function isStyleEnriched(s) {
  if (!s || !s.styleImage) return false;
  if (!s.colorImages || Object.keys(s.colorImages).length === 0) return false;
  const hasGarmentCost = Number(s.garmentCost) > 0;
  // `s.priceMap && Object.keys(...)` short-circuits to `undefined` (not
  // `false`) when priceMap is undefined; wrap in Boolean so the final
  // OR can't leak undefined to callers that strictly compare against
  // `false`. The first failure of the tests below caught this.
  const hasPriceMap = Boolean(s.priceMap && Object.keys(s.priceMap).length > 0);
  return Boolean(hasGarmentCost || hasPriceMap);
}
