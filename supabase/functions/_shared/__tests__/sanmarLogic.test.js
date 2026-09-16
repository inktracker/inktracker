import { describe, it, expect } from "vitest";
import {
  xmlEscape,
  xmlUnescape,
  xmlBlocks,
  xmlText,
  buildProductInfoEnvelope,
  buildPricingEnvelope,
  parseProductInfoResponse,
  parsePricingResponse,
  buildMatchFromEntries,
  buildInventoryEnvelope,
  parseInventoryResponse,
  buildSubmitPoEnvelope,
  buildPreSubmitInfoEnvelope,
  parseSubmitPoResponse,
  parsePreSubmitInfoResponse,
  normalizeSmZip,
  normalizeSmShipMethod,
  SM_PO_SPEC,
  SM_TEST_BASE,
} from "../sanmar.ts";

// Fixture XML lifted from the SanMar Web Services Integration Guide v24.3
// getProductInfoByStyleColorSize sample (PC61), trimmed to the fields we
// parse. Two colors × two sizes. Note "Port &amp; Co" — entity handling is
// part of what these tests lock down, and "errorOccured" is SanMar's actual
// (misspelled) field name.
function entry(color, size, piece, casePrice, img) {
  return `<listResponse>
    <productBasicInfo>
      <availableSizes>Adult Sizes: S-6XL</availableSizes>
      <brandName>Port &amp; Company</brandName>
      <caseSize>72</caseSize>
      <catalogColor>${color}</catalogColor>
      <color>${color}</color>
      <inventoryKey>11803</inventoryKey>
      <pieceWeight>0.38</pieceWeight>
      <productDescription>A year-round essential, our best-selling t-shirt.</productDescription>
      <productStatus>Active</productStatus>
      <productTitle>Port &amp; Co - Essential Tee. PC61</productTitle>
      <size>${size}</size>
      <sizeIndex>2</sizeIndex>
      <style>PC61</style>
      <uniqueKey>118032</uniqueKey>
      <category>T-Shirts</category>
    </productBasicInfo>
    <productImageInfo>
      <colorProductImage>${img}</colorProductImage>
      <colorSquareImage>https://cdnm.sanmar.com/swatch/gifs/port_${color.toLowerCase()}.gif</colorSquareImage>
      <productImage>https://cdnm.sanmar.com/catalog/images/PC61.jpg</productImage>
      <thumbnailImage>https://cdnm.sanmar.com/catalog/images/PC61TN.jpg</thumbnailImage>
      <specSheet>https://www.apparelvideos.com/specsheet/PC61_specsheet.pdf</specSheet>
    </productImageInfo>
    <productPriceInfo>
      <casePrice>${casePrice}</casePrice>
      <dozenPrice>${piece}</dozenPrice>
      <piecePrice>${piece}</piecePrice>
      <priceCode>A/P</priceCode>
      <priceText>Price applies to sizes S-XL</priceText>
    </productPriceInfo>
  </listResponse>`;
}

const PRODUCT_INFO_XML = `<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/">
  <S:Body>
    <ns2:getProductInfoByStyleColorSizeResponse xmlns:ns2="http://impl.webservice.integration.sanmar.com/">
      <return>
        <errorOccured>false</errorOccured>
        ${entry("White", "S", "3.84", "2.84", "https://cdnm.sanmar.com/imglib/PC61_white.jpg")}
        ${entry("White", "M", "3.84", "2.84", "https://cdnm.sanmar.com/imglib/PC61_white.jpg")}
        ${entry("Black", "S", "4.12", "3.02", "https://cdnm.sanmar.com/imglib/PC61_black.jpg")}
        ${entry("Black", "M", "4.12", "3.02", "https://cdnm.sanmar.com/imglib/PC61_black.jpg")}
        <message>Product Info sent successfully.</message>
      </return>
    </ns2:getProductInfoByStyleColorSizeResponse>
  </S:Body>
</S:Envelope>`;

