import { sanitizeSupplierPrice } from "./supplierPrice.ts";

// Shared SanMar API helpers.
// Docs reference: SanMar Web Services Integration Guide v24.3 (Feb 2026),
// requested via sanmarintegrations@sanmar.com.
//
// SanMar is SOAP/XML only — no REST. Two services matter for style lookup:
//
//   Standard Product Information Service
//     PROD: https://ws.sanmar.com:8080/SanMarWebService/SanMarProductInfoServicePort
//     getProductInfoByStyleColorSize(style[, color, size]) → one listResponse
//     entry PER color×size combination with basic info, image URLs, and
//     CATALOG pricing (casePrice/piecePrice).
//
//   Pricing Service
//     PROD: https://ws.sanmar.com:8080/SanMarWebService/SanMarPricingServicePort
//     getPricing(style[, color, size]) → per color×size rows including
//     myPrice — the SHOP'S OWN contracted cost. Preferred over catalog price
//     for garmentCost when available.
//
// Auth: every call carries sanMarCustomerNumber + sanMarUserName +
// sanMarUserPassword in the SOAP body (no OAuth, no token). Same
// isolate-safety rule as _shared/ascolour.ts: credentials are NEVER stored in
// module state — every helper takes an SmCreds argument.
//
// The test environment (test-ws.sanmar.com) uses SEPARATE credentials issued
// by SanMar support; set SANMAR_USE_TEST=1 plus the env creds to point the
// platform fallback at it during integration testing.

export const SM_PROD_BASE = "https://ws.sanmar.com:8080/SanMarWebService";
export const SM_TEST_BASE = "https://test-ws.sanmar.com:8080/SanMarWebService";

export function smBase(): string {
  // Integration-testing hook: point the whole SanMar client at a mock
  // upstream (local SOAP fixture server) without touching prod/test
  // routing. Never set in deployed environments.
  const override = Deno.env.get("SANMAR_BASE_OVERRIDE");
  if (override) return override;
  return Deno.env.get("SANMAR_USE_TEST") === "1" ? SM_TEST_BASE : SM_PROD_BASE;
}

export interface SmCreds {
  customerNumber: string;
  username: string;
  password: string;
}

/**
 * Build credentials from a profile row, falling back to platform-level env
 * defaults. All-or-nothing per source, same as AS Colour: SanMar rejects
 * partial credential sets, and mixing a shop's username with the platform's
 * customer number would authenticate against the wrong account.
 */
export function credsFromProfile(profile: { sanmar_customer_number?: string | null; sanmar_username?: string | null; sanmar_password?: string | null } | null | undefined): SmCreds | null {
  const num = profile?.sanmar_customer_number || "";
  const user = profile?.sanmar_username || "";
  const pass = profile?.sanmar_password || "";
  if (num && user && pass) {
    console.error(`[sanmar:creds] using shop creds (profile.id=${(profile as any)?.id ?? "?"})`);
    return { customerNumber: num, username: user, password: pass };
  }
  const envNum = Deno.env.get("SANMAR_CUSTOMER_NUMBER") || "";
  const envUser = Deno.env.get("SANMAR_USERNAME") || "";
  const envPass = Deno.env.get("SANMAR_PASSWORD") || "";
  if (envNum && envUser && envPass) {
    console.error(`[sanmar:creds] using env defaults (profile.id=${(profile as any)?.id ?? "anon"})`);
    return { customerNumber: envNum, username: envUser, password: envPass };
  }
  console.error(`[sanmar:creds] no shop creds and no env creds — returning null`);
  return null;
}

export const FETCH_TIMEOUT_MS = 25_000;

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// --- XML helpers --------------------------------------------------------------
//
// SanMar's responses are attribute-free element trees, so a full XML parser is
// overkill. These helpers pull repeated blocks and leaf text with regexes.
// They intentionally do NOT handle attributes, CDATA, or namespaces beyond
// stripping prefixes — SanMar emits none of those inside the payload elements.

