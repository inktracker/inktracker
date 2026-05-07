import { useEffect, useRef, useState } from "react";
import {
  SIZES,
  BIG_SIZES,
  LOCATIONS,
  getEnabledTechniques,
  getShopPricingConfig,
  GARMENT_CATEGORIES,
  mapSSCategoryToGarment,
  getQty,
  uid,
  STANDARD_MARKUP,
} from "../shared/pricing";
import PricePanel from "./PricePanel";
import Icon from "../shared/Icon";
import { supabase } from "@/api/supabaseClient";

// Query both S&S Activewear and AS Colour in parallel and merge results.
// AS Colour uses `styleCode`, S&S uses `styleNumber` — same wire format on the
// way out, so the brandOptions dropdown ends up with one entry per (brand, style)
// regardless of supplier. Either supplier failing/returning empty doesn't break
// the lookup; we just use whatever came back.
async function lookupStyle(styleNumber) {
  const code = String(styleNumber || "").trim().toUpperCase();
  if (!code) return { matches: [] };

  const [ssRes, acRes] = await Promise.allSettled([
    supabase.functions.invoke("ssLookupStyle", { body: { styleNumber: code } }),
    supabase.functions.invoke("acLookupStyle", { body: { styleCode: code } }),
  ]);

  const grab = (r) => {
    if (r.status !== "fulfilled") return [];
    const data = r.value?.data;
    if (!data || data.error) return [];
    return data.matches || data.results || data.items || data.products || [];
  };

  const matches = [...grab(ssRes), ...grab(acRes)];
  return { matches };
}

function normalizeImprint(imprint) {
  return {
    id: imprint?.id || uid(),
    title: imprint?.title || "",
    location: imprint?.location || "Front",
    width: imprint?.width || "",
    height: imprint?.height || "",
    colors: imprint?.colors === 0 || imprint?.colors ? imprint.colors : 1,
    pantones: imprint?.pantones || "",
    technique: imprint?.technique || "Screen Print",
    details: imprint?.details || "",
    linked: !!imprint?.linked,
    artwork_id: imprint?.artwork_id || "",
    artwork_name: imprint?.artwork_name || "",
    artwork_url: imprint?.artwork_url || "",
    artwork_note: imprint?.artwork_note || "",
    artwork_colors:
      imprint?.artwork_colors === 0 || imprint?.artwork_colors
        ? imprint.artwork_colors
        : "",
  };
}

function cleanText(value) {
  return String(value || "").trim();
}

function normalizeTypedStyleNumber(value) {
  return cleanText(value).toUpperCase();
}

function looksLikeCode(value) {
  const txt = cleanText(value);
  if (!txt) return false;
  return /^[A-Z0-9-]{2,30}$/i.test(txt) && /\d/.test(txt) && !txt.includes(" ");
}

function isWarehouseSku(value) {
  const txt = cleanText(value).toUpperCase();
  if (!txt) return false;
  return /^0\d{3,}$/.test(txt) || /^\d{5,}$/.test(txt);
}

function extractTrailingCode(title) {
  const txt = cleanText(title);
  if (!txt) return "";
  const match = txt.match(/-\s*([A-Z0-9-]{2,30})$/i);
  return match ? cleanText(match[1]).toUpperCase() : "";
}

function stripTrailingCode(title) {
  const txt = cleanText(title);
  if (!txt) return "";
  return txt.replace(/\s*-\s*[A-Z0-9-]{2,30}\s*$/i, "").trim();
}