const PRICING_XML = `<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/">
  <S:Body>
    <ns2:getPricingResponse xmlns:ns2="http://impl.webservice.integration.sanmar.com/">
      <return>
        <errorOccured>false</errorOccured>
        <listResponse>
          <casePrice>2.84</casePrice>
          <color>White</color>
          <inventoryKey>11803</inventoryKey>
          <myPrice>2.41</myPrice>
          <piecePrice>3.84</piecePrice>
          <size>S</size>
          <sizeIndex>2</sizeIndex>
          <style>PC61</style>
        </listResponse>
        <listResponse>
          <casePrice>3.02</casePrice>
          <color>Black</color>
          <inventoryKey>11804</inventoryKey>
          <myPrice>2.58</myPrice>
          <piecePrice>4.12</piecePrice>
          <size>S</size>
          <sizeIndex>2</sizeIndex>
          <style>PC61</style>
        </listResponse>
        <message>Pricing returned successfully</message>
      </return>
    </ns2:getPricingResponse>
  </S:Body>
</S:Envelope>`;

describe("XML helpers", () => {
  it("escape/unescape round-trip covers the five XML entities", () => {
    const raw = `Port & Co <"tees"> 'sale'`;
    expect(xmlUnescape(xmlEscape(raw))).toBe(raw);
  });

  it("xmlBlocks pulls every repeated element, ignoring namespace prefixes", () => {
    expect(xmlBlocks(PRODUCT_INFO_XML, "listResponse")).toHaveLength(4);
    expect(xmlBlocks("<ns2:x><a>1</a></ns2:x><ns2:x><a>2</a></ns2:x>", "x")).toHaveLength(2);
  });

  it("xmlText returns the first match, unescaped, and '' when absent", () => {
    expect(xmlText("<brandName>Port &amp; Company</brandName>", "brandName")).toBe("Port & Company");
    expect(xmlText("<a>1</a>", "missing")).toBe("");
  });
});

describe("SOAP envelopes", () => {
  const creds = { customerNumber: "12345", username: "shop", password: "p<w&d" };

  it("carries auth in arg1 and the style in arg0, with special characters escaped", () => {
    const env = buildProductInfoEnvelope(creds, "PC61");
    expect(env).toContain("<impl:getProductInfoByStyleColorSize>");
    expect(env).toContain("<style>PC61</style>");
    expect(env).toContain("<sanMarCustomerNumber>12345</sanMarCustomerNumber>");
    expect(env).toContain("<sanMarUserPassword>p&lt;w&amp;d</sanMarUserPassword>");
    expect(env).not.toContain("p<w&d");
  });

  it("includes color/size only when provided", () => {
    expect(buildProductInfoEnvelope(creds, "PC61")).not.toContain("<color>");
    expect(buildProductInfoEnvelope(creds, "PC61", "White", "S")).toContain("<color>White</color>");
    expect(buildPricingEnvelope(creds, "PC61")).toContain("<impl:getPricing>");
  });
});

describe("parseProductInfoResponse", () => {
  it("parses one entry per color×size with unescaped text and numeric prices", () => {
    const entries = parseProductInfoResponse(PRODUCT_INFO_XML);
    expect(entries).toHaveLength(4);
    const first = entries[0];
    expect(first.style).toBe("PC61");
    expect(first.brandName).toBe("Port & Company");
    expect(first.productTitle).toBe("Port & Co - Essential Tee. PC61");
    expect(first.color).toBe("White");
    expect(first.size).toBe("S");
    expect(first.piecePrice).toBe(3.84);
    expect(first.casePrice).toBe(2.84);
    expect(first.colorProductImage).toContain("PC61_white.jpg");
    expect(first.category).toBe("T-Shirts");
  });

  it("returns [] for an empty/failed response body", () => {
    expect(parseProductInfoResponse("<S:Envelope></S:Envelope>")).toEqual([]);
  });
});

describe("parsePricingResponse", () => {
  it("extracts myPrice (the shop's contracted cost) per color/size", () => {
    const rows = parsePricingResponse(PRICING_XML);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ color: "White", myPrice: 2.41, piecePrice: 3.84 });
    expect(rows[1]).toMatchObject({ color: "Black", myPrice: 2.58 });
  });
});

