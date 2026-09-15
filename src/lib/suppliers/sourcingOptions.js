import { lookupStyle, SUPPLIERS } from "@/api/suppliers";

// Cross-supplier price/stock comparison for a whole draft PO. Powers the
// "you'd save $X ordering this through <supplier>" callout so the buying
// decision is made on total cost, at buy-time — not frozen opaquely at
// quote-time. Switching moves the WHOLE PO to the other supplier, so pooling
// (batching jobs to clear a freight minimum) is preserved.
//
// Candidate suppliers: S&S and SanMar share brand style numbers (Comfort
// Colors 1717 is "1717" at both), so each is a real alternative to the other.
// AS Colour uses its own style codes with no shared identity, so it never
// cross-compares.

const norm = (s) => String(s ?? "").trim();
const ci = (s) => norm(s).toLowerCase();

function matchKey(map, name) {
  if (!map || typeof map !== "object") return undefined;
  const want = ci(name);
  return Object.keys(map).find((k) => ci(k) === want);
}

export function candidateSuppliers(currentSupplier) {
  if (currentSupplier === SUPPLIERS.AC) return [SUPPLIERS.AC];
  return [SUPPLIERS.SS, SUPPLIERS.SANMAR];
}

// Extract { unitPrice, standardPrice, onSale, stock } for one color/size from a
// raw lookup match. Unlike quote COSTING (which deliberately ignores sales so
// margins aren't inflated by a temporary promo), a PURCHASE order pays the
// sale price when one is running — so unitPrice here is the sale-aware BUY-NOW
// cost, with standardPrice + onSale exposed so the UI can show "was $Y".
// unitPrice 0 = unpriced/not carried; stock null = unknown, 0 = out of stock.
export function extractVariant(match, product, color, size) {
  if (!match) return { unitPrice: 0, standardPrice: 0, onSale: false, stock: null };
  const cKey =
    matchKey(match.priceMap, color) ||
    matchKey(match.inventoryMap, color) ||
    matchKey(match.sizePriceMap, color) ||
    color;

  // ── standard (list) price ─────────────────────────────────────────
  // Track whether we found a PER-SIZE standard: the per-color salePrice is the
  // cheapest sale ACROSS the color's sizes and is documented server-side as
  // display-only, so it must NEVER be applied to a specific size that has its
  // own (possibly higher, un-discounted) per-size standard — doing so
  // understated e.g. a full-price 2XL to the S-XL sale price.
  let standardPrice = 0;
  let perSizeStandard = false;
  const spm = match.sizePriceMap?.[cKey];
  if (spm) {
    const sKey = matchKey(spm, size);
    if (sKey) {
      standardPrice = Number(spm[sKey]) || 0;
      if (standardPrice) perSizeStandard = true;
    }
  }
  if (!standardPrice) {
    // AS Colour: real per-variant wholesale price (no sale channel).
    const variants = product?.variants || match.variants || [];
    const v = variants.find(
      (x) => ci(x.colour ?? x.color) === ci(color) && ci(x.size) === ci(size),
    );
    if (v?.price) {
      standardPrice = Number(v.price) || 0;
      if (standardPrice) perSizeStandard = true;
    }
  }
  if (!standardPrice) {
    // Color-level fallback (no per-size data for this size).
    standardPrice = Number(match.priceMap?.[cKey]?.piecePrice) || Number(match.piecePrice) || 0;
  }

  // ── sale price ────────────────────────────────────────────────────
  // Per-size sale (colors[].sizeSalePrices) is authoritative for that size.
  // The per-color salePrice fallback applies ONLY when this size had no
  // per-size standard — i.e. genuinely color-level pricing — so it can't drag
  // an un-discounted size down to another size's sale.
  let salePrice = 0;
  const colorObj = (match.colors || []).find((c) => ci(c?.colorName ?? c?.color) === ci(color));
  const ssm = colorObj?.sizeSalePrices;
  if (ssm) {
    const sKey = matchKey(ssm, size);
    if (sKey) salePrice = Number(ssm[sKey]) || 0;
  }
  if (!salePrice && !perSizeStandard) salePrice = Number(match.priceMap?.[cKey]?.salePrice) || 0;

  const onSale = salePrice > 0 && (standardPrice === 0 || salePrice < standardPrice);
  const unitPrice = onSale ? salePrice : standardPrice;

  // ── stock ─────────────────────────────────────────────────────────
  let stock = null;
  const inv = match.inventoryMap?.[cKey];
  if (inv && typeof inv === "object") {
    const sKey = matchKey(inv, size);
    if (sKey != null) {
      const n = Number(inv[sKey]);
      stock = Number.isFinite(n) ? n : null;
    }
  }
  return { unitPrice, standardPrice: standardPrice || unitPrice, onSale, stock };
}