function getResultCandidates(result) {
  const rawMatches = Array.isArray(result?.matches)
    ? result.matches
    : Array.isArray(result?.results)
      ? result.results
      : Array.isArray(result?.items)
        ? result.items
        : Array.isArray(result?.products)
          ? result.products
          : [];

  if (rawMatches.length > 0) {
    return rawMatches.map((item, index) => ({
      id:
        item?.id ||
        item?.styleIdentifier ||
        item?.styleNumber ||
        item?.productNumber ||
        item?.style ||
        `match-${index}`,
      styleNumber: cleanText(
        item?.styleIdentifier ||
          item?.styleNumber ||
          item?.style_number ||
          item?.supplierStyleNumber ||
          item?.supplier_style_number ||
          item?.resolvedStyleNumber ||
          item?.resolved_style_number ||
          item?.style
      ).toUpperCase(),
      resolvedStyleNumber: cleanText(
        item?.resolvedStyleNumber ||
          item?.resolved_style_number ||
          item?.supplierStyleNumber ||
          item?.supplier_style_number
      ).toUpperCase(),
      productNumber: cleanText(
        item?.productNumber ||
          item?.product_number ||
          item?.itemNumber ||
          item?.item_number ||
          item?.sku
      ).toUpperCase(),
      brandName: cleanText(item?.brandName || item?.brand || item?.brand_name),
      styleName: cleanText(
        item?.styleName ||
          item?.style_name ||
          item?.productTitle ||
          item?.product_title ||
          item?.resolvedTitle ||
          item?.resolved_title ||
          item?.title ||
          item?.description
      ),
      resolvedTitle: cleanText(item?.resolvedTitle || item?.resolved_title),
      title: cleanText(item?.title),
      description: cleanText(item?.description || item?.productDescription),
      styleCategory: cleanText(item?.styleCategory || item?.category),
      colors: Array.isArray(item?.colors) ? item.colors : [],
      inventoryMap: item?.inventoryMap || {},
      priceMap: item?.priceMap || {},
      piecePrice: item?.piecePrice,
      casePrice: item?.casePrice,
      raw: item,
    }));
  }

  return [
    {
      id: "single-result",
      styleNumber: cleanText(
        result?.styleNumber ||
          result?.style_number ||
          result?.supplierStyleNumber ||
          result?.supplier_style_number ||
          result?.resolvedStyleNumber ||
          result?.resolved_style_number ||
          result?.style
      ).toUpperCase(),
      resolvedStyleNumber: cleanText(
        result?.resolvedStyleNumber ||
          result?.resolved_style_number ||
          result?.supplierStyleNumber ||
          result?.supplier_style_number
      ).toUpperCase(),
      productNumber: cleanText(
        result?.productNumber ||
          result?.product_number ||
          result?.itemNumber ||
          result?.item_number ||
          result?.sku
      ).toUpperCase(),
      brandName: cleanText(result?.brandName || result?.brand || result?.brand_name),
      styleName: cleanText(
        result?.styleName ||
          result?.style_name ||
          result?.productTitle ||
          result?.product_title ||
          result?.resolvedTitle ||
          result?.resolved_title ||
          result?.title ||
          result?.description
      ),
      resolvedTitle: cleanText(result?.resolvedTitle || result?.resolved_title),
      title: cleanText(result?.title),
      colors: Array.isArray(result?.colors) ? result.colors : [],
      inventoryMap: result?.inventoryMap || {},
      priceMap: result?.priceMap || {},
      piecePrice: result?.piecePrice,
      casePrice: result?.casePrice,
      raw: result,
    },
  ];
}

function getCanonicalStyleNumber(typedStyleNumber, selectedMatch) {
  const typed = normalizeTypedStyleNumber(typedStyleNumber);

  const titleCandidates = [
    selectedMatch?.resolvedTitle,
    selectedMatch?.title,
    selectedMatch?.raw?.resolvedTitle,
    selectedMatch?.raw?.resolved_title,
    selectedMatch?.raw?.title,
    selectedMatch?.raw?.productTitle,
    selectedMatch?.raw?.product_title,
    selectedMatch?.styleName,
  ]
    .map(extractTrailingCode)
    .filter(Boolean)
    .filter((value) => !isWarehouseSku(value));

  if (titleCandidates.length > 0) {
    const exactTyped = titleCandidates.find((value) => value === typed);
    if (exactTyped) return exactTyped;

    const typedDigits = typed.replace(/^[A-Z]+/, "");
    const typedHasPrefix = /^[A-Z]+\d+/i.test(typed);

    if (typedHasPrefix && typedDigits) {
      const numericSibling = titleCandidates.find(
        (value) => value === typedDigits || value.replace(/^[A-Z]+/, "") === typedDigits
      );
      if (numericSibling) return numericSibling;
    }

    return titleCandidates[0];
  }

  const fieldCandidates = [
    selectedMatch?.resolvedStyleNumber,
    selectedMatch?.styleNumber,
    selectedMatch?.productNumber,
    typed,
  ]
    .map((value) => cleanText(value).toUpperCase())
    .filter(Boolean)
    .filter((value) => looksLikeCode(value))
    .filter((value) => !isWarehouseSku(value));

  const exactTyped = fieldCandidates.find((value) => value === typed);
  if (exactTyped) return exactTyped;

  const numericCandidate = fieldCandidates.find((value) => /^\d+[A-Z0-9-]*$/.test(value));
  if (numericCandidate) return numericCandidate;

  return fieldCandidates[0] || typed;
}