describe("buildMatchFromEntries", () => {
  const entries = parseProductInfoResponse(PRODUCT_INFO_XML);
  const pricing = parsePricingResponse(PRICING_XML);

  it("groups color×size entries into one colors[] record per color", () => {
    const match = buildMatchFromEntries(entries, pricing);
    expect(match.styleNumber).toBe("PC61");
    expect(match.brandName).toBe("Port & Company");
    expect(match.colors).toHaveLength(2);
    expect(match.sizes).toEqual(["S", "M"]);
    const white = match.colors.find((c) => c.colorName === "White");
    expect(white.imageUrl).toContain("PC61_white.jpg");
  });

  it("uses the STANDARD catalog piecePrice as the default cost (Joe 2026-07-20; myPrice is fallback-only)", () => {
    const match = buildMatchFromEntries(entries, pricing);
    // Catalog piecePrice for White is 3.84 (myPrice 2.41 exists but is
    // transient — it tracks sales on standard accounts).
    expect(match.priceMap.White.piecePrice).toBe(3.84);
    expect(match.priceMap.Black.piecePrice).toBe(4.12);
    expect(match.piecePrice).toBe(3.84); // style-level = cheapest color
  });

  it("falls back to catalog piecePrice when the pricing call returned nothing", () => {
    const match = buildMatchFromEntries(entries, []);
    expect(match.priceMap.White.piecePrice).toBe(3.84);
    expect(match.priceMap.Black.piecePrice).toBe(4.12);
  });

  it("returns null for zero entries (style not found)", () => {
    expect(buildMatchFromEntries([], [])).toBeNull();
  });

  it("produces a shape isStyleEnriched accepts downstream (image + cost present)", () => {
    const match = buildMatchFromEntries(entries, pricing);
    expect(match.styleImage).toBeTruthy();
    expect(Object.keys(match.priceMap).length).toBeGreaterThan(0);
    // matchUiShape parity with ss/ac lookups — the fields normalizeSupplierMatch reads.
    expect(match).toHaveProperty("colors");
    expect(match.colors[0]).toHaveProperty("colorName");
    expect(match.colors[0]).toHaveProperty("imageUrl");
    expect(match.colors[0]).toHaveProperty("piecePrice");
    expect(match).toHaveProperty("description");
    expect(match).toHaveProperty("sizes");
  });
});

// Pricing default (Joe 2026-07-20, final direction after the live 1717
// check): the STANDARD catalog piece price is the default garment cost.
// Sale prices — and myPrice, which tracks the sale on standard accounts —
// are transient: a quote printed after the sale ends would under-cost
// the garment. Sale/myPrice are only fallbacks for missing catalog rows.
describe("buildMatchFromEntries — standard price is the default", () => {
  const saleEntries = [
    {
      style: "1717", brandName: "Comfort Colors", productTitle: "CC 1717",
      productDescription: "tee", category: "T-Shirts", availableSizes: "S-3XL",
      color: "Bay", catalogColor: "Bay", inventoryKey: "k1", size: "S", sizeIndex: "2",
      piecePrice: 8.62, casePrice: 8.62, pieceSalePrice: 6.34, caseSalePrice: 6.34,
      priceText: "", colorProductImage: "https://x/img.jpg", productImage: "", specSheet: "",
      uniqueKey: "u1", pieceWeight: "0.42", caseSize: "60", productStatus: "Active",
    },
  ];

  it("standard catalog price wins even during a sale", () => {
    const match = buildMatchFromEntries(saleEntries, []);
    expect(match.colors[0].piecePrice).toBe(8.62);
    expect(match.priceMap.Bay.piecePrice).toBe(8.62);
    expect(match.colors[0].casePrice).toBe(8.62);
  });

  it("standard price wins over myPrice too (myPrice tracks the sale)", () => {
    const pricing = [{ style: "1717", color: "Bay", size: "S", sizeIndex: "2", inventoryKey: "k1", piecePrice: 8.62, casePrice: 8.62, myPrice: 6.34 }];
    const match = buildMatchFromEntries(saleEntries, pricing);
    expect(match.colors[0].piecePrice).toBe(8.62);
  });

  it("sale price is only a fallback when the catalog row is missing a price", () => {
    const noCatalog = [{ ...saleEntries[0], piecePrice: 0, casePrice: 0 }];
    const match = buildMatchFromEntries(noCatalog, []);
    expect(match.colors[0].piecePrice).toBe(6.34);
  });
});