function pickMatch(res) {
  const match = (Array.isArray(res?.matches) ? res.matches : [])[0] || res?.product || null;
  const product = res?.product || null;
  return { match, product };
}

// Price a whole PO's items through ONE supplier. Returns per-line unit prices +
// stock and the rolled-up total, plus which lines that supplier can't cover or
// is short on. `getMatch(style) -> {match, product}` is expected to be memoized
// by the caller so each style is looked up once per supplier.
async function priceThroughSupplier(items, supplier, getMatch) {
  const lines = [];
  let total = 0; // buy-now (sale-aware)
  let standardTotal = 0; // list price, no sales
  let totalQty = 0;
  let hasSale = false;
  const missing = []; // can't price (not carried / unpriced)
  const shortStock = []; // priced but stock < qty (stock known)
  for (const it of items || []) {
    const qty = Number(it.quantity) || 0;
    totalQty += qty;
    let unitPrice = 0;
    let standardPrice = 0;
    let onSale = false;
    let stock = null;
    try {
      const { match, product } = await getMatch(supplier, norm(it.styleCode));
      if (match) ({ unitPrice, standardPrice, onSale, stock } = extractVariant(match, product, it.color, it.size));
    } catch {
      /* treated as missing below */
    }
    const priced = unitPrice > 0;
    if (!priced) missing.push(it);
    else if (stock != null && stock < qty) shortStock.push(it);
    if (onSale) hasSale = true;
    total += (priced ? unitPrice : 0) * qty;
    standardTotal += (priced ? standardPrice || unitPrice : 0) * qty;
    lines.push({ unitPrice, standardPrice, onSale, stock, lineCost: unitPrice * qty });
  }
  return {
    supplier,
    lines,
    total,
    standardTotal,
    totalQty,
    perPiece: totalQty > 0 ? total / totalQty : 0,
    hasSale,
    coversAll: missing.length === 0 && items.length > 0,
    missing,
    shortStock,
  };
}

// Session-lived memo for the real lookup so auto-comparing on every draft PO
// open doesn't refetch the same style. Catalog price/stock is stable enough
// within a session; a shop that wants fresh numbers reloads the page.
const _lookupMemo = new Map(); // `${supplier}::${style}` -> Promise<{match,product}>
function defaultLookup(supplier, style) {
  const key = `${supplier}::${style}`;
  if (!_lookupMemo.has(key)) {
    _lookupMemo.set(
      key,
      lookupStyle(supplier, { styleCode: style, styleNumber: style }).then(pickMatch).catch(() => ({ match: null, product: null })),
    );
  }
  return _lookupMemo.get(key);
}

// Annotate a supplier result with free-freight status for `threshold` (0 =
// unknown/none). clearsFreight null when we have no threshold to judge by.
function withFreight(result, threshold) {
  const t = Number(threshold) || 0;
  return {
    ...result,
    threshold: t,
    clearsFreight: t > 0 ? result.total >= t : null,
    freightGap: t > 0 ? Math.max(0, Math.round((t - result.total) * 100) / 100) : 0,
  };
}

// Compare a draft PO across suppliers. Returns { current, alternatives, best }.
// COVERAGE is evaluated for ALL THREE suppliers (so the picker can gray out one
// that doesn't carry a garment — e.g. AS Colour can't carry a Comfort Colors
// 1717). PRICING/savings, however, is only computed WITHIN the current
// supplier's catalog family (S&S ↔ SanMar share brand style numbers; AS Colour
// is its own catalog with unrelated codes), so `best` never compares prices
// across catalogs where the same number could be a different garment.
export async function comparePoSuppliers(po, { lookupByStyle, thresholds = {} } = {}) {
  const items = Array.isArray(po?.items) ? po.items : [];
  const family = candidateSuppliers(po?.supplier); // comparable-pricing set
  const allSuppliers = [SUPPLIERS.AC, SUPPLIERS.SS, SUPPLIERS.SANMAR];
  const doLookup = lookupByStyle || defaultLookup;

  const cache = new Map();
  const getMatch = async (supplier, style) => {
    const key = `${supplier}::${style}`;
    if (!cache.has(key)) cache.set(key, Promise.resolve(doLookup(supplier, style)).then((r) => (lookupByStyle ? pickMatch(r) : r)));
    return cache.get(key);
  };

  const priced = await Promise.all(
    allSuppliers.map((s) => priceThroughSupplier(items, s, getMatch).then((r) => withFreight(r, thresholds[s]))),
  );
  const current = priced.find((p) => p.supplier === po?.supplier) || null;
  const alternatives = priced.filter((p) => p.supplier !== po?.supplier);

  // Cheapest supplier that covers every line AND is price-comparable to the
  // current one (same catalog family). Never crown a cross-catalog supplier.
  const eligible = priced.filter((p) => p.coversAll && family.includes(p.supplier));
  const best = eligible.length
    ? eligible.reduce((a, b) => (b.total < a.total ? b : a))
    : null;

  return { current, alternatives, best };
}