function getBestDescription(selectedMatch) {
  // Use resolvedTitle first — it's a clean product name for both S&S and AS Colour.
  // Only use raw.description if it's short (S&S style names are short, AS Colour's are paragraphs).
  const rawDesc = cleanText(selectedMatch?.raw?.description);
  const shortRawDesc = rawDesc && rawDesc.length < 80 ? rawDesc : "";

  const candidates = [
    stripTrailingCode(selectedMatch?.resolvedTitle),
    stripTrailingCode(selectedMatch?.title),
    shortRawDesc,
    cleanText(selectedMatch?.raw?.resolvedDescription),
    cleanText(selectedMatch?.raw?.resolved_description),
    cleanText(selectedMatch?.raw?.productDescription),
    cleanText(selectedMatch?.raw?.product_description),
    stripTrailingCode(selectedMatch?.raw?.resolvedTitle),
    stripTrailingCode(selectedMatch?.raw?.resolved_title),
    stripTrailingCode(selectedMatch?.raw?.title),
    stripTrailingCode(selectedMatch?.raw?.productTitle),
    stripTrailingCode(selectedMatch?.raw?.product_title),
    stripTrailingCode(selectedMatch?.styleName),
  ];

  for (const candidate of candidates) {
    const value = cleanText(candidate);
    if (!value) continue;
    if (value.toLowerCase() === "shirt") continue;
    if (value.toLowerCase() === "garment") continue;
    if (looksLikeCode(value)) continue;
    return value;
  }

  return "";
}

function buildBrandOptions(matches, typedStyleNumber) {
  const typed = normalizeTypedStyleNumber(typedStyleNumber);
  const unique = [];
  const seen = new Set();

  matches.forEach((match, index) => {
    const canonicalStyle = getCanonicalStyleNumber(typed, match);
    const brand = cleanText(match.brandName) || "Unknown Brand";
    const description = getBestDescription(match) || "Untitled";
    // Key includes brand to prevent deduplication when different brands have same style
    const key = `${canonicalStyle}|${brand}|${description}`;

    if (seen.has(key)) return;
    seen.add(key);

    unique.push({
      id: match.id || `brand-${index}`,
      styleNumber: canonicalStyle,
      brandName: brand,
      description,
      styleCategory: match.styleCategory || "",
      colors: match.colors || [],
      inventoryMap: match.inventoryMap || {},
      priceMap: match.priceMap || {},
      sizePriceMap: JSON.parse(JSON.stringify(match.sizePriceMap || {})),
      piecePrice: match.piecePrice,
      casePrice: match.casePrice,
      raw: match.raw || match,
      label: `${brand} — ${canonicalStyle} — ${description}`,
    });
  });

  return unique;
}

function getPreferredGarmentNumber(li) {
  const candidates = [
    li?.supplierStyleNumber,
    li?.resolvedStyleNumber,
    li?.styleNumber,
    li?.garmentNumber,
    li?.productNumber,
  ];

  for (const candidate of candidates) {
    const value = cleanText(candidate).toUpperCase();
    if (!value) continue;
    if (isWarehouseSku(value)) continue;
    if (!looksLikeCode(value)) continue;
    return value;
  }

  const productTitleTail = extractTrailingCode(li?.productTitle);
  if (productTitleTail && !isWarehouseSku(productTitleTail)) {
    return productTitleTail;
  }

  const resolvedTitleTail = extractTrailingCode(li?.resolvedTitle);
  if (resolvedTitleTail && !isWarehouseSku(resolvedTitleTail)) {
    return resolvedTitleTail;
  }

  return cleanText(li?.style) || "Garment";
}

function getPreferredGarmentDescription(li) {
  const candidates = [
    cleanText(li?.resolvedDescription),
    cleanText(li?.productDescription),
    cleanText(li?.product_description),
    cleanText(li?.garmentName),
    cleanText(li?.styleName),
    cleanText(li?.description),
    stripTrailingCode(li?.productTitle),
    stripTrailingCode(li?.resolvedTitle),
    cleanText(li?.title),
    cleanText(li?.displayName),
  ];

  const garmentNumber = getPreferredGarmentNumber(li).toLowerCase();

  for (const candidate of candidates) {
    if (!candidate) continue;
    const normalized = candidate.toLowerCase();

    if (normalized === garmentNumber) continue;
    if (looksLikeCode(candidate)) continue;
    if (normalized === "shirt") continue;
    if (normalized === "garment") continue;
    // Skip "Brand — PartNumber" strings where desc ends with the garment number
    if (normalized.endsWith(garmentNumber)) continue;

    return candidate;
  }

  if (cleanText(li?.brand)) return cleanText(li.brand);
  return "";
}

// Extract the product description from a resolvedTitle like "Brand — Desc — PartNumber"
function extractDescFromTitle(title, brand, partNumber) {
  let t = cleanText(title);
  if (!t) return "";
  // Strip leading "Brand — "
  if (brand) {
    const esc = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    t = t.replace(new RegExp(`^${esc}\\s*[-–—]\\s*`, "i"), "");
  }
  // Strip trailing " — PartNumber"
  if (partNumber) {
    const esc = partNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    t = t.replace(new RegExp(`\\s*[-–—]\\s*${esc}\\s*$`, "i"), "");
  }
  t = t.trim();
  if (!t || looksLikeCode(t) || t.toUpperCase() === partNumber.toUpperCase()) return "";
  return t;
}