// Inventory service (guide v24.4 pp.50–54) — flat positional args under
// the web: namespace, catalog-color keyed response, per-warehouse qty.
describe("inventory: envelope + parse + mapping", () => {
  const creds = { customerNumber: "12345", username: "shop", password: "pw" };

  it("builds the positional-arg envelope; color/size args only when given", () => {
    const env = buildInventoryEnvelope(creds, "1717");
    expect(env).toContain("<web:getInventoryQtyForStyleColorSize>");
    expect(env).toContain("<arg0>12345</arg0>");
    expect(env).toContain("<arg3>1717</arg3>");
    expect(env).not.toContain("<arg4>");
    expect(buildInventoryEnvelope(creds, "1717", "Bay", "L")).toContain("<arg4>Bay</arg4>");
  });

  const INVENTORY_XML = `<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/">
  <S:Body>
    <ns2:getInventoryQtyForStyleColorSizeResponse xmlns:ns2="http://webservice.integration.sanmar.com/">
      <return>
        <errorOccured>false</errorOccured>
        <message>Inventory returned successfully</message>
        <response><style>1717</style><skus>
          <sku><color>BAY</color><size>S</size>
            <whse><whseID>4</whseID><whseName>Reno</whseName><qty>974</qty></whse>
            <whse><whseID>12</whseID><whseName>Phoenix</whseName><qty>1369</qty></whse>
          </sku>
          <sku><color>BAY</color><size>2XL</size>
            <whse><whseID>4</whseID><whseName>Reno</whseName><qty>362</qty></whse>
          </sku>
        </skus></response>
      </return>
    </ns2:getInventoryQtyForStyleColorSizeResponse>
  </S:Body>
</S:Envelope>`;

  it("parses sku rows and sums quantities across warehouses (+ keeps per-DC breakdown)", () => {
    const rows = parseInventoryResponse(INVENTORY_XML);
    expect(rows).toMatchObject([
      { catalogColor: "BAY", size: "S", qty: 2343 },
      { catalogColor: "BAY", size: "2XL", qty: 362 },
    ]);
    // Per-warehouse breakdown is now retained alongside the summed qty.
    expect(Array.isArray(rows[0].warehouses)).toBe(true);
    expect(rows[0].warehouses.reduce((a, w) => a + w.qty, 0)).toBe(2343);
  });

  it("error responses parse to an empty list", () => {
    const err = INVENTORY_XML.replace("<errorOccured>false</errorOccured>", "<errorOccured>true</errorOccured>");
    expect(parseInventoryResponse(err)).toEqual([]);
  });

  it("buildMatchFromEntries maps catalog-color inventory onto color NAMES", () => {
    const entries = [{
      style: "1717", brandName: "Comfort Colors", productTitle: "CC 1717",
      productDescription: "tee", category: "T-Shirts", availableSizes: "S-3XL",
      color: "Bay", catalogColor: "BAY", inventoryKey: "k1", size: "S", sizeIndex: "2",
      piecePrice: 8.62, casePrice: 8.62, pieceSalePrice: 0, caseSalePrice: 0,
      priceText: "", colorProductImage: "https://x/img.jpg", productImage: "", specSheet: "",
      uniqueKey: "u1", pieceWeight: "0.42", caseSize: "60", productStatus: "Active",
    }];
    const inventory = parseInventoryResponse(INVENTORY_XML);
    const match = buildMatchFromEntries(entries, [], inventory);
    expect(match.colors[0].sizeQuantities).toEqual({ S: 2343, "2XL": 362 });
    expect(match.inventoryMap.Bay).toEqual({ S: 2343, "2XL": 362 });
  });
});

