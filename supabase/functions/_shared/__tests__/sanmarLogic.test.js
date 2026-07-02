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

  it("prefers myPrice over catalog piecePrice for the color's cost", () => {
    const match = buildMatchFromEntries(entries, pricing);
    // Catalog piecePrice for White is 3.84; the shop's myPrice is 2.41.
    expect(match.priceMap.White.piecePrice).toBe(2.41);
    expect(match.priceMap.Black.piecePrice).toBe(2.58);
    expect(match.piecePrice).toBe(2.41); // style-level = cheapest color
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
