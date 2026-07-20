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

export function buildMatchFromEntries(entries: SmProductEntry[], pricing: SmPricingEntry[]) {
  if (entries.length === 0) return null;
  const first = entries[0];

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

  const byColor = new Map<string, { entry: SmProductEntry; sizes: Set<string>; piece: number; pieceSale: number; casePrice: number; caseSale: number }>();
  const sizeOrder: string[] = [];
  for (const e of entries) {
    if (!e.color) continue;
    let rec = byColor.get(e.color);
    if (!rec) {
      rec = { entry: e, sizes: new Set(), piece: 0, pieceSale: 0, casePrice: 0, caseSale: 0 };
      byColor.set(e.color, rec);
    }
    if (e.size) {
      rec.sizes.add(e.size);
      if (!sizeOrder.includes(e.size)) sizeOrder.push(e.size);
    }
    // Cheapest catalog piece/case (and sale) price across the color's sizes.
    if (e.piecePrice > 0 && (rec.piece === 0 || e.piecePrice < rec.piece)) rec.piece = e.piecePrice;
    if (e.pieceSalePrice > 0 && (rec.pieceSale === 0 || e.pieceSalePrice < rec.pieceSale)) rec.pieceSale = e.pieceSalePrice;
    if (e.casePrice > 0 && (rec.casePrice === 0 || e.casePrice < rec.casePrice)) rec.casePrice = e.casePrice;
    if (e.caseSalePrice > 0 && (rec.caseSale === 0 || e.caseSalePrice < rec.caseSale)) rec.caseSale = e.caseSalePrice;
    // Prefer an entry that has a color image for the color's display record.
    if (!rec.entry.colorProductImage && e.colorProductImage) rec.entry = e;
  }

  const priceMap: Record<string, { piecePrice: number; casePrice: number }> = {};
  const colors = Array.from(byColor.entries()).map(([colorName, rec]) => {
    // Cost resolution: myPrice (the shop's contracted cost, from the
    // Pricing service) → catalog SALE piece price → catalog piece price.
    // The parser always captured pieceSalePrice but the old chain skipped
    // it — an account without myPrice was quoted the full original price
    // even while SanMar had the style on sale (Joe's 1717 check,
    // 2026-07-20: site said $6.34 sale, fallback said $8.62).
    const piece = myPriceByColor[colorName] || rec.pieceSale || rec.piece;
    const casePx = rec.caseSale || rec.casePrice;
    if (piece > 0) priceMap[colorName] = { piecePrice: piece, casePrice: casePx || piece };
    return {
      colorName,
      colorCode: rec.entry.catalogColor,
      sku: rec.entry.inventoryKey,
      piecePrice: piece,
      casePrice: casePx || piece,
      imageUrl: rec.entry.colorProductImage || rec.entry.productImage || "",
      sizeQuantities: {}, // live inventory is a later phase (SanMar Product Inventory Service)
    };
  });

  const pieces = Object.values(priceMap).map((p) => p.piecePrice).filter(Boolean);
  return {
    id: first.style,
    styleNumber: first.style,
    resolvedStyleNumber: first.style,
    productNumber: first.style,
    brandName: first.brandName || "SanMar",
    styleName: first.style,
    resolvedTitle: first.productTitle,
    title: first.productTitle,
    description: first.productDescription,
    categories: first.category ? [first.category] : [],
    styleCategory: first.category,
    styleImage: first.productImage || colors.find((c) => c.imageUrl)?.imageUrl || "",
    colors,
    sizes: sizeOrder,
    availableSizes: first.availableSizes,
    specSheet: first.specSheet,
    priceMap,
    piecePrice: pieces.length ? Math.min(...pieces) : 0,
  };
}