// Sale-price PREVIEW (Joe 2026-07-20): salePrice is exposed for display
// only — the cost fields (piecePrice) stay on the standard price. Only a
// genuine sale (below standard) is emitted, so the UI badge can't show
// "sales" that equal or exceed the normal price.
describe("buildMatchFromEntries — salePrice preview field", () => {
  const base = {
    style: "1717", brandName: "Comfort Colors", productTitle: "CC 1717",
    productDescription: "tee", category: "T-Shirts", availableSizes: "S-3XL",
    color: "Bay", catalogColor: "BAY", inventoryKey: "k1", size: "S", sizeIndex: "2",
    priceText: "", colorProductImage: "https://x/img.jpg", productImage: "", specSheet: "",
    uniqueKey: "u1", pieceWeight: "0.42", caseSize: "60", productStatus: "Active",
  };

  it("on sale: salePrice exposed, cost stays standard", () => {
    const match = buildMatchFromEntries([{ ...base, piecePrice: 8.62, casePrice: 8.62, pieceSalePrice: 6.34, caseSalePrice: 6.34 }], []);
    expect(match.colors[0].piecePrice).toBe(8.62);
    expect(match.colors[0].salePrice).toBe(6.34);
    expect(match.priceMap.Bay.salePrice).toBe(6.34);
  });

  it("no sale: salePrice absent entirely", () => {
    const match = buildMatchFromEntries([{ ...base, piecePrice: 8.62, casePrice: 8.62, pieceSalePrice: 0, caseSalePrice: 0 }], []);
    expect(match.colors[0].salePrice).toBeUndefined();
    expect(match.priceMap.Bay.salePrice).toBeUndefined();
  });

  it("'sale' at or above standard is not a sale — absent", () => {
    const match = buildMatchFromEntries([{ ...base, piecePrice: 8.62, casePrice: 8.62, pieceSalePrice: 8.62, caseSalePrice: 8.62 }], []);
    expect(match.colors[0].salePrice).toBeUndefined();
  });
});

// Title dedup (Joe 2026-07-20): SanMar titles end with the style number
// and the quote header prepends it — "1717 - ... Tee. 1717". Stripped
// once at normalization so every consumer gets a clean title.
describe("buildMatchFromEntries — trailing style stripped from titles", () => {
  const entry = (productTitle, style = "1717") => [{
    style, brandName: "Comfort Colors", productTitle,
    productDescription: "tee", category: "T-Shirts", availableSizes: "S-3XL",
    color: "Bay", catalogColor: "BAY", inventoryKey: "k1", size: "S", sizeIndex: "2",
    piecePrice: 8.62, casePrice: 8.62, pieceSalePrice: 0, caseSalePrice: 0,
    priceText: "", colorProductImage: "https://x/img.jpg", productImage: "", specSheet: "",
    uniqueKey: "u1", pieceWeight: "0.42", caseSize: "60", productStatus: "Active",
  }];

  it("strips '. 1717' from the tail (separator punctuation included)", () => {
    const m = buildMatchFromEntries(entry("COMFORT COLORS Heavyweight Ring Spun Tee. 1717"), []);
    expect(m.title).toBe("COMFORT COLORS Heavyweight Ring Spun Tee");
    expect(m.resolvedTitle).toBe("COMFORT COLORS Heavyweight Ring Spun Tee");
  });

  it("leaves titles without the trailing style untouched", () => {
    const m = buildMatchFromEntries(entry("Heavyweight Ring Spun Tee"), []);
    expect(m.title).toBe("Heavyweight Ring Spun Tee");
  });

  it("only strips at the END — a style number mid-title survives", () => {
    const m = buildMatchFromEntries(entry("1717 Series Heavyweight Tee"), []);
    expect(m.title).toBe("1717 Series Heavyweight Tee");
  });
});

// Per-size prices (Joe 2026-07-20): the per-color record collapses to the
// cheapest size, which lost 2XL+ upcharges — clicking a sale price (or even
// standard SanMar pricing) charged a 2XL like a Small. Entries arrive one
// per color×size, so per-size standard and sale prices are now emitted on
// colors[].sizePrices / colors[].sizeSalePrices plus a style-level
// sizePriceMap in the same shape ssLookupStyle uses.
describe("buildMatchFromEntries — per-size prices (2XL+ upcharges)", () => {
  const mk = (size, piece, sale) => ({
    style: "1717", brandName: "Comfort Colors", productTitle: "CC 1717",
    productDescription: "tee", category: "T-Shirts", availableSizes: "S-3XL",
    color: "Bay", catalogColor: "Bay", inventoryKey: "k1", size, sizeIndex: "2",
    piecePrice: piece, casePrice: piece, pieceSalePrice: sale, caseSalePrice: sale,
    priceText: "", colorProductImage: "https://x/img.jpg", productImage: "", specSheet: "",
    uniqueKey: "u1", pieceWeight: "0.42", caseSize: "60", productStatus: "Active",
  });
  const entries = [mk("S", 8.62, 6.34), mk("2XL", 10.62, 8.10), mk("3XL", 11.62, 0)];

  it("emits per-size standard prices on the color", () => {
    const match = buildMatchFromEntries(entries, []);
    expect(match.colors[0].sizePrices).toEqual({ S: 8.62, "2XL": 10.62, "3XL": 11.62 });
  });

  it("emits per-size sale prices only where a genuine sale exists", () => {
    const match = buildMatchFromEntries(entries, []);
    expect(match.colors[0].sizeSalePrices).toEqual({ S: 6.34, "2XL": 8.10 });
  });

  it("drops a per-size 'sale' at or above that size's standard price", () => {
    const match = buildMatchFromEntries([mk("S", 8.62, 8.62)], []);
    expect(match.colors[0].sizeSalePrices).toBeUndefined();
  });

  it("emits the style-level sizePriceMap in the ssLookupStyle shape", () => {
    const match = buildMatchFromEntries(entries, []);
    expect(match.sizePriceMap.Bay).toEqual({ S: 8.62, "2XL": 10.62, "3XL": 11.62 });
  });

  it("keeps the per-color piecePrice as the cheapest (base) size", () => {
    const match = buildMatchFromEntries(entries, []);
    expect(match.colors[0].piecePrice).toBe(8.62);
    expect(match.colors[0].salePrice).toBe(6.34);
  });
});