function getGarmentHeader(li) {
  const number = getPreferredGarmentNumber(li);
  const storedName = cleanText(li?.productName || "");
  // Only use productName if it's not a code (avoid "1717 - 1717")
  const description = (storedName && !looksLikeCode(storedName))
    ? storedName
    : getPreferredGarmentDescription(li);
  return description ? `${number} - ${description}` : number;
}

function applySelectedMatch(li, selectedMatch) {
  const styleNumber = cleanText(selectedMatch.styleNumber).toUpperCase();
  const brand = cleanText(selectedMatch.brandName || li.brand || "");

  // Use resolvedTitle as the product name (clean title without style code).
  // Fall back to raw.description only if it's short (S&S uses description as
  // a style name, but AS Colour puts a full paragraph there).
  const resolvedTitle = cleanText(selectedMatch.resolvedTitle || selectedMatch.raw?.resolvedTitle || "");
  const rawDesc = cleanText(selectedMatch.raw?.description || "");
  const isShortDesc = rawDesc && rawDesc.length < 80 && !looksLikeCode(rawDesc) && rawDesc.toUpperCase() !== styleNumber;

  let productName = resolvedTitle || (isShortDesc ? rawDesc : "");

  // Fall back: extract the middle segment from "Brand — Desc — PartNumber" in resolvedTitle
  if (!productName) {
    const rawTitle = cleanText(selectedMatch.raw?.resolvedTitle || selectedMatch.raw?.title || "");
    productName = extractDescFromTitle(rawTitle, brand, styleNumber);
  }

  const description = productName;
  const colors = selectedMatch.colors || [];
  const firstColor =
    colors.find((c) => c.colorName === li.garmentColor)?.colorName ||
    colors[0]?.colorName ||
    li.garmentColor;

  const selectedPrice = (selectedMatch.priceMap && selectedMatch.priceMap[firstColor]) || {};

  return {
    ...li,
    style: li.style,
    brand: selectedMatch.brandName || li.brand,
    garmentCost: Number(
      selectedPrice.piecePrice != null
        ? selectedPrice.piecePrice
        : selectedMatch.piecePrice || 0
    ),
    casePrice: Number(
      selectedPrice.casePrice != null
        ? selectedPrice.casePrice
        : selectedMatch.casePrice || 0
    ),
    garmentColor: firstColor,
    productName: productName || li.productName || "",
    styleName: productName || li.styleName,
    garmentNumber: styleNumber || li.garmentNumber,
    resolvedStyleNumber: styleNumber || li.resolvedStyleNumber,
    styleNumber: styleNumber || li.styleNumber || "",
    productNumber: styleNumber || li.productNumber || "",
    supplierStyleNumber: styleNumber || li.supplierStyleNumber || "",
    productTitle: productName || li.productTitle || "",
    resolvedTitle: cleanText(selectedMatch.raw?.resolvedTitle || selectedMatch.resolvedTitle) || li.resolvedTitle || "",
    resolvedDescription: productName || li.resolvedDescription || "",
    productDescription: productName || li.productDescription || "",
    description: productName || li.description || "",
    garmentName: productName || li.garmentName || "",
    // Always re-map category on a fresh S&S lookup so switching the style
    // updates the category accordingly. If the lookup can't classify,
    // preserve whatever was there.
    category: mapSSCategoryToGarment(
      selectedMatch.styleCategory,
      productName || selectedMatch.description
    ) || li.category || "",
    supplier: selectedMatch.brandName === "AS Colour" ? "AS Colour" : "S&S Activewear",
    supplierLastLookupAt: new Date().toISOString(),
    // Per-size wholesale prices from the API (e.g. { S: 4.62, M: 4.62, "2XL": 5.62 })
    sizePrices: JSON.parse(JSON.stringify((selectedMatch.sizePriceMap && selectedMatch.sizePriceMap[firstColor]) || {})),
  };
}