// Savings of the best alternative vs the current supplier — or null when the
// current supplier is already cheapest (or nothing is comparable). Amounts are
// rounded to cents so the callout reads cleanly.
export function savingsVsCurrent(comparison) {
  const { current, best } = comparison || {};
  if (!current?.coversAll || !best || best.supplier === current.supplier) return null;
  const totalSaved = Math.round((current.total - best.total) * 100) / 100;
  if (totalSaved <= 0) return null;
  const perPiece = current.totalQty > 0 ? totalSaved / current.totalQty : 0;
  return {
    supplier: best.supplier,
    totalSaved,
    perPiece: Math.round(perPiece * 100) / 100,
    altTotal: Math.round(best.total * 100) / 100,
    currentTotal: Math.round(current.total * 100) / 100,
    shortStock: best.shortStock, // lines the cheaper supplier is short on
  };
}

function guessedSku(style, color, size) {
  return [norm(style), norm(color).replace(/\s+/g, ""), norm(size)]
    .filter(Boolean)
    .join("-")
    .toUpperCase();
}

// Normalize a lookup response into a uniform product with a variants[] array
// ({ sku, colour, size, price, stock }) so the PO "Add items" panel works for
// EVERY supplier. AS Colour already ships variants + stockBySkuWarehouse, so
// it's passed through untouched (keeps its warehouse routing). S&S / SanMar
// return colors[] instead, so we synthesize variants from them — sale-aware
// price + per-size stock — with a guessed SKU (resolved server-side at submit).
export function normalizeAddItemsProduct(result, supplier) {
  const match = (Array.isArray(result?.matches) ? result.matches : [])[0] || result?.product || null;
  if (!match) return null;

  if (supplier === SUPPLIERS.AC) {
    const product = result?.product || null;
    if (product?.variants?.length) return product;
    if (match?.variants?.length) return match;
    return null;
  }

  const styleCode = match.styleNumber || match.resolvedStyleNumber || match.id || "";
  const title = match.resolvedTitle || match.title || styleCode;
  const primaryImage = match.styleImage || (match.colors || []).find((c) => c?.imageUrl)?.imageUrl || "";
  const variants = [];
  for (const color of match.colors || []) {
    const colorName = color?.colorName || color?.color || "";
    const sizeKeys = Object.keys(color?.sizePrices || {});
    const sizeList = sizeKeys.length ? sizeKeys : (Array.isArray(match.sizes) ? match.sizes : []);
    for (const size of sizeList) {
      const { unitPrice, stock } = extractVariant(match, null, colorName, size);
      variants.push({
        sku: guessedSku(styleCode, colorName, size),
        colour: colorName,
        size,
        price: unitPrice,
        stock,
      });
    }
  }
  return variants.length ? { styleCode, title, primaryImage, variants } : null;
}

// Re-stamp a PO's items for a whole-PO supplier switch: new unit prices from
// the target supplier's pricing result (aligned to items order) and a fresh
// SKU (guessed for S&S/SanMar; blank for AS Colour, which needs its real SKU).
// Pure — the caller persists { supplier, items }.
export function repriceItemsForSupplier(items, targetResult, targetSupplier) {
  const lines = targetResult?.lines || [];
  return (items || []).map((it, i) => {
    const unitPrice = Number(lines[i]?.unitPrice) || Number(it.unitPrice) || 0;
    return {
      ...it,
      sku: targetSupplier === SUPPLIERS.AC ? "" : guessedSku(it.styleCode, it.color, it.size),
      unitPrice,
      warehouse: "",
    };
  });
}