describe("PO submission — buildSubmitPoEnvelope (PO guide v24.5 pp.26–27)", () => {
  const creds = { customerNumber: "12345", username: "shop", password: "p<w&d" };
  const po = {
    poNumber: "ORD-2026-XYZ",
    shipTo: {
      name: "Summit Screen & Print",
      address1: "100 Main St",
      address2: "Ste 4",
      city: "Reno",
      state: "nv",
      zip: "89501",
      email: "orders@summit.example",
      country: "US",
    },
    shipMethod: "UPS Ground",
    notes: "leave at dock",
    lines: [
      { inventoryKey: "11803", sizeIndex: "3", quantity: 12, style: "PC61", catalogColor: "White", size: "M" },
      { inventoryKey: "11804", sizeIndex: "4", quantity: 6, style: "PC61", catalogColor: "White", size: "L" },
    ],
  };

  it("wraps the submitPO operation in SanMar's namespace with arg0 (order) + arg1 (auth)", () => {
    const env = buildSubmitPoEnvelope(creds, po);
    expect(env).toContain(`<${SM_PO_SPEC.namespacePrefix}:submitPO>`);
    expect(env).toContain('xmlns:web="http://webservice.integration.sanmar.com/"');
    expect(env.indexOf("<arg0>")).toBeLessThan(env.indexOf("<arg1>"));
    expect(env).toContain("<sanMarCustomerNumber>12345</sanMarCustomerNumber>");
    expect(env).toContain("<sanMarUserPassword>p&lt;w&amp;d</sanMarUserPassword>");
  });

  it("uses the guide's exact ship-to element names", () => {
    const env = buildSubmitPoEnvelope(creds, po);
    expect(env).toContain("<poNum>ORD-2026-XYZ</poNum>");
    expect(env).toContain("<shipTo>Summit Screen &amp; Print</shipTo>");
    expect(env).toContain("<shipAddress1>100 Main St</shipAddress1>");
    expect(env).toContain("<shipAddress2>Ste 4</shipAddress2>");
    expect(env).toContain("<shipCity>Reno</shipCity>");
    expect(env).toContain("<shipState>NV</shipState>");
    expect(env).toContain("<shipZip>89501</shipZip>");
    expect(env).toContain("<shipEmail>orders@summit.example</shipEmail>");
    expect(env).toContain("<residence>N</residence>");
    expect(env).toContain("<department />");
    // No invented elements from the pre-guide draft
    expect(env).not.toContain("<shipToName>");
    expect(env).not.toContain("<shipToCountry>");
    expect(env).not.toContain("<lineItem>");
  });

  it("maps 'UPS Ground' to SanMar's 'UPS' ship method and defaults empty to UPS", () => {
    expect(buildSubmitPoEnvelope(creds, po)).toContain("<shipMethod>UPS</shipMethod>");
    expect(buildSubmitPoEnvelope(creds, { ...po, shipMethod: "" })).toContain("<shipMethod>UPS</shipMethod>");
    expect(buildSubmitPoEnvelope(creds, { ...po, shipMethod: "ups 2nd day" })).toContain("<shipMethod>UPS 2ND DAY</shipMethod>");
  });

  it("emits one webServicePoDetailList per variant with inventoryKey+sizeIndex+quantity and blank whseNo", () => {
    const env = buildSubmitPoEnvelope(creds, po);
    expect(env.match(/<webServicePoDetailList>/g)).toHaveLength(2);
    expect(env).toContain("<inventoryKey>11803</inventoryKey>");
    expect(env).toContain("<sizeIndex>3</sizeIndex>");
    expect(env).toContain("<quantity>12</quantity>");
    expect(env).toContain("<whseNo />");
    // keyed lines leave color/size empty so a catalog-vs-mainframe color name can't conflict
    expect(env).toContain("<color></color>");
  });

  it("falls back to style+color+size for a line without keys, and drops lines that have neither", () => {
    const env = buildSubmitPoEnvelope(creds, {
      ...po,
      lines: [
        { inventoryKey: "11803", sizeIndex: "3", quantity: 12 },
        { style: "PC61", catalogColor: "Black", size: "XL", quantity: 4 }, // style/color/size → allowed by schema
        { style: "PC61", size: "XL", quantity: 4 }, // no color, no keys → excluded
      ],
    });
    expect(env.match(/<webServicePoDetailList>/g)).toHaveLength(2);
    expect(env).toContain("<color>Black</color>");
    expect(env).toContain("<size>XL</size>");
  });

  it("consolidates duplicate variant lines into one summed line (guide p.14)", () => {
    const env = buildSubmitPoEnvelope(creds, {
      ...po,
      lines: [
        { inventoryKey: "11803", sizeIndex: "3", quantity: 10 },
        { inventoryKey: "11803", sizeIndex: "3", quantity: 10 },
      ],
    });
    expect(env.match(/<webServicePoDetailList>/g)).toHaveLength(1);
    expect(env).toContain("<quantity>20</quantity>");
  });

  it("NEVER sends the shop's internal notes — SanMar's notes field is 'leave blank'", () => {
    const env = buildSubmitPoEnvelope(creds, { ...po, notes: "call Dave, he's a & b <tag>" });
    expect(env).toContain("<notes />");
    expect(env).not.toContain("call Dave");
  });

  it("strips commas (SanMar's order-file delimiter) and enforces char limits", () => {
    const env = buildSubmitPoEnvelope(creds, {
      ...po,
      poNumber: "PO,with,commas-" + "X".repeat(40),
      shipTo: { ...po.shipTo, name: "Summit, Inc.", address1: "100 Main St, Building 7, Rear Dock Entrance" },
    });
    expect(env).toMatch(/<poNum>PO with commas-X{13}<\/poNum>/); // 28 max
    expect(env).toContain("<shipTo>Summit Inc.</shipTo>");
    expect(env).toContain(`<shipAddress1>${"100 Main St Building 7 Rear Dock Entrance".slice(0, 35).trim()}</shipAddress1>`); // 35 max
  });

  it("attention defaults to the PO number; residence Y when flagged", () => {
    const env = buildSubmitPoEnvelope(creds, { ...po, shipTo: { ...po.shipTo, residence: true } });
    expect(env).toContain("<attention>ORD-2026-XYZ</attention>");
    expect(env).toContain("<residence>Y</residence>");
  });
});