export default function LineItemEditor({
  li,
  rushRate,
  extras,
  allLineItems = [],
  savedImprints = [],
  onChange: _rawOnChange,
  onRemove,
  onDuplicate,
  canRemove,
}) {
  // sizePrices stored in a ref (synchronous) so it survives every onChange call.
  // React state updates are async and can be overwritten by rapid onChange calls.
  const sizePricesRef = useRef(li.sizePrices || null);
  const onChange = (updated) => {
    // Capture sizePrices when it arrives
    if (updated.sizePrices && Object.keys(updated.sizePrices).length > 0) {
      sizePricesRef.current = updated.sizePrices;
    }
    // Always attach from ref
    if (sizePricesRef.current) {
      updated = { ...updated, sizePrices: sizePricesRef.current };
    }
    _rawOnChange(updated);
  };
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [ssColors, setSsColors] = useState([]);
  const [ssInventory, setSsInventory] = useState({});
  const [ssPriceMap, setSsPriceMap] = useState({});
  const [ssSizePriceMap, setSsSizePriceMap] = useState({});
  const [ssLoading, setSsLoading] = useState(false);
  const [ssError, setSsError] = useState(null);
  const [brandOptions, setBrandOptions] = useState([]);
  // Track which line item ids we've already auto-looked-up so we don't loop.
  const autoLookedUpRef = useRef(new Set());

  const qty = getQty(li);

  const previewLineItems = (allLineItems || []).map((item) =>
    item.id === li.id ? li : item
  );

  // Auto-lookup on mount when a line item arrived with a style # but no
  // resolved brand options yet — for example, after the "Paste Order" parser
  // Auto-lookup on mount for line items that already have a style number
  // (e.g. duplicated lines or wizard-created quotes). Only fires once per line.
  useEffect(() => {
    const styleNumber = normalizeTypedStyleNumber(li.style);
    if (!styleNumber) return;
    if (brandOptions.length > 0) return;
    if (autoLookedUpRef.current.has(li.id)) return;
    autoLookedUpRef.current.add(li.id);
    handleStyleBlur();
  }, [li.id]); // Only on mount (li.id), NOT on li.style change

  async function handleStyleBlur() {
    const typedStyleNumber = normalizeTypedStyleNumber(li.style);
    if (!typedStyleNumber) return;

    setSsLoading(true);
    setSsError(null);

    try {
      const result = await lookupStyle(typedStyleNumber);
      const matches = getResultCandidates(result);
      const options = buildBrandOptions(matches, typedStyleNumber);

      setBrandOptions(options);

      if (options.length === 0) {
        throw new Error("No results found");
      }

      // If the current brand matches one of the options, auto-select it.
      // If there's only one option, auto-select it.
      // If there are multiple, don't auto-apply — let the user pick from the dropdown.
      const brandMatch = options.find(
        (option) =>
          cleanText(option.brandName).toLowerCase() === cleanText(li.brand).toLowerCase()
      );
      const selected = brandMatch || (options.length === 1 ? options[0] : null);

      if (selected) {
        setSsColors(selected.colors || []);
        setSsInventory(selected.inventoryMap || {});
        setSsPriceMap(selected.priceMap || {});
        setSsSizePriceMap(selected.sizePriceMap || {});
        onChange(applySelectedMatch(li, selected));
      } else {
        setSsColors(options[0].colors || []);
        setSsInventory(options[0].inventoryMap || {});
        setSsPriceMap(options[0].priceMap || {});
        setSsSizePriceMap(options[0].sizePriceMap || {});
      }
    } catch (e) {
      setBrandOptions([]);
      setSsColors([]);
      setSsInventory({});
      setSsPriceMap({});
      setSsSizePriceMap({});
      setSsError("Style not found");
    } finally {
      setSsLoading(false);
    }
  }

  function handleBrandSelection(optionId) {
    const selected = brandOptions.find((option) => option.id === optionId);
    if (!selected) return;

    setSsColors(selected.colors || []);
    setSsInventory(selected.inventoryMap || {});
    setSsPriceMap(selected.priceMap || {});
    setSsSizePriceMap(selected.sizePriceMap || {});
    onChange(applySelectedMatch(li, selected));
  }

  function handleColorChange(colorName) {
    const selectedPrice = ssPriceMap[colorName] || {};
    onChange({
      ...li,
      garmentColor: colorName,
      garmentCost:
        selectedPrice.piecePrice != null
          ? Number(selectedPrice.piecePrice)
          : li.garmentCost,
      casePrice:
        selectedPrice.casePrice != null
          ? Number(selectedPrice.casePrice)
          : li.casePrice,
      sizePrices: ssSizePriceMap[colorName] || li.sizePrices || {},
    });
  }

  const rawInventory = ssInventory[li.garmentColor] || {};
  // Normalize inventory keys: map "Adjustable", "OSFA", "One Size", etc. to "OS"
  const OS_ALIASES = ["adjustable", "osfa", "one size", "os", "osfm", "one_size", "uni", "n/a"];
  const currentInventory = {};
  for (const [k, v] of Object.entries(rawInventory)) {
    if (OS_ALIASES.includes(k.toLowerCase())) {
      currentInventory["OS"] = (currentInventory["OS"] || 0) + v;
    } else {
      currentInventory[k] = v;
    }
  }
  const selectedBrandOption =
    brandOptions.find(
      (option) =>
        cleanText(option.brandName).toLowerCase() === cleanText(li.brand).toLowerCase() &&
        cleanText(option.styleNumber).toUpperCase() ===
          cleanText(li.supplierStyleNumber || li.resolvedStyleNumber || li.styleNumber).toUpperCase()
    ) || brandOptions[0];

  function updateImprint(idx, patch) {
    const imprints = (li.imprints || []).map((im, i) =>
      i === idx ? { ...normalizeImprint(im), ...patch } : normalizeImprint(im)
    );
    onChange({ ...li, imprints });
  }

  function addImprint() {
    if ((li.imprints || []).length >= 5) return;
    onChange({
      ...li,
      imprints: [
        ...(li.imprints || []).map(normalizeImprint),
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
          artwork_id: "",
          artwork_name: "",
          artwork_url: "",
          artwork_note: "",
          artwork_colors: "",
        },
      ],
    });
  }

  function removeImprint(idx) {
    onChange({
      ...li,
      imprints: (li.imprints || []).filter((_, i) => i !== idx),
    });
  }


  return (
    <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white">
      <div className="bg-slate-50 px-3 sm:px-5 py-3 border-b border-slate-200 space-y-3">
        <div>
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="text-sm text-slate-400 hover:text-slate-600 font-semibold transition"
          >
            {isCollapsed ? "▶ Expand" : "▼ Collapse"}
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">
              Style #
              {ssLoading && (
                <span className="ml-1 text-indigo-400 normal-case font-normal">
                  Looking up…
                </span>
              )}
            </label>
            <input
              value={li.style}
              onChange={(e) => onChange({ ...li, style: e.target.value })}
              onBlur={handleStyleBlur}
              onKeyDown={(e) => e.key === "Enter" && handleStyleBlur()}
              placeholder="e.g. 1717 or G500"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
            {ssError && <div className="text-xs text-red-500 mt-0.5">{ssError}</div>}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">
              Category
            </label>
            <select
              value={li.category || ""}
              onChange={(e) => onChange({ ...li, category: e.target.value })}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
            >
              <option value="">Select…</option>
              {GARMENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">
              Brand
            </label>
            {brandOptions.length > 1 ? (
              <select
                value={selectedBrandOption && cleanText(selectedBrandOption.brandName).toLowerCase() === cleanText(li.brand).toLowerCase() ? selectedBrandOption.id : ""}
                onChange={(e) => handleBrandSelection(e.target.value)}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
              >
                {!li.brand && <option value="">Select brand…</option>}
                {[...brandOptions].sort((a, b) => (a.label || "").localeCompare(b.label || "", undefined, { sensitivity: 'base' })).map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={li.brand}
                onChange={(e) => onChange({ ...li, brand: e.target.value })}
                placeholder="e.g. Gildan"
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">
              Garment Color
            </label>
            {ssColors.length > 0 ? (
              <select
                value={li.garmentColor}
                onChange={(e) => handleColorChange(e.target.value)}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
              >
                {[...ssColors].sort((a, b) => (a.colorName || "").localeCompare(b.colorName || "", undefined, { sensitivity: 'base' })).map((c) => (
                  <option key={c.colorName} value={c.colorName}>
                    {c.colorName}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={li.garmentColor}
                onChange={(e) => onChange({ ...li, garmentColor: e.target.value })}
                placeholder="e.g. Black"
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">
              Garment Cost
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2 text-slate-400 text-sm">$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={li.garmentCost}
                onChange={(e) => onChange({ ...li, garmentCost: e.target.value })}
                placeholder="0.00"
                className="w-full text-sm border border-slate-200 rounded-lg pl-7 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>
          </div>
        </div>

        <div className="ml-auto flex gap-1.5">
          {onDuplicate && (
            <button
              onClick={onDuplicate}
              className="text-xs text-indigo-500 hover:text-indigo-700 transition font-semibold flex-shrink-0"
            >
              ⧉ Duplicate
            </button>
          )}
          {canRemove && (
            <button
              onClick={onRemove}
              className="text-xs text-slate-300 hover:text-red-400 transition flex-shrink-0"
            >
              ✕ Remove
            </button>
          )}
        </div>
      </div>

      {!isCollapsed && (
        <div className="grid grid-cols-1 md:grid-cols-2 md:divide-x divide-slate-100">
          <div className="p-5 space-y-5">
            <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3">
              <div className="text-[11px] font-bold uppercase tracking-widest text-indigo-400 mb-1">
                Display Header Preview
              </div>
              <div className="text-sm font-bold text-slate-900">
                {getGarmentHeader(li)}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {li.brand ? `Brand: ${li.brand}` : ""}
                {li.brand && li.garmentColor ? " • " : ""}
                {li.garmentColor ? `Color: ${li.garmentColor}` : ""}
              </div>
            </div>

            <div>
              <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">
                Size Breakdown
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <td className="pb-2 text-slate-400 font-semibold">Size</td>
                      {SIZES.map((sz) => (
                        <td key={sz} className="pb-2 text-center font-semibold text-slate-500 w-10">
                          {sz}
                        </td>
                      ))}
                      <td className="pb-2 text-center font-semibold text-slate-600">Total</td>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="py-1 text-slate-500 font-medium pr-2">Qty</td>
                      {SIZES.map((sz) => (
                        <td key={sz} className="py-1 px-0.5">
                          <input
                            type="number"
                            min="0"
                            value={li.sizes?.[sz] || ""}
                            onChange={(e) =>
                              onChange({
                                ...li,
                                sizes: {
                                  ...li.sizes,
                                  [sz]: parseInt(e.target.value, 10) || 0,
                                },
                              })
                            }
                            placeholder="0"
                            className={`w-full text-center text-xs border rounded-lg py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300 ${
                              BIG_SIZES.includes(sz)
                                ? "border-amber-200 bg-amber-50"
                                : "border-slate-200"
                            }`}
                          />
                        </td>
                      ))}
                      <td className="py-1 text-center font-bold text-slate-800 pl-1">{qty}</td>
                    </tr>

                    {Object.keys(currentInventory).length > 0 && (
                      <tr>
                        <td className="py-1 text-indigo-400 font-medium pr-2 text-xs">Avail</td>
                        {SIZES.map((sz) => {
                          const avail = currentInventory[sz];
                          return (
                            <td key={sz} className="py-1 px-0.5 text-center">
                              {avail !== undefined ? (
                                <span
                                  className={`text-xs font-semibold ${
                                    avail === 0
                                      ? "text-red-400"
                                      : avail < 12
                                        ? "text-amber-500"
                                        : "text-emerald-600"
                                  }`}
                                >
                                  {avail >= 1000 ? "999+" : avail}
                                </span>
                              ) : (
                                <span className="text-slate-300 text-xs">—</span>
                              )}
                            </td>
                          );
                        })}
                        <td />
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {qty > 0 && qty < 25 && (
                <div className="mt-2 text-xs text-red-500 font-semibold bg-red-50 rounded-lg px-3 py-1.5 border border-red-100 flex items-center gap-1.5">
                  <Icon name="warning" className="w-3.5 h-3.5" />
                  Minimum order: 25 pcs (current: {qty})
                </div>
              )}

              {BIG_SIZES.reduce((s, sz) => s + (parseInt(li.sizes?.[sz], 10) || 0), 0) > 0 && (
                <div className="mt-2 text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-1.5 border border-amber-100">
                  2XL+ sizes highlighted — +$2.00/pc surcharge applies.
                </div>
              )}
            </div>

            <div>
              <div className="flex justify-between items-center mb-3">
                <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                  Print Locations
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={addImprint}
                    className="text-xs font-semibold text-indigo-600 border border-indigo-100 px-2.5 py-1 rounded-lg hover:bg-indigo-50 transition"
                  >
                    + Add Location
                  </button>
                </div>
              </div>

              <div className="space-y-2.5">
                {(li.imprints || []).map((rawImprint, idx) => {
                  const imp = normalizeImprint(rawImprint);

                  return (
                    <div key={imp.id} className="bg-slate-50 rounded-xl p-3 border border-slate-200">
                      {savedImprints.length > 0 && (
                        <div className="flex justify-end mb-2">
                          <select
                            defaultValue=""
                            onChange={(e) => {
                              if (!e.target.value) return;
                              const preset = savedImprints[parseInt(e.target.value)];
                              e.target.value = "";
                              if (!preset) return;
                              updateImprint(idx, { ...preset });
                            }}
                            className="text-xs border border-indigo-200 text-indigo-600 rounded-lg px-2 py-1 bg-white focus:outline-none"
                          >
                            <option value="">Load saved…</option>
                            {savedImprints
                              .map((p, i) => ({ p, i, label: p.title || p.location || `Preset ${i + 1}` }))
                              .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
                              .map(({ i, label }) => (
                                <option key={i} value={i}>{label}</option>
                              ))}
                          </select>
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2 mb-2">
                        <div className="flex-1 min-w-32">
                          <label className="block text-xs text-slate-400 mb-0.5">Title</label>
                          <input
                            value={imp.title || ""}
                            onChange={(e) => updateImprint(idx, { title: e.target.value })}
                            placeholder="e.g. Front Logo"
                            className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                          />
                        </div>

                        <div className="w-16">
                          <label className="block text-xs text-slate-400 mb-0.5">Link Print</label>
                          <button
                            onClick={() => updateImprint(idx, { linked: !imp.linked })}
                            className={`w-full h-8 text-xs font-semibold rounded-lg border transition ${
                              imp.linked
                                ? "bg-emerald-100 border-emerald-300 text-emerald-700"
                                : "bg-white border-slate-200 text-slate-500 hover:border-slate-300"
                            }`}
                          >
                            {imp.linked ? "✓ Linked" : "Link"}
                          </button>
                        </div>

                        <div className="w-20">
                          <label className="block text-xs text-slate-400 mb-0.5">Width</label>
                          <input
                            value={imp.width || ""}
                            onChange={(e) => updateImprint(idx, { width: e.target.value })}
                            placeholder='e.g. 4"'
                            className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                          />
                        </div>

                        <div className="w-20">
                          <label className="block text-xs text-slate-400 mb-0.5">Height</label>
                          <input
                            value={imp.height || ""}
                            onChange={(e) => updateImprint(idx, { height: e.target.value })}
                            placeholder='e.g. 2"'
                            className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                          />
                        </div>

                        <div className="w-28">
                          <label className="block text-xs text-slate-400 mb-0.5">Location</label>
                          <select
                            value={imp.location}
                            onChange={(e) => updateImprint(idx, { location: e.target.value })}
                            className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
                          >
                            {LOCATIONS.map((l) => (
                              <option key={l}>{l}</option>
                            ))}
                          </select>
                        </div>

                        {imp.technique === "Embroidery" ? (
                          <>
                            <div className="w-28">
                              <label className="block text-xs text-slate-400 mb-0.5">Stitch Count</label>
                              <select
                                value={imp.colors || 1}
                                onChange={(e) => updateImprint(idx, { colors: parseInt(e.target.value) || 1 })}
                                className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
                              >
                                {(getShopPricingConfig()?.embroidery?.stitchTiers || ["Under 5K", "5K-10K", "10K-15K", "15K+"]).map((st, i) => (
                                  <option key={st} value={i + 1}>{st}</option>
                                ))}
                              </select>
                            </div>
                            <div className="flex-1 min-w-28">
                              <label className="block text-xs text-slate-400 mb-0.5">Thread Colors</label>
                              <input
                                value={imp.pantones || ""}
                                onChange={(e) => updateImprint(idx, { pantones: e.target.value })}
                                placeholder="e.g. Navy, White, Gold"
                                className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                              />
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="w-20">
                              <label className="block text-xs text-slate-400 mb-0.5">Colors</label>
                              <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden bg-white">
                                <button
                                  onClick={() => updateImprint(idx, { colors: Math.max(1, imp.colors - 1) })}
                                  className="w-7 h-8 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-sm transition flex-shrink-0"
                                >
                                  −
                                </button>
                                <div className="flex-1 text-center font-bold text-slate-800 text-sm">
                                  {imp.colors}
                                </div>
                                <button
                                  onClick={() => updateImprint(idx, { colors: Math.min(8, imp.colors + 1) })}
                                  className="w-7 h-8 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-sm transition flex-shrink-0"
                                >
                                  +
                                </button>
                              </div>
                            </div>
                            <div className="flex-1 min-w-28">
                              <label className="block text-xs text-slate-400 mb-0.5">Pantone(s)</label>
                              <input
                                value={imp.pantones || ""}
                                onChange={(e) => updateImprint(idx, { pantones: e.target.value })}
                                placeholder="e.g. PMS 286 C, White"
                                className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                              />
                            </div>
                          </>
                        )}

                        <div className="w-28">
                          <label className="block text-xs text-slate-400 mb-0.5">Technique</label>
                          <select
                            value={imp.technique}
                            onChange={(e) => updateImprint(idx, { technique: e.target.value })}
                            className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
                          >
                            {getEnabledTechniques().map((t) => (
                              <option key={t}>{t}</option>
                            ))}
                          </select>
                        </div>

                        {(li.imprints || []).length > 1 && (
                          <button
                            onClick={() => removeImprint(idx)}
                            className="text-slate-300 hover:text-red-400 text-xs mt-4"
                          >
                            ✕
                          </button>
                        )}
                      </div>

                      <div>
                        <label className="block text-xs text-slate-400 mb-0.5">
                          Special Instructions
                        </label>
                        <input
                          value={imp.details || ""}
                          onChange={(e) => updateImprint(idx, { details: e.target.value })}
                          placeholder="Any special notes or instructions..."
                          className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-2 space-y-2">
                <div className="text-xs text-slate-400 bg-slate-50 rounded-lg px-3 py-1.5 border border-slate-100">
                  {(li.imprints || [])[0]?.technique === "Embroidery"
                    ? "Pricing note: Embroidery priced by stitch count. Additional locations at 70%. Digitizing fee may apply."
                    : "Pricing note: First print = location with fewest colors. All pricing includes setup."}
                </div>
              </div>
            </div>
          </div>

          <div className="p-5 bg-slate-50">
            <PricePanel
              li={sizePricesRef.current ? { ...li, sizePrices: sizePricesRef.current } : li}
              rushRate={rushRate}
              extras={extras}
              allLineItems={previewLineItems}
              markup={STANDARD_MARKUP}
              onChange={onChange}
            />
          </div>
        </div>
      )}
    </div>
  );
}