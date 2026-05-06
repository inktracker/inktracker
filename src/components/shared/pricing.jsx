export const FIRST_PRINT = {
  1: { 25: 6.3, 50: 5.67, 100: 5.22, 200: 4.9 },
  2: { 25: 6.93, 50: 6.24, 100: 5.77, 200: 5.48 },
  3: { 25: 7.55, 50: 6.8, 100: 6.29, 200: 5.97 },
  4: { 25: 8.16, 50: 7.34, 100: 6.79, 200: 6.45 },
  5: { 25: 8.73, 50: 7.86, 100: 7.27, 200: 6.9 },
  6: { 25: 9.25, 50: 8.33, 100: 7.7, 200: 7.32 },
  7: { 25: 9.75, 50: 8.78, 100: 8.12, 200: 7.72 },
  8: { 25: 10.23, 50: 9.21, 100: 8.52, 200: 8.1 },
};

export const ADDL_PRINT = {
  1: { 25: 3.15, 50: 2.68, 100: 2.41, 200: 2.29 },
  2: { 25: 3.45, 50: 2.93, 100: 2.64, 200: 2.51 },
  3: { 25: 3.75, 50: 3.19, 100: 2.87, 200: 2.73 },
  4: { 25: 4.05, 50: 3.44, 100: 3.1, 200: 2.94 },
  5: { 25: 4.25, 50: 3.61, 100: 3.25, 200: 3.09 },
  6: { 25: 4.45, 50: 3.78, 100: 3.4, 200: 3.23 },
  7: { 25: 4.65, 50: 3.95, 100: 3.55, 200: 3.37 },
  8: { 25: 4.85, 50: 4.12, 100: 3.7, 200: 3.51 },
};

export const EXTRA_RATES = {
  colorMatch: 1.0,
  difficultPrint: 0.5,
  waterbased: 1.0,
  tags: 1.5,
};

export const SIZES = ["OS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"];
export const BIG_SIZES = ["2XL", "3XL", "4XL", "5XL"];

export function sortSizeEntries(entries) {
  return [...entries].sort(([a], [b]) => {
    const ia = SIZES.indexOf(a);
    const ib = SIZES.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });
}
export const LOCATIONS = ["Front", "Back", "Left Chest", "Right Chest", "Left Sleeve", "Right Sleeve", "Pocket", "Hood", "Other"];
export const ALL_TECHNIQUES = ["Screen Print", "DTG", "Embroidery", "DTF", "Heat Transfer", "Sublimation"];
// Returns only techniques the shop has enabled. Screen Print is always available.
export function getEnabledTechniques() {
  const enabled = ["Screen Print"];
  if (_pc?.embroidery?.enabled) enabled.push("Embroidery");
  // Future: add DTG, DTF, etc. when those pricing tabs are built
  return enabled;
}
export const TECHNIQUES = ALL_TECHNIQUES; // backward compat for code that imports it directly
export const Q_STATUSES = ["Draft", "Sent", "Pending", "Approved", "Approved and Paid", "Declined"];
export const O_STATUSES = ["Art Approval", "Order Goods", "Pre-Press", "Printing", "Finishing", "QC", "Ready for Pickup", "Completed"];

export const STANDARD_MARKUP = 1.4;
export const BROKER_MARKUP = 1.2;
export const BROKER_MARKUP_SHARE = 0.2;

// Per-shop pricing config — set via loadShopPricingConfig() on app startup.
// When null, all functions use the hardcoded defaults above.
let _pc = null;

export function loadShopPricingConfig(config) {
  _pc = config && Object.keys(config).length > 0 ? config : null;
}

export function getShopPricingConfig() { return _pc; }

export function getOversizeUpcharge() { return _pc?.oversizeUpcharge ?? 2; }

export function getTier(qty) {
  const tiers = _pc?.tiers || [25, 50, 100, 200];
  // Find the highest tier the qty meets or exceeds
  const sorted = [...tiers].sort((a, b) => b - a);
  for (const t of sorted) {
    if (qty >= t) return t;
  }
  return sorted[sorted.length - 1] || 25;
}

export function getQty(li) {
  return Object.values(li?.sizes || {}).reduce((sum, v) => sum + (parseInt(v, 10) || 0), 0);
}

