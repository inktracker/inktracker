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

// Extract { unitPrice, stock } for one color/size from a raw lookup match.
// unitPrice 0 = unpriced/not carried; stock null = unknown, 0 = out of stock.
export function extractVariant(match, product, color, size) {
  if (!match) return { unitPrice: 0, stock: null };
  const cKey =
    matchKey(match.priceMap, color) ||
    matchKey(match.inventoryMap, color) ||
    matchKey(match.sizePriceMap, color) ||
    color;

  let unitPrice = 0;
  const spm = match.sizePriceMap?.[cKey];
  if (spm) {
    const sKey = matchKey(spm, size);
    if (sKey) unitPrice = Number(spm[sKey]) || 0;
  }
  if (!unitPrice) {
    const variants = product?.variants || match.variants || [];
    const v = variants.find(
      (x) => ci(x.colour ?? x.color) === ci(color) && ci(x.size) === ci(size),
    );
    if (v?.price) unitPrice = Number(v.price) || 0;
  }
  if (!unitPrice) {
    unitPrice = Number(match.priceMap?.[cKey]?.piecePrice) || Number(match.piecePrice) || 0;
  }

  let stock = null;
  const inv = match.inventoryMap?.[cKey];
  if (inv && typeof inv === "object") {
    const sKey = matchKey(inv, size);
    if (sKey != null) {
      const n = Number(inv[sKey]);
      stock = Number.isFinite(n) ? n : null;
    }
  }
  return { unitPrice, stock };
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
  let total = 0;
  let totalQty = 0;
  const missing = []; // can't price (not carried / unpriced)
  const shortStock = []; // priced but stock < qty (stock known)
  for (const it of items || []) {
    const qty = Number(it.quantity) || 0;
    totalQty += qty;
    let unitPrice = 0;
    let stock = null;
    try {
      const { match, product } = await getMatch(supplier, norm(it.styleCode));
      if (match) ({ unitPrice, stock } = extractVariant(match, product, it.color, it.size));
    } catch {
      /* treated as missing below */
    }
    const priced = unitPrice > 0;
    if (!priced) missing.push(it);
    else if (stock != null && stock < qty) shortStock.push(it);
    total += (priced ? unitPrice : 0) * qty;
    lines.push({ unitPrice, stock, lineCost: unitPrice * qty });
  }
  return {
    supplier,
    lines,
    total,
    totalQty,
    perPiece: totalQty > 0 ? total / totalQty : 0,
    coversAll: missing.length === 0 && items.length > 0,
    missing,
    shortStock,
  };
}

// Compare a draft PO's total across its candidate suppliers. Returns
// { current, alternatives, best } where each entry is a priceThroughSupplier
// result. `best` is the cheapest supplier that COVERS ALL lines (so a partial
// match never masquerades as cheaper). Only meaningful for S&S/SanMar POs.
export async function comparePoSuppliers(po, { lookupByStyle } = {}) {
  const items = Array.isArray(po?.items) ? po.items : [];
  const suppliers = candidateSuppliers(po?.supplier);
  const doLookup =
    lookupByStyle ||
    ((supplier, s) => lookupStyle(supplier, { styleCode: s, styleNumber: s }));

  // Memoize (supplier, style) → {match, product}.
  const cache = new Map();
  const getMatch = async (supplier, style) => {
    const key = `${supplier}::${style}`;
    if (!cache.has(key)) cache.set(key, doLookup(supplier, style).then(pickMatch).catch(() => ({ match: null, product: null })));
    return cache.get(key);
  };

  const priced = await Promise.all(suppliers.map((s) => priceThroughSupplier(items, s, getMatch)));
  const current = priced.find((p) => p.supplier === po?.supplier) || null;
  const alternatives = priced.filter((p) => p.supplier !== po?.supplier);

  // Cheapest supplier that covers every line (incl. the current one).
  const eligible = priced.filter((p) => p.coversAll);
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