export function xmlEscape(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function xmlUnescape(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
}

/** All occurrences of <tag>...</tag> (inner XML), ignoring namespace prefixes. */
export function xmlBlocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

/** Text content of the first <tag>...</tag> inside xml, "" when absent/empty. */
export function xmlText(xml: string, tag: string): string {
  const re = new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${tag}>`);
  const m = re.exec(xml);
  return m ? xmlUnescape(m[1].trim()) : "";
}

// --- SOAP transport ------------------------------------------------------------

export type SmFetchResult = { ok: boolean; status: number; xml: string; error?: string };

export async function smSoapCall(
  url: string,
  envelope: string,
  ctx = "sanmar",
): Promise<SmFetchResult> {
  let status = 0;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: '""' },
      body: envelope,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    status = res.status;
    const xml = await res.text();
    console.error(`[${ctx}] POST ${url} → ${status} (${xml.length} chars)`);
    if (!res.ok) {
      console.error(`[${ctx}] error body: ${xml.slice(0, 300)}`);
      return { ok: false, status, xml, error: `SanMar returned HTTP ${status}` };
    }
    // Application-level errors ride inside a 200: <errorOccured>true</errorOccured>
    // (SanMar spells it with one r) plus a message.
    const errFlag = xmlText(xml, "errorOccured") || xmlText(xml, "errorOccurred");
    if (errFlag === "true") {
      const message = xmlText(xml, "message") || "SanMar returned an error";
      console.error(`[${ctx}] errorOccured: ${message}`);
      return { ok: false, status, xml, error: message };
    }
    return { ok: true, status, xml };
  } catch (err) {
    console.error(`[${ctx}] fetch exception (${url}): ${(err as Error).message}`);
    return { ok: false, status, xml: "", error: (err as Error).message };
  }
}

// --- Service calls --------------------------------------------------------------

/**
 * Standard Product Information — getProductInfoByStyleColorSize.
 * style is required; color/size narrow the result. Returns raw response XML
 * (caller parses with parseProductInfoResponse).
 */
export function buildProductInfoEnvelope(creds: SmCreds, style: string, color = "", size = ""): string {
  return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:impl="http://impl.webservice.integration.sanmar.com/">
  <soapenv:Header />
  <soapenv:Body>
    <impl:getProductInfoByStyleColorSize>
      <arg0>
        <style>${xmlEscape(style)}</style>${color ? `\n        <color>${xmlEscape(color)}</color>` : ""}${size ? `\n        <size>${xmlEscape(size)}</size>` : ""}
      </arg0>
      <arg1>
        <sanMarCustomerNumber>${xmlEscape(creds.customerNumber)}</sanMarCustomerNumber>
        <sanMarUserName>${xmlEscape(creds.username)}</sanMarUserName>
        <sanMarUserPassword>${xmlEscape(creds.password)}</sanMarUserPassword>
      </arg1>
    </impl:getProductInfoByStyleColorSize>
  </soapenv:Body>
</soapenv:Envelope>`;
}

/**
 * Product Inventory Service — getInventoryQtyForStyleColorSize.
 * DIFFERENT contract from info/pricing (guide v24.4 pp.50–54): flat
 * positional args under the `web:` namespace — arg0..2 = creds,
 * arg3 = style, arg4 = CATALOG color (not color name), arg5 = size —
 * and its own endpoint, `${base}/SanMarWebServicePort`. Per-warehouse
 * quantities are capped at 3000 by SanMar.
 */
export function buildInventoryEnvelope(creds: SmCreds, style: string, color = "", size = ""): string {
  return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:web="http://webservice.integration.sanmar.com/">
  <soapenv:Header />
  <soapenv:Body>
    <web:getInventoryQtyForStyleColorSize>
      <arg0>${xmlEscape(creds.customerNumber)}</arg0>
      <arg1>${xmlEscape(creds.username)}</arg1>
      <arg2>${xmlEscape(creds.password)}</arg2>
      <arg3>${xmlEscape(style)}</arg3>${color ? `\n      <arg4>${xmlEscape(color)}</arg4>` : ""}${size ? `\n      <arg5>${xmlEscape(size)}</arg5>` : ""}
    </web:getInventoryQtyForStyleColorSize>
  </soapenv:Body>
</soapenv:Envelope>`;
}

// SanMar distribution-center id → short label. Best-effort for the common DCs;
// unknown ids fall back to "WH <id>" so we never assert a wrong location.
// VERIFY against SanMar's current DC list when PO submission goes live.
export const SM_WAREHOUSES: Record<string, string> = {
  "1": "Seattle WA", "2": "Cincinnati OH", "3": "Dallas TX", "4": "Reno NV",
  "5": "Robbinsville NJ", "6": "Jacksonville FL", "7": "Minneapolis MN",
  "8": "Phoenix AZ", "12": "Richmond VA", "31": "Kansas City KS",
};
export function smWarehouseLabel(id: string): string {
  return SM_WAREHOUSES[String(id)] || `WH ${id}`;
}

export interface SmInventoryRow {
  catalogColor: string;
  size: string;
  qty: number; // summed across all warehouses (each capped at 3000 by SanMar)
  warehouses: { code: string; qty: number }[]; // per-DC breakdown (code = label)
}

/**
 * Parse the by-style inventory response: skus/sku blocks, each carrying
 * the CATALOG color + size + a per-warehouse qty list. Returns the total
 * across warehouses per (catalogColor, size) PLUS the per-DC breakdown.
 * Error responses → [].
 */
export function parseInventoryResponse(xml: string): SmInventoryRow[] {
  if (!xml) return [];
  const errFlag = xmlText(xml, "errorOccured") || xmlText(xml, "errorOccurred");
  if (errFlag === "true") return [];
  const rows: SmInventoryRow[] = [];
  for (const sku of xmlBlocks(xml, "sku")) {
    const catalogColor = xmlText(sku, "color");
    const size = xmlText(sku, "size");
    if (!catalogColor || !size) continue;
    let qty = 0;
    const warehouses: { code: string; qty: number }[] = [];
    for (const whse of xmlBlocks(sku, "whse")) {
      const q = Number(xmlText(whse, "qty"));
      if (Number.isFinite(q) && q > 0) {
        qty += q;
        warehouses.push({ code: smWarehouseLabel(xmlText(whse, "whseID")), qty: q });
      }
    }
    rows.push({ catalogColor, size, qty, warehouses });
  }
  return rows;
}

/** Pricing Service — getPricing. Same arg shape as product info. */
export function buildPricingEnvelope(creds: SmCreds, style: string, color = "", size = ""): string {
  return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:impl="http://impl.webservice.integration.sanmar.com/">
  <soapenv:Header />
  <soapenv:Body>
    <impl:getPricing>
      <arg0>
        <style>${xmlEscape(style)}</style>${color ? `\n        <color>${xmlEscape(color)}</color>` : ""}${size ? `\n        <size>${xmlEscape(size)}</size>` : ""}
      </arg0>
      <arg1>
        <sanMarCustomerNumber>${xmlEscape(creds.customerNumber)}</sanMarCustomerNumber>
        <sanMarUserName>${xmlEscape(creds.username)}</sanMarUserName>
        <sanMarUserPassword>${xmlEscape(creds.password)}</sanMarUserPassword>
      </arg1>
    </impl:getPricing>
  </soapenv:Body>
</soapenv:Envelope>`;
}

// --- Response parsing ------------------------------------------------------------

export interface SmProductEntry {
  // productBasicInfo
  style: string;
  brandName: string;
  productTitle: string;
  productDescription: string;
  category: string;
  color: string;          // full color name
  catalogColor: string;   // SanMar mainframe color (needed for ordering)
  size: string;
  sizeIndex: string;
  availableSizes: string;
  inventoryKey: string;
  uniqueKey: string;
  caseSize: number;
  pieceWeight: number;
  productStatus: string;
  // productImageInfo
  colorProductImage: string;
  colorProductImageThumbnail: string;
  colorSquareImage: string;
  colorSwatchImage: string;
  productImage: string;
  thumbnailImage: string;
  frontModel: string;
  specSheet: string;
  // productPriceInfo (CATALOG pricing — not the shop's contracted cost)
  piecePrice: number;
  casePrice: number;
  pieceSalePrice: number;
  caseSalePrice: number;
  priceText: string;
}

export function parseProductInfoResponse(xml: string): SmProductEntry[] {
  return xmlBlocks(xml, "listResponse").map((block) => {
    const basic = xmlBlocks(block, "productBasicInfo")[0] ?? block;
    const img = xmlBlocks(block, "productImageInfo")[0] ?? "";
    const price = xmlBlocks(block, "productPriceInfo")[0] ?? "";
    return {
      style: xmlText(basic, "style"),
      brandName: xmlText(basic, "brandName"),
      productTitle: xmlText(basic, "productTitle"),
      productDescription: xmlText(basic, "productDescription"),
      category: xmlText(basic, "category"),
      color: xmlText(basic, "color"),
      catalogColor: xmlText(basic, "catalogColor"),
      size: xmlText(basic, "size"),
      sizeIndex: xmlText(basic, "sizeIndex"),
      availableSizes: xmlText(basic, "availableSizes"),
      inventoryKey: xmlText(basic, "inventoryKey"),
      uniqueKey: xmlText(basic, "uniqueKey"),
      caseSize: Number(xmlText(basic, "caseSize")) || 0,
      pieceWeight: Number(xmlText(basic, "pieceWeight")) || 0,
      productStatus: xmlText(basic, "productStatus"),
      colorProductImage: xmlText(img, "colorProductImage"),
      colorProductImageThumbnail: xmlText(img, "colorProductImageThumbnail"),
      colorSquareImage: xmlText(img, "colorSquareImage"),
      colorSwatchImage: xmlText(img, "colorSwatchImage"),
      productImage: xmlText(img, "productImage"),
      thumbnailImage: xmlText(img, "thumbnailImage"),
      frontModel: xmlText(img, "frontModel"),
      specSheet: xmlText(img, "specSheet"),
      piecePrice: sanitizeSupplierPrice(xmlText(price, "piecePrice")),
      casePrice: sanitizeSupplierPrice(xmlText(price, "casePrice")),
      pieceSalePrice: sanitizeSupplierPrice(xmlText(price, "pieceSalePrice")),
      caseSalePrice: sanitizeSupplierPrice(xmlText(price, "caseSalePrice")),
      priceText: xmlText(price, "priceText"),
    };
  });
}

export interface SmPricingEntry {
  style: string;
  color: string;
  size: string;
  inventoryKey: string;
  sizeIndex: string;
  piecePrice: number;
  casePrice: number;
  myPrice: number; // the shop's contracted cost — the number that matters
}

export function parsePricingResponse(xml: string): SmPricingEntry[] {
  return xmlBlocks(xml, "listResponse").map((block) => ({
    style: xmlText(block, "style"),
    color: xmlText(block, "color"),
    size: xmlText(block, "size"),
    inventoryKey: xmlText(block, "inventoryKey"),
    sizeIndex: xmlText(block, "sizeIndex"),
    piecePrice: sanitizeSupplierPrice(xmlText(block, "piecePrice")),
    casePrice: sanitizeSupplierPrice(xmlText(block, "casePrice")),
    myPrice: sanitizeSupplierPrice(xmlText(block, "myPrice")),
  }));
}

// --- Normaliser ------------------------------------------------------------------
//
// Groups the per-color×size product entries into the matchUiShape the frontend
// already consumes from ssLookupStyle/acLookupStyle: one colors[] entry per
// color with imageUrl + piecePrice/casePrice, a color-keyed priceMap, and the
// style-level fields. myPrice (when the pricing call succeeded) wins over the
// catalog piecePrice — it's the shop's actual cost.

export function buildMatchFromEntries(entries: SmProductEntry[], pricing: SmPricingEntry[], inventory: SmInventoryRow[] = []) {
  if (entries.length === 0) return null;
  const first = entries[0];

  // SanMar's productTitle conventionally ENDS with the style number
  // ("COMFORT COLORS Heavyweight Ring Spun Tee. 1717"), and the quote
  // editors' display header PREPENDS the style number — showing it
  // twice ("1717 - ... Tee. 1717", Joe 2026-07-20). Strip the trailing
  // style token (and the separator punctuation before it) once, here,
  // so every consumer gets a clean title.
  const escapedStyle = String(first.style || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const displayTitle = escapedStyle
    ? first.productTitle.replace(new RegExp(`[\\s.,-]*${escapedStyle}\\s*$`, "i"), "").trim()
    : first.productTitle;

  // Shop cost per color: cheapest myPrice across sizes (base sizes are the
  // cheapest; oversize upcharges are handled by the pricing engine, matching
  // how the S&S/AC integrations report a color's base piece price).
  const myPriceByColor: Record<string, number> = {};
  for (const p of pricing) {
    if (!p.color || !(p.myPrice > 0)) continue;
    if (!(p.color in myPriceByColor) || p.myPrice < myPriceByColor[p.color]) {
      myPriceByColor[p.color] = p.myPrice;
    }
  }

  const byColor = new Map<string, { entry: SmProductEntry; sizes: Set<string>; piece: number; pieceSale: number; casePrice: number; caseSale: number; sizePrices: Record<string, number>; sizeSalePrices: Record<string, number> }>();
  const sizeOrder: string[] = [];
  for (const e of entries) {
    if (!e.color) continue;
    let rec = byColor.get(e.color);
    if (!rec) {
      rec = { entry: e, sizes: new Set(), piece: 0, pieceSale: 0, casePrice: 0, caseSale: 0, sizePrices: {} as Record<string, number>, sizeSalePrices: {} as Record<string, number> };
      byColor.set(e.color, rec);
    }
    if (e.size) {
      rec.sizes.add(e.size);
      if (!sizeOrder.includes(e.size)) sizeOrder.push(e.size);
      // Per-size prices: entries arrive one per color×size, so this keeps
      // the 2XL+ upcharges the per-color cheapest below collapses away.
      if (e.piecePrice > 0) rec.sizePrices[e.size] = e.piecePrice;
      if (e.pieceSalePrice > 0) rec.sizeSalePrices[e.size] = e.pieceSalePrice;
    }
    // Cheapest catalog piece/case (and sale) price across the color's sizes.
    if (e.piecePrice > 0 && (rec.piece === 0 || e.piecePrice < rec.piece)) rec.piece = e.piecePrice;
    if (e.pieceSalePrice > 0 && (rec.pieceSale === 0 || e.pieceSalePrice < rec.pieceSale)) rec.pieceSale = e.pieceSalePrice;
    if (e.casePrice > 0 && (rec.casePrice === 0 || e.casePrice < rec.casePrice)) rec.casePrice = e.casePrice;
    if (e.caseSalePrice > 0 && (rec.caseSale === 0 || e.caseSalePrice < rec.caseSale)) rec.caseSale = e.caseSalePrice;
    // Prefer an entry that has a color image for the color's display record.
    if (!rec.entry.colorProductImage && e.colorProductImage) rec.entry = e;
  }

  // Inventory rows are keyed by CATALOG color; the UI keys everything by
  // color NAME. Translate via the product entries' own catalogColor.
  const catalogToName: Record<string, string> = {};
  for (const e of entries) {
    if (e.catalogColor && e.color && !(e.catalogColor in catalogToName)) catalogToName[e.catalogColor] = e.color;
  }
  const invByColorName: Record<string, Record<string, number>> = {};
  const warehouseMap: Record<string, Record<string, { code: string; qty: number }[]>> = {};
  for (const r of inventory) {
    const name = catalogToName[r.catalogColor] || r.catalogColor;
    (invByColorName[name] ??= {})[r.size] = r.qty;
    if (r.warehouses?.length) (warehouseMap[name] ??= {})[r.size] = r.warehouses;
  }

  const priceMap: Record<string, { piecePrice: number; casePrice: number }> = {};
  const colors = Array.from(byColor.entries()).map(([colorName, rec]) => {
    // Cost resolution (Joe 2026-07-20, reversed from the earlier order):
    // the STANDARD catalog piece price is the default garment cost. Sale
    // prices — and myPrice, which tracks the sale for standard accounts —
    // are transient: a quote printed after the sale ends would under-cost
    // the garment. Sale/myPrice remain only as fallbacks for entries
    // missing a catalog price.
    const piece = rec.piece || rec.pieceSale || myPriceByColor[colorName];
    const casePx = rec.casePrice || rec.caseSale;
    // Display-only sale preview (Joe 2026-07-20): expose the current sale
    // price ONLY when a genuine sale exists (below the standard price the
    // cost formula uses). The UI shows it as a hint next to Garment Cost;
    // it never feeds the cost calculation.
    const sale = rec.pieceSale > 0 && rec.pieceSale < piece ? rec.pieceSale : 0;
    if (piece > 0) {
      priceMap[colorName] = { piecePrice: piece, casePrice: casePx || piece, ...(sale ? { salePrice: sale } : {}) };
    }
    // A per-size "sale" at or above that size's standard price isn't a sale.
    const sizeSalePrices: Record<string, number> = {};
    for (const [sz, sp] of Object.entries(rec.sizeSalePrices)) {
      const std = rec.sizePrices[sz] || 0;
      if (sp > 0 && std > 0 && sp < std) sizeSalePrices[sz] = sp;
    }
    return {
      colorName,
      colorCode: rec.entry.catalogColor,
      sku: rec.entry.inventoryKey,
      piecePrice: piece,
      casePrice: casePx || piece,
      ...(sale ? { salePrice: sale } : {}),
      imageUrl: rec.entry.colorProductImage || rec.entry.productImage || "",
      sizeQuantities: invByColorName[colorName] || {},
      // Per-size standard prices — same channel S&S uses; the editors'
      // attach effect reads colors[].sizePrices so SanMar lines charge the
      // real 2XL+ upcharges instead of the flat cheapest piece price.
      ...(Object.keys(rec.sizePrices).length > 0 ? { sizePrices: rec.sizePrices } : {}),
      ...(Object.keys(sizeSalePrices).length > 0 ? { sizeSalePrices } : {}),
    };
  });

  const pieces = Object.values(priceMap).map((p) => p.piecePrice).filter(Boolean);
  // Style-level per-size map, same shape S&S emits (sizePriceMap[color][size]).
  const sizePriceMap: Record<string, Record<string, number>> = {};
  for (const c of colors) {
    if (c.sizePrices && Object.keys(c.sizePrices).length > 0) sizePriceMap[c.colorName] = c.sizePrices;
  }
  return {
    id: first.style,
    styleNumber: first.style,
    resolvedStyleNumber: first.style,
    productNumber: first.style,
    brandName: first.brandName || "SanMar",
    styleName: first.style,
    resolvedTitle: displayTitle,
    title: displayTitle,
    description: first.productDescription,
    categories: first.category ? [first.category] : [],
    styleCategory: first.category,
    styleImage: first.productImage || colors.find((c) => c.imageUrl)?.imageUrl || "",
    colors,
    inventoryMap: invByColorName,
    warehouseMap,
    sizes: sizeOrder,
    availableSizes: first.availableSizes,
    specSheet: first.specSheet,
    priceMap,
    sizePriceMap,
    piecePrice: pieces.length ? Math.min(...pieces) : 0,
  };
}

// --- Purchase Order submission (SanMar Standard PO SOAP service) ---------------
//
// Reconciled against the SanMar Purchase Order Integration Guide v24.3
// (Feb 2026), pp. 21–28 — the guide SanMar attached to their 2026-09-15 reply
// confirming PO integration + issuing TEST-environment credentials.
//
//   TEST:  https://test-ws.sanmar.com:8080/SanMarWebService/SanMarPOServicePort?wsdl
//   PROD:  https://ws.sanmar.com:8080/SanMarWebService/SanMarPOServicePort?wsdl
//   Operations: getPreSubmitInfo (stock check, does NOT order) and submitPO.
//   Auth: same sanMarCustomerNumber / sanMarUserName / sanMarUserPassword
//         <arg1> block as the product-data services (test env = separate creds).
//
// Rules from the guide that the builders below enforce:
//   • SanMar converts the SOAP PO into comma-delimited order files, so a comma
//     in ANY field corrupts the order — every field is comma-stripped (p.18/26).
//   • Char limits: poNum 28, shipTo (company) 28, shipAddress1/2 35, shipCity 28,
//     shipState 2, shipZip 5–10 digits (leading zeros required), shipMethod 15,
//     shipEmail 105, attention 35. notes/department/whseNo are "Leave Blank".
//   • A line is identified by inventoryKey + sizeIndex (recommended) OR by
//     style + color (SANMAR_MAINFRAME_COLOR) + size. We resolve keys via the
//     Product Info service first (resolveSmPoLines) and send the keys.
//   • Duplicate lines for the same product must be consolidated into ONE line
//     with the total qty (p.14) or SanMar may source from a warehouse with
//     insufficient stock → consolidateSmPoLines.
//   • Response: <return><errorOccurred>false</errorOccurred><message>PO
//     Submission successful</message></return>. NO PO number is echoed back —
//     the shop's poNum IS the reference.
//
// The smPlaceOrder edge function stays hard-gated OFF by the SANMAR_PO_ENABLED
// secret until SanMar has validated our TEST order and onboarded production.

export const SM_PO_SPEC = {
  // Endpoint port (joined onto smBase()).
  servicePort: "SanMarPOServicePort",
  // SOAP operations + their namespace.
  operation: "submitPO",
  preSubmitOperation: "getPreSubmitInfo",
  namespace: "http://webservice.integration.sanmar.com/",
  namespacePrefix: "web",
  // The response element that carries errorOccurred / message.
  responseTag: "return",
} as const;

// Ship methods SanMar accepts in <shipMethod> (guide p.9–10). Will-call pickup
// uses a warehouse code instead, but that requires "Warehouse Selection" to be
// enabled on the account — not part of our onboarding, so not listed.
export const SM_SHIP_METHODS = [
  "UPS",             // UPS Standard Ground (SanMar's default; free freight > $200)
  "UPS 2ND DAY",
  "UPS 2ND DAY AM",
  "UPS 3RD DAY",
  "UPS NEXT DAY",
  "UPS NEXT DAY EA",
  "UPS NEXT DAY SV",
  "UPS SATURDAY",
  "USPS PP",         // USPS Ground Advantage
  "USPS APP",        // USPS Priority Mail
  "PSST",            // Pack Separately Ship Together (decorator program — needs SanMar setup)
  "TRUCK",           // > 200 lb
] as const;

/**
 * Normalize an operator/app ship method to a SanMar <shipMethod> value.
 * Empty → "UPS" (SanMar ground). Common phrasings ("UPS Ground", "Ground",
 * "ups 2nd day") map onto the table; anything unrecognized returns "" so the
 * caller can REFUSE rather than silently reroute a real order.
 */
export function normalizeSmShipMethod(input: unknown): string {
  let m = String(input ?? "").toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!m) return "UPS";
  if (m === "GROUND" || m === "UPS GROUND" || m === "UPS STANDARD GROUND" || m === "UPS STANDARD") return "UPS";
  m = m.replace(/^UPS GROUND$/, "UPS");
  if (m.startsWith("UPS ")) {
    m = m
      .replace(/\b2ND DAY AIR\b/, "2ND DAY")
      .replace(/\bSECOND DAY\b/, "2ND DAY")
      .replace(/\bTHIRD DAY\b/, "3RD DAY")
      .replace(/\bNEXT DAY AIR\b/, "NEXT DAY")
      .replace(/\bNEXT DAY EARLY( AM)?\b/, "NEXT DAY EA")
      .replace(/\bNEXT DAY SAVER\b/, "NEXT DAY SV");
  }
  if (m === "USPS GROUND" || m === "USPS GROUND ADVANTAGE") m = "USPS PP";
  if (m === "USPS PRIORITY" || m === "USPS PRIORITY MAIL") m = "USPS APP";
  return (SM_SHIP_METHODS as readonly string[]).includes(m) ? m : "";
}

// Comma-strip + whitespace-collapse + truncate. Commas are SanMar's order-file
// delimiter (guide: "Do Not Use Additional Commas in any Field").
export function smPoField(v: unknown, max: number): string {
  return String(v ?? "").replace(/,/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * SanMar ZIP: 5 digits, 5+4 (with dash), or 9 digits; numbers only; leading
 * zeros must be preserved ("008054"-style inputs are padded to 5). Returns ""
 * when nothing usable remains so the caller can refuse.
 */
export function normalizeSmZip(zip: unknown): string {
  const raw = String(zip ?? "").trim();
  const m = raw.match(/^\s*(\d{1,5})(?:\s*-?\s*(\d{4}))?\s*$/);
  if (m) {
    const z5 = m[1].padStart(5, "0");
    return m[2] ? `${z5}-${m[2]}` : z5;
  }
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 9) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  if (digits.length >= 5 && digits.length <= 10) return digits;
  return "";
}

export interface SmPoShipTo {
  name: string;          // ship-to COMPANY name (<shipTo>, 28)
  address1: string;
  address2?: string;
  city: string;
  state: string;
  zip: string;
  email?: string;        // order confirmation + shipping notification (105)
  attention?: string;    // receiver's name (35); defaults to the PO number
  residence?: boolean | string; // Y/N — residential address (UPS surcharge)
  // Accepted from the PO page but NOT part of SanMar's schema:
  country?: string;
  phone?: string;
}

export interface SmPoLine {
  // Preferred SanMar identifiers (resolved server-side from style/color/size).
  inventoryKey?: string;
  sizeIndex?: string;
  // Human fallbacks — the schema accepts style + color + size INSTEAD of the
  // keys (color must be SanMar's mainframe color), used only when keys are absent.
  style?: string;
  catalogColor?: string;
  size?: string;
  quantity: number;
}

export interface SmPoRequest {
  poNumber: string;
  shipTo: SmPoShipTo;
  shipMethod?: string;
  // Internal PO notes. NOT sent — SanMar's <notes> is "Leave Blank" and the
  // shop's notes field is internal chatter anyway.
  notes?: string;
  lines: SmPoLine[];
}

function smLineOrderable(l: SmPoLine): boolean {
  if (!(Number(l.quantity) > 0)) return false;
  if (l.inventoryKey && l.sizeIndex) return true;
  return !!(l.style && l.catalogColor && l.size);
}

/**
 * Merge duplicate lines (same variant) into one with the summed qty — guide
 * p.14 "Duplicate Order Line Consolidation". Keyed by inventoryKey+sizeIndex
 * when resolved, else style|color|size. Unorderable lines are dropped (the
 * caller must have refused the order already if any line was unresolved).
 */
export function consolidateSmPoLines(lines: SmPoLine[]): SmPoLine[] {
  const out = new Map<string, SmPoLine>();
  for (const l of lines || []) {
    if (!smLineOrderable(l)) continue;
    const key = l.inventoryKey && l.sizeIndex
      ? `k:${l.inventoryKey}:${l.sizeIndex}`
      : `s:${String(l.style).toUpperCase()}|${String(l.catalogColor).toUpperCase()}|${String(l.size).toUpperCase()}`;
    const prev = out.get(key);
    if (prev) prev.quantity = (Number(prev.quantity) || 0) + (Number(l.quantity) || 0);
    else out.set(key, { ...l, quantity: Number(l.quantity) || 0 });
  }
  return [...out.values()];
}

// The <arg0> body shared by getPreSubmitInfo and submitPO (identical schema,
// guide pp.22–27). Element ORDER follows SanMar's sample requests.
function buildSmPoArg0(po: SmPoRequest): string {
  const s = po.shipTo;
  const residence = s.residence === true || String(s.residence ?? "").trim().toUpperCase() === "Y" ? "Y" : "N";
  const lineXml = consolidateSmPoLines(po.lines)
    .map((l) => {
      const keyed = !!(l.inventoryKey && l.sizeIndex);
      return `        <webServicePoDetailList>
          <inventoryKey>${keyed ? xmlEscape(String(l.inventoryKey)) : ""}</inventoryKey>
          <sizeIndex>${keyed ? xmlEscape(String(l.sizeIndex)) : ""}</sizeIndex>
          <style>${xmlEscape(smPoField(l.style || "", 60))}</style>
          <color>${keyed ? "" : xmlEscape(smPoField(l.catalogColor || "", 50))}</color>
          <size>${keyed ? "" : xmlEscape(smPoField(l.size || "", 50))}</size>
          <quantity>${Number(l.quantity) || 0}</quantity>
          <whseNo />
        </webServicePoDetailList>`;
    })
    .join("\n");
  return `      <arg0>
        <attention>${xmlEscape(smPoField(s.attention || po.poNumber, 35))}</attention>
        <notes />
        <poNum>${xmlEscape(smPoField(po.poNumber, 28))}</poNum>
        <shipTo>${xmlEscape(smPoField(s.name, 28))}</shipTo>
        <shipAddress1>${xmlEscape(smPoField(s.address1, 35))}</shipAddress1>
        <shipAddress2>${xmlEscape(smPoField(s.address2 || "", 35))}</shipAddress2>
        <shipCity>${xmlEscape(smPoField(s.city, 28))}</shipCity>
        <shipState>${xmlEscape(smPoField(s.state, 2).toUpperCase())}</shipState>
        <shipZip>${xmlEscape(normalizeSmZip(s.zip))}</shipZip>
        <shipMethod>${xmlEscape(smPoField(normalizeSmShipMethod(po.shipMethod) || po.shipMethod || "", 15))}</shipMethod>
        <shipEmail>${xmlEscape(smPoField(s.email || "", 105))}</shipEmail>
        <residence>${residence}</residence>
        <department />
${lineXml}
      </arg0>`;
}

function buildSmAuthArg1(creds: SmCreds): string {
  return `      <arg1>
        <sanMarCustomerNumber>${xmlEscape(creds.customerNumber)}</sanMarCustomerNumber>
        <sanMarUserName>${xmlEscape(creds.username)}</sanMarUserName>
        <sanMarUserPassword>${xmlEscape(creds.password)}</sanMarUserPassword>
      </arg1>`;
}

function wrapSmPoOperation(operation: string, creds: SmCreds, po: SmPoRequest): string {
  const p = SM_PO_SPEC.namespacePrefix;
  return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:${p}="${SM_PO_SPEC.namespace}">
  <soapenv:Header />
  <soapenv:Body>
    <${p}:${operation}>
${buildSmPoArg0(po)}
${buildSmAuthArg1(creds)}
    </${p}:${operation}>
  </soapenv:Body>
</soapenv:Envelope>`;
}

/** Build the submitPO envelope (guide p.27). Places a REAL order when sent to prod. */
export function buildSubmitPoEnvelope(creds: SmCreds, po: SmPoRequest): string {
  return wrapSmPoOperation(SM_PO_SPEC.operation, creds, po);
}

/** Build the getPreSubmitInfo envelope (guide p.23) — stock check only, never orders. */
export function buildPreSubmitInfoEnvelope(creds: SmCreds, po: SmPoRequest): string {
  return wrapSmPoOperation(SM_PO_SPEC.preSubmitOperation, creds, po);
}

export interface SmPoResult {
  success: boolean;
  poNumber: string;
  message: string;
}

/**
 * Parse the submitPO response (guide p.28): <return><errorOccurred>…</errorOccurred>
 * <message>PO Submission successful</message></return>. SanMar does not echo a
 * PO number; `poNumber` is filled only if a future schema adds one.
 */
export function parseSubmitPoResponse(xml: string): SmPoResult {
  if (!xml) return { success: false, poNumber: "", message: "Empty response from SanMar" };
  const ret = xmlBlocks(xml, SM_PO_SPEC.responseTag)[0] ?? xml;
  const errFlag = xmlText(ret, "errorOccurred") || xmlText(ret, "errorOccured") || xmlText(xml, "errorOccurred") || xmlText(xml, "errorOccured");
  const message = xmlText(ret, "message") || xmlText(xml, "message") || "";
  const poNumber = xmlText(ret, "poNum") || xmlText(ret, "poNumber") || "";
  return { success: errFlag !== "true", poNumber, message };
}

export interface SmPreSubmitLine {
  inventoryKey: string;
  sizeIndex: string;
  style: string;
  color: string;
  size: string;
  quantity: number;
  whseNo: string;   // warehouse number that will ship it (guide p.10/20 table)
  message: string;  // "Requested Quantity is confirmed and available in warehouse 'N'…" / not-in-stock
  ok: boolean;
}

export interface SmPreSubmitResult {
  ok: boolean;        // false when ANY line can't be filled from any warehouse
  message: string;    // top-level message (lists the short styles on failure)
  lines: SmPreSubmitLine[];
}

/**
 * Parse the getPreSubmitInfo response (guide pp.24–25). Top-level
 * errorOccurred=true means at least one line is not in stock anywhere; the
 * per-line errorOccured/message/whseNo say which and from where.
 */
export function parsePreSubmitInfoResponse(xml: string): SmPreSubmitResult {
  if (!xml) return { ok: false, message: "Empty response from SanMar", lines: [] };
  const ret = xmlBlocks(xml, SM_PO_SPEC.responseTag)[0] ?? xml;
  const topErr = xmlText(ret, "errorOccurred") || xmlText(ret, "errorOccured");
  const message = xmlText(ret, "message") || xmlText(ret, "internalMessage") || "";
  const lines = xmlBlocks(ret, "webServicePoDetailList").map((b) => {
    const err = xmlText(b, "errorOccured") || xmlText(b, "errorOccurred");
    return {
      inventoryKey: xmlText(b, "inventoryKey"),
      sizeIndex: xmlText(b, "sizeIndex"),
      style: xmlText(b, "style"),
      color: xmlText(b, "color"),
      size: xmlText(b, "size"),
      quantity: Number(xmlText(b, "quantity")) || 0,
      whseNo: xmlText(b, "whseNo"),
      message: xmlText(b, "message"),
      ok: err !== "true",
    };
  });
  return { ok: topErr !== "true" && lines.every((l) => l.ok), message, lines };
}

export interface SmResolveInput {
  style: string;
  color: string;
  size: string;
  quantity: number;
}

/**
 * Resolve human style/color/size lines to SanMar inventoryKey + sizeIndex via
 * the Product Info service (one SOAP call per style+color, cached). Shared by
 * the smPlaceOrder edge function and the test-order script so both order the
 * exact same way. Never guesses: a line that doesn't match a returned row
 * lands in `unresolved` and the caller must refuse the whole order.
 */
export async function resolveSmPoLines(
  creds: SmCreds,
  base: string,
  lines: SmResolveInput[],
  soapCall: typeof smSoapCall = smSoapCall,
  ctx = "sanmar:resolve",
): Promise<{ resolved: SmPoLine[]; unresolved: string[] }> {
  const infoCache: Record<string, ReturnType<typeof parseProductInfoResponse>> = {};
  const resolved: SmPoLine[] = [];
  const unresolved: string[] = [];
  for (const l of lines) {
    const style = String(l.style || "").trim();
    const color = String(l.color || "").trim();
    const size = String(l.size || "").trim();
    const qty = Number(l.quantity) || 0;
    if (!style || qty <= 0) {
      unresolved.push(`${style || "?"} ${color} ${size}`.trim());
      continue;
    }
    // Cache by style+color, NOT style alone: the Product Info query is
    // color-filtered, so a second line of the same style in a DIFFERENT color
    // would hit a cache holding only the first color's rows and falsely fail.
    const infoKey = `${style.toUpperCase()}::${color.toUpperCase()}`;
    if (!infoCache[infoKey]) {
      const res = await soapCall(`${base}/SanMarProductInfoServicePort`, buildProductInfoEnvelope(creds, style, color), ctx);
      infoCache[infoKey] = res.ok ? parseProductInfoResponse(res.xml) : [];
    }
    const match = infoCache[infoKey].find(
      (r) =>
        r.size.toUpperCase() === size.toUpperCase() &&
        (r.color.toUpperCase() === color.toUpperCase() || r.catalogColor.toUpperCase() === color.toUpperCase()),
    );
    if (match?.inventoryKey && match?.sizeIndex) {
      resolved.push({ inventoryKey: match.inventoryKey, sizeIndex: match.sizeIndex, style, catalogColor: match.catalogColor, size, quantity: qty });
    } else {
      unresolved.push(`${style} ${color} ${size}`.trim());
    }
  }
  return { resolved, unresolved };
}