export function getAdminMarkup(garmentCost) {
  const cost = parseFloat(garmentCost) || 0;
  const tiers = _pc?.garmentMarkup;
  if (tiers && Array.isArray(tiers)) {
    // Config tiers: [{ above: 25, markup: 1.15 }, ...] sorted desc by "above"
    const sorted = [...tiers].sort((a, b) => b.above - a.above);
    for (const t of sorted) {
      if (cost > t.above) return t.markup;
    }
    return sorted[sorted.length - 1]?.markup || 1.4;
  }
  // Defaults
  if (cost > 25) return 1.15;
  if (cost > 15) return 1.22;
  if (cost > 8) return 1.3;
  return 1.4;
}

export function getBrokerMarkup(garmentCost, share = BROKER_MARKUP_SHARE) {
  const adminMarkup = getAdminMarkup(garmentCost);
  return 1 + ((adminMarkup - 1) * share);
}

export function getMarkup(garmentCost, isBroker = false) {
  return isBroker ? getBrokerMarkup(garmentCost) : getAdminMarkup(garmentCost);
}

export function fmtDate(d) {
  if (!d) return "—";
  const p = String(d).split("-");
  return `${p[1]}/${p[2]}/${p[0]}`;
}

export function fmtMoney(n) {
  return "$" + (parseFloat(n) || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function uid() {
  return Math.random().toString(36).slice(2, 9);
}

export function tod() {
  return new Date().toISOString().split("T")[0];
}

export function getDisplayName(customer) {
  if (typeof customer === "string") {
    try {
      const parsed = JSON.parse(customer);
      if (typeof parsed === "object" && parsed !== null) {
        return (parsed.company && parsed.company.trim()) || parsed.name || "Unknown";
      }
    } catch (e) {
      return customer;
    }
    return customer;
  }

  return (customer?.company && customer.company.trim()) || customer?.name || "Unknown";
}

export function isBrokerRecord(record) {
  return Boolean(record?.broker_id || record?.broker_email || record?.brokerId);
}

export function getOrderDisplayClient(order, fallbackCustomer = null) {
  if (isBrokerRecord(order)) {
    return order?.customer_name || order?.broker_name || order?.broker_company || order?.broker_id || "Unknown";
  }

  return getDisplayName(fallbackCustomer || order?.customer_name);
}

export function getOrderDisplayJobTitle(order, fallbackCustomer = null) {
  if (isBrokerRecord(order)) {
    return order?.job_title || order?.broker_client_name || getDisplayName(fallbackCustomer || order?.broker_client_name || order?.customer_name);
  }

  return "";
}

export function newLineItem() {
  return {
    id: uid(),
    style: "",
    brand: "",
    category: "",
    garmentCost: "",
    garmentColor: "",
    sizes: {},
    imprints: [
      {
        id: uid(),
        title: "",
        location: "Front",
        width: "",
        height: "",
        colors: 1,
        pantones: "",
        technique: "Screen Print",
        details: "",
        linked: false,
      },
    ],
  };
}

// Get embroidery price per piece for a given stitch tier index and quantity
// Default embroidery pricing (used when shop hasn't saved custom config yet)
const DEFAULT_EMB_PRICING = {
  "Under 5K": { 12: 8.50, 24: 7.50, 48: 6.50, 72: 5.75, 144: 5.25 },
  "5K-10K":   { 12: 10.50, 24: 9.00, 48: 8.00, 72: 7.00, 144: 6.50 },
  "10K-15K":  { 12: 12.50, 24: 11.00, 48: 9.75, 72: 8.75, 144: 8.00 },
  "15K+":     { 12: 15.00, 24: 13.50, 48: 12.00, 72: 10.75, 144: 9.75 },
};
const DEFAULT_EMB_STITCH_TIERS = ["Under 5K", "5K-10K", "10K-15K", "15K+"];
const DEFAULT_EMB_QTY_TIERS = [12, 24, 48, 72, 144];

function getEmbroideryPPP(stitchIdx, qty) {
  const emb = _pc?.embroidery;
  const pricing = emb?.pricing || DEFAULT_EMB_PRICING;
  const stitchTiers = emb?.stitchTiers || DEFAULT_EMB_STITCH_TIERS;
  const qtyTiers = emb?.qtyTiers || DEFAULT_EMB_QTY_TIERS;

  if (!stitchTiers.length) return 0;
  const stitchTier = stitchTiers[Math.min(stitchIdx, stitchTiers.length - 1)];
  // Find the best matching qty tier
  const sorted = [...qtyTiers].sort((a, b) => b - a);
  let tier = sorted[sorted.length - 1];
  for (const t of sorted) { if (qty >= t) { tier = t; break; } }
  // Try both number and string key (JSONB keys are strings)
  const tierPricing = pricing[stitchTier];
  if (!tierPricing) return 0;
  return tierPricing[tier] ?? tierPricing[String(tier)] ?? 0;
}

export function calcGroupPrice(garmentCost, qty, imprints, rushRate, extras, markup = STANDARD_MARKUP) {
  if (!qty || qty < 1 || !imprints || imprints.length === 0) return null;

  const active = imprints.filter((i) => (i.colors || 0) > 0);
  if (active.length === 0) return null;

  // Check if this is an embroidery job (first imprint technique)
  const technique = active[0]?.technique || "Screen Print";
  const isEmbroidery = technique === "Embroidery";

  const sorted = [...active].sort((a, b) => a.colors - b.colors);
  const fp = _pc?.firstPrint || FIRST_PRINT;
  const ap = _pc?.addlPrint || ADDL_PRINT;
  const maxColors = _pc?.maxColors || 8;
  const firstColors = Math.min(maxColors, Math.max(1, sorted[0].colors || 1));
  let printPPP = 0;
  let tier;

  if (isEmbroidery) {
    for (let i = 0; i < sorted.length; i++) {
      const stitchIdx = Math.max(0, (sorted[i].colors || 1) - 1);
      const rate = getEmbroideryPPP(stitchIdx, qty);
      printPPP += i === 0 ? rate : rate * 0.7;
    }
    const embTiers = _pc?.embroidery?.qtyTiers || [12, 24, 48, 72, 144];
    const stiers = [...embTiers].sort((a, b) => b - a);
    tier = stiers[stiers.length - 1];
    for (const t of stiers) { if (qty >= t) { tier = t; break; } }
  } else {
    tier = getTier(qty);
    printPPP = fp[firstColors]?.[tier] ?? fp[Math.min(firstColors, 8)]?.[tier] ?? 0;
    for (let i = 1; i < sorted.length; i += 1) {
      const c = Math.min(maxColors, Math.max(1, sorted[i].colors || 1));
      printPPP += ap[c]?.[tier] ?? ap[Math.min(c, 8)]?.[tier] ?? 0;
    }
  }

  const er = isEmbroidery ? (_pc?.embroidery?.extras || {}) : (_pc?.extras || EXTRA_RATES);
  const printCost = printPPP * qty;
  const isBroker = markup === BROKER_MARKUP;
  const garmentMarkup = getMarkup(garmentCost, isBroker);
  const gCost = (parseFloat(garmentCost) || 0) * garmentMarkup * qty;

  let extraPPP = 0;
  Object.entries(extras || {}).forEach(([k, on]) => {
    if (on) extraPPP += typeof on === "number" ? on : (er[k] || EXTRA_RATES[k] || 0);
  });
  const extraCost = extraPPP * qty;

  let sub = printCost + gCost + extraCost;
  const rushFee = rushRate > 0 ? sub * rushRate : 0;
  sub += rushFee;

  return {
    tier,
    printCost,
    gCost,
    extraCost,
    rushFee,
    sub,
    ppp: qty > 0 ? sub / qty : 0,
    firstPPP: fp[firstColors]?.[tier] ?? 0,
  };
}

export function getPrintKey(imp) {
  return `${imp?.technique || "Screen Print"}|${imp?.title || ""}|${imp?.width || ""}|${imp?.height || ""}`;
}

export function findLinkedPrints(lineItems) {
  const printMap = {};

  (lineItems || []).forEach((li, liIdx) => {
    (li.imprints || []).forEach((imp) => {
      if (imp.linked && (imp.colors || 0) > 0) {
        const key = getPrintKey(imp);
        if (!printMap[key]) printMap[key] = [];
        printMap[key].push({ liIdx, impId: imp.id, li, imp });
      }
    });
  });

  return printMap;
}

export function buildLinkedQtyMap(lineItems) {
  const printMap = findLinkedPrints(lineItems);
  const qtyMap = {};

  Object.entries(printMap).forEach(([key, items]) => {
    qtyMap[key] = items.reduce((sum, item) => sum + getQty(item.li), 0);
  });

  return qtyMap;
}

export function calcLinkedLinePrice(li, rushRate, extras, markup, linkedQtyMap) {
  const qty = getQty(li);
  if (!qty || qty < 1 || !li.imprints || li.imprints.length === 0) return null;

  const active = li.imprints.filter((i) => (i.colors || 0) > 0);
  if (active.length === 0) return null;

  const sorted = [...active].sort((a, b) => a.colors - b.colors);
  const printBreakdown = [];

  let printCost = 0;
  let firstPPP = 0;
  let displayTier = getTier(qty);

  const technique = sorted[0]?.technique || "Screen Print";
  const isEmbroidery = technique === "Embroidery";
  const fp = _pc?.firstPrint || FIRST_PRINT;
  const ap = _pc?.addlPrint || ADDL_PRINT;
  const maxColors = _pc?.maxColors || 8;

  sorted.forEach((imp, index) => {
    const colors = Math.min(maxColors, Math.max(1, imp.colors || 1));
    const linkedKey = imp.linked ? getPrintKey(imp) : null;
    const tierQty = linkedKey && linkedQtyMap[linkedKey] ? linkedQtyMap[linkedKey] : qty;
    let tier, rate;
    if (isEmbroidery) {
      const stitchIdx = Math.max(0, colors - 1);
      rate = getEmbroideryPPP(stitchIdx, tierQty);
      if (index > 0) rate *= 0.7;
      const embTiers = _pc?.embroidery?.qtyTiers || [12, 24, 48, 72, 144];
      const stiers = [...embTiers].sort((a, b) => b - a);
      tier = stiers[stiers.length - 1];
      for (const t of stiers) { if (tierQty >= t) { tier = t; break; } }
    } else {
      tier = getTier(tierQty);
      const table = index === 0 ? fp : ap;
      rate = table[colors]?.[tier] ?? table[Math.min(colors, 8)]?.[tier] ?? 0;
    }
    const lineCost = Math.round(rate * qty * 100) / 100;

    if (index === 0) {
      firstPPP = rate;
      displayTier = tier;
    }

    printCost += lineCost;

    printBreakdown.push({
      id: imp.id,
      title: imp.title || "",
      location: imp.location || "",
      colors,
      linked: !!imp.linked,
      tierQty,
      tier,
      rate,
      lineCost,
      isFirst: index === 0,
    });
  });

  const isBroker = markup === BROKER_MARKUP;
  const garmentMarkup = getMarkup(li.garmentCost, isBroker);
  const gCost = Math.round((parseFloat(li.garmentCost) || 0) * garmentMarkup * qty * 100) / 100;

  const er = isEmbroidery ? (_pc?.embroidery?.extras || {}) : (_pc?.extras || EXTRA_RATES);
  let extraPPP = 0;
  Object.entries(extras || {}).forEach(([k, on]) => {
    if (on) extraPPP += typeof on === "number" ? on : (er[k] || EXTRA_RATES[k] || 0);
  });
  const extraCost = Math.round(extraPPP * qty * 100) / 100;

  // Round each component to cents before computing rush so displayed values add up
  const roundedPrintCost = Math.round(printCost * 100) / 100;
  const baseBeforeRush = roundedPrintCost + gCost + extraCost;
  const rushFee = rushRate > 0 ? Math.round(baseBeforeRush * rushRate * 100) / 100 : 0;
  const sub = baseBeforeRush + rushFee;

  return {
    tier: displayTier,
    printCost: roundedPrintCost,
    gCost,
    extraCost,
    rushFee,
    sub,
    ppp: qty > 0 ? sub / qty : 0,
    firstPPP,
    printBreakdown,
  };
}

export function calcQuoteTotalsWithLinking(q, markup = STANDARD_MARKUP) {
  const linkedQtyMap = buildLinkedQtyMap(q.line_items || []);
  let sub = 0;
  let rushTotal = 0;

  // Honor the broker's per-line client-price override on client-facing totals
  // (markup === STANDARD_MARKUP). Broker-side internal totals (BROKER_MARKUP)
  // ignore overrides so they always reflect the broker's real cost.
  const respectOverride = markup === STANDARD_MARKUP;

  (q.line_items || []).forEach((li) => {
    const qty = getQty(li);
    const twoXL = BIG_SIZES.reduce((sum, sz) => sum + (parseInt((li.sizes || {})[sz], 10) || 0), 0);
    const override = Number(li?.clientPpp);
    const osUp = getOversizeUpcharge();
    if (respectOverride && Number.isFinite(override) && override > 0 && qty > 0) {
      sub += override * qty + twoXL * osUp;
      return;
    }
    const r = calcLinkedLinePrice(li, q.rush_rate, q.extras, markup, linkedQtyMap);
    if (r) {
      sub += r.sub + twoXL * osUp;
      rushTotal += r.rushFee || 0;
    }
  });

  const subBeforeRush = sub - rushTotal;
  const discVal = parseFloat(q.discount) || 0;
  const isFlat = q.discount_type === "flat" || (discVal > 100 && q.discount_type !== "percent");
  const afterDisc = isFlat ? Math.max(0, sub - discVal) : sub * (1 - discVal / 100);
  const tax = afterDisc * ((parseFloat(q.tax_rate) || 0) / 100);

  return {
    sub,
    subBeforeRush,
    rushTotal,
    afterDisc,
    tax,
    total: afterDisc + tax,
    deposit: (afterDisc + tax) * ((parseFloat(q.deposit_pct) || 0) / 100),
  };
}

export function calcQuoteTotals(q, markup = STANDARD_MARKUP) {
  return calcQuoteTotalsWithLinking(q, markup);
}

// Product categories that drive both the line-item category picker and the
// QB item mapping. Keep this list in sync — adding one here automatically makes
// it available in the quote editor and as a distinct QB income item.
export const GARMENT_CATEGORIES = [
  "T-Shirts",
  "Long Sleeve",
  "Tank Tops",
  "Polos",
  "Hoodies & Sweatshirts",
  "Hats & Caps",
  "Bags & Accessories",
  "Jackets",
  "Customer Supplied",
  "Other",
];

// Map S&S data to one of our GARMENT_CATEGORIES.
// S&S's styleCategory is often empty, so we also scan the product description/title
// for keywords. Returns "" if we can't confidently classify (caller should leave the
// dropdown blank rather than guess).
export function mapSSCategoryToGarment(ssCategory, productDescription = "") {
  // IMPORTANT: check more specific keywords first. "Hooded" must beat "Sweatshirt".
  const s = `${ssCategory || ""} ${productDescription || ""}`.toLowerCase();
  if (!s.trim()) return "";
  if (s.includes("hood") || s.includes("sweatshirt") || s.includes("fleece") || s.includes("pullover") || s.includes("crewneck") || s.includes("crew sweat"))
                                                return "Hoodies & Sweatshirts";
  if (s.includes("jacket") || s.includes("outer") || s.includes("vest") || s.includes("coat") || s.includes("windbreaker"))
                                                return "Jackets";
  if (s.includes("polo"))                       return "Polos";
  if (s.includes("long sleeve") || s.includes("long-sleeve") || s.includes("longsleeve") || s.includes("l/s"))
                                                return "Long Sleeve";
  if (s.includes("tank") || s.includes("singlet") || s.includes("muscle"))
                                                return "Tank Tops";
  if (s.includes("hat") || s.includes("cap") || s.includes("beanie") || s.includes("headwear") || s.includes("visor") || s.includes("trucker") || s.includes("panel"))
                                                return "Hats & Caps";
  if (s.includes("bag") || s.includes("tote") || s.includes("backpack") || s.includes("accessor") || s.includes("scarf") || s.includes("glove") || s.includes("apron"))
                                                return "Bags & Accessories";
  if (s.includes("t-shirt") || s.includes("tee") || s.includes("t shirt"))
                                                return "T-Shirts";
  return "";
}

// Technique fallback mapping — used if a line has no explicit category
// (e.g. a quote created before categories existed).
function mapTechniqueToCategory(technique) {
  switch ((technique || "").trim()) {
    case "Embroidery":    return "Embroidery";
    case "Screen Print":  return "Custom Apparel";
    case "DTG":           return "Custom Apparel";
    case "DTF":           return "Custom Apparel";
    case "Heat Transfer": return "Custom Apparel";
    case "Sublimation":   return "Custom Apparel";
    default:              return "Custom Apparel";
  }
}

function primaryTechniqueForLine(li) {
  const imp = (li?.imprints || []).find((i) => (i.colors || 0) > 0) || (li?.imprints || [])[0];
  return imp?.technique || "";
}

// Pick the QB item name for a quote line. Prefers the explicit category, falls
// back to inferring from the primary imprint's technique for legacy quotes.
export function resolveLineCategory(li) {
  const explicit = (li?.category || "").trim();
  if (explicit) return explicit;
  return mapTechniqueToCategory(primaryTechniqueForLine(li));
}

export function buildQBInvoicePayload(quote, markup = STANDARD_MARKUP) {
  const linkedQtyMap = buildLinkedQtyMap(quote.line_items || []);
  const lines = [];

  const respectOverride = markup === STANDARD_MARKUP;

  (quote.line_items || []).forEach((li) => {
    const qty = getQty(li);
    if (qty === 0) return;

    const twoXL = BIG_SIZES.reduce((sum, sz) => sum + (parseInt((li.sizes || {})[sz], 10) || 0), 0);
    const override = Number(li?.clientPpp);
    const useOverride = respectOverride && Number.isFinite(override) && override > 0;

    const styleLabel = [li.brand, li.style, li.garmentColor].filter(Boolean).join(" ") || "Garment";
    const sizeBreakdown = sortSizeEntries(Object.entries(li.sizes || {}))
      .filter(([, v]) => Number(v) > 0)
      .map(([k, v]) => `${k}:${v}`)
      .join(", ");
    const imprintDesc = (li.imprints || [])
      .map((imp) => [imp.title, imp.location, imp.technique].filter(Boolean).join(" / "))
      .filter(Boolean)
      .join("; ");
    const description = [styleLabel, sizeBreakdown, imprintDesc].filter(Boolean).join(" | ");

    const itemName = resolveLineCategory(li);

    if (useOverride) {
      const lineSub = override * qty;
      lines.push({
        description,
        qty,
        unitPrice: Number(override.toFixed(4)),
        amount: Number(lineSub.toFixed(2)),
        itemName,
      });
    } else {
      const r = calcLinkedLinePrice(li, quote.rush_rate, quote.extras, markup, linkedQtyMap);
      if (!r) return;
      const unitPrice = qty > 0 ? r.sub / qty : 0;
      lines.push({
        description,
        qty,
        unitPrice: Number(unitPrice.toFixed(4)),
        amount: Number(r.sub.toFixed(2)),
        itemName,
      });
    }

    // 2XL+ upcharge — configurable per shop, always added on top
    const osUp = getOversizeUpcharge();
    if (twoXL > 0 && osUp > 0) {
      lines.push({
        description: `${styleLabel} — 2XL+ upcharge (${twoXL} @ $${osUp.toFixed(2)})`,
        qty: twoXL,
        unitPrice: osUp,
        amount: Number((twoXL * osUp).toFixed(2)),
        itemName,
      });
    }
  });

  const totals = calcQuoteTotalsWithLinking(quote, markup);
  const depositAmount = quote.deposit_paid ? Number(totals.deposit.toFixed(2)) : 0;

  const discVal = parseFloat(quote.discount) || 0;
  const isFlat = quote.discount_type === "flat" || (discVal > 100 && quote.discount_type !== "percent");

  return {
    lines,
    discountPercent: isFlat ? 0 : discVal,
    discountAmount: isFlat ? discVal : 0,
    discountType: isFlat ? "flat" : "percent",
    taxPercent: parseFloat(quote.tax_rate) || 0,
    depositAmount,
  };
}