describe("PO submission — EDEV test host (guide v24.5 p.21)", () => {
  it("points the test base at edev-ws.sanmar.com, not the retired test-ws host", () => {
    expect(SM_TEST_BASE).toBe("https://edev-ws.sanmar.com:8080/SanMarWebService");
  });
});

describe("PO submission — normalizeSmZip / normalizeSmShipMethod", () => {
  it("keeps 5, 5+4 and 9-digit ZIPs numeric and pads leading zeros", () => {
    expect(normalizeSmZip("89501")).toBe("89501");
    expect(normalizeSmZip("89501-2326")).toBe("89501-2326");
    expect(normalizeSmZip("980071156")).toBe("98007-1156");
    expect(normalizeSmZip("8054")).toBe("08054");
    expect(normalizeSmZip("")).toBe("");
    expect(normalizeSmZip("V6B 1A1")).toBe("");
  });

  it("returns '' for ship methods SanMar doesn't accept so the caller can refuse", () => {
    expect(normalizeSmShipMethod("FedEx Ground")).toBe("");
    expect(normalizeSmShipMethod("PSST")).toBe("PSST");
    expect(normalizeSmShipMethod("USPS Priority Mail")).toBe("USPS APP");
    expect(normalizeSmShipMethod("UPS Next Day Air")).toBe("UPS NEXT DAY");
  });
});

describe("PO submission — getPreSubmitInfo", () => {
  const creds = { customerNumber: "12345", username: "shop", password: "pw" };
  const po = {
    poNumber: "TEST-1",
    shipTo: { name: "Shop", address1: "1 St", city: "Reno", state: "NV", zip: "89501" },
    lines: [{ inventoryKey: "20860", sizeIndex: "3", quantity: 5, style: "K500" }],
  };

  it("builds the getPreSubmitInfo operation with the same arg0 schema as submitPO", () => {
    const env = buildPreSubmitInfoEnvelope(creds, po);
    expect(env).toContain("<web:getPreSubmitInfo>");
    expect(env).toContain("<poNum>TEST-1</poNum>");
    expect(env).toContain("<inventoryKey>20860</inventoryKey>");
  });

  it("parses the in-stock scenario (guide p.24): ok with the shipping warehouse", () => {
    const xml = `<S:Envelope><S:Body><ns2:getPreSubmitInfoResponse><return><errorOccurred>false</errorOccurred><message>Information returned successfully</message><response><internalMessage>SUCCESS: Inventory Found</internalMessage><poNum>WEBSERVICES TEST</poNum><webServicePoDetailList><color>white</color><errorOccured>false</errorOccured><inventoryKey>20860</inventoryKey><message>Requested Quantity is confirmed and available in warehouse '1' to ship to your destination.</message><quantity>5</quantity><size>m</size><sizeIndex>3</sizeIndex><style>K500</style><whseNo>1</whseNo></webServicePoDetailList></response></return></ns2:getPreSubmitInfoResponse></S:Body></S:Envelope>`;
    const r = parsePreSubmitInfoResponse(xml);
    expect(r.ok).toBe(true);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ inventoryKey: "20860", sizeIndex: "3", whseNo: "1", quantity: 5, ok: true });
  });

  it("parses the out-of-stock scenario (guide p.25): not ok, short line flagged", () => {
    const xml = `<S:Envelope><S:Body><ns2:getPreSubmitInfoResponse><return><errorOccurred>true</errorOccurred><message>Requested Quantity is not in stock from any warehouse or from the requested warehouse for the following styles: [(K420,900)]</message><response><webServicePoDetailList><color>Black</color><errorOccured>true</errorOccured><inventoryKey>9203</inventoryKey><quantity>900</quantity><size>S</size><message>Requested Quantity is not in stock from any warehouse or from requested warehouse</message><sizeIndex>2</sizeIndex><style>K420</style></webServicePoDetailList></response></return></ns2:getPreSubmitInfoResponse></S:Body></S:Envelope>`;
    const r = parsePreSubmitInfoResponse(xml);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("K420");
    expect(r.lines[0].ok).toBe(false);
    expect(r.lines[0].style).toBe("K420");
  });
});

describe("PO submission — parseSubmitPoResponse", () => {
  it("reports success on the guide's real response (p.28) — no PO number is echoed", () => {
    const xml = `<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/"><S:Body><ns2:submitPOResponse xmlns:ns2="http://webservice.integration.sanmar.com/"><return><errorOccurred>false</errorOccurred><message>PO Submission successful</message></return></ns2:submitPOResponse></S:Body></S:Envelope>`;
    const r = parseSubmitPoResponse(xml);
    expect(r.success).toBe(true);
    expect(r.poNumber).toBe("");
    expect(r.message).toBe("PO Submission successful");
  });

  it("reports failure when errorOccurred is true (either spelling)", () => {
    const xml = `<S:Envelope><S:Body><return><errorOccurred>true</errorOccurred><message>Invalid inventoryKey</message></return></S:Body></S:Envelope>`;
    const r = parseSubmitPoResponse(xml);
    expect(r.success).toBe(false);
    expect(r.message).toBe("Invalid inventoryKey");
  });

  it("handles an empty body without throwing", () => {
    expect(parseSubmitPoResponse("")).toMatchObject({ success: false });
  });
});
