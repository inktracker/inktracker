import { useEffect, useMemo, useRef, useState } from "react";
import {
  SIZES,
  BIG_SIZES,
  LOCATIONS,
  TECHNIQUES,
  GARMENT_CATEGORIES,
  mapSSCategoryToGarment,
  getQty,
  uid,
} from "../shared/pricing";
import BrokerPricePanel from "./BrokerPricePanel";
import Icon from "../shared/Icon";
import { supabase } from "@/api/supabaseClient";

async function lookupStyle(styleNumber) {
  const { data, error } = await supabase.functions.invoke("ssLookupStyle", {
    body: { styleNumber: String(styleNumber || "").trim().toUpperCase() },
  });
  if (error) throw error;
  return data;
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
        item?.styleNumber ||
        item?.productNumber ||
        item?.style ||
        `match-${index}`,
      styleNumber: cleanText(
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
  const candidates = [
    stripTrailingCode(selectedMatch?.resolvedTitle),
    stripTrailingCode(selectedMatch?.title),
    stripTrailingCode(selectedMatch?.raw?.resolvedTitle),
    stripTrailingCode(selectedMatch?.raw?.resolved_title),
    stripTrailingCode(selectedMatch?.raw?.title),
    stripTrailingCode(selectedMatch?.raw?.productTitle),
    stripTrailingCode(selectedMatch?.raw?.product_title),
    cleanText(selectedMatch?.raw?.resolvedDescription),
    cleanText(selectedMatch?.raw?.resolved_description),
    cleanText(selectedMatch?.raw?.productDescription),
    cleanText(selectedMatch?.raw?.product_description),
    cleanText(selectedMatch?.raw?.description),
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

function applySelectedMatch(li, selectedMatch) {
  const styleNumber = cleanText(selectedMatch.styleNumber).toUpperCase();
  // Prefer the edge function's raw product description ("Unisex Heavyweight
  // Hooded Sweatshirt") — the option-level `description` is often a
  // brand+partnumber label that doesn't carry garment-type keywords.
  const description = cleanText(
    selectedMatch.raw?.description ||
    selectedMatch.description
  );
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
    styleName: description || li.styleName,
    garmentNumber: styleNumber || li.garmentNumber,
    resolvedStyleNumber: styleNumber || li.resolvedStyleNumber,
    styleNumber: styleNumber || li.styleNumber || "",
    productNumber: styleNumber || li.productNumber || "",
    supplierStyleNumber: styleNumber || li.supplierStyleNumber || "",
    productTitle: description || li.productTitle || "",
    resolvedTitle: description || li.resolvedTitle || "",
    resolvedDescription: description || li.resolvedDescription || "",
    productDescription: description || li.productDescription || "",
    description: description || li.description || "",
    garmentName: description || li.garmentName || "",
    category: mapSSCategoryToGarment(
      selectedMatch.styleCategory,
      description || selectedMatch.description
    ) || li.category || "",
    supplier: "S&S Activewear",
    supplierLastLookupAt: new Date().toISOString(),
    sizePrices: (selectedMatch.sizePriceMap && selectedMatch.sizePriceMap[firstColor]) || {},
  };
}

export default function BrokerLineItemEditor({
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
  const sizePricesRef = useRef(li.sizePrices || null);
  const onChange = (updated) => {
    if (updated.sizePrices && Object.keys(updated.sizePrices).length > 0) {
      sizePricesRef.current = updated.sizePrices;
    }
    if (sizePricesRef.current) {
      updated = { ...updated, sizePrices: sizePricesRef.current };
    }
    _rawOnChange(updated);
  };
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [ssColors, setSsColors] = useState([]);
  const [ssInventory, setSsInventory] = useState({});
  const [ssPriceMap, setSsPriceMap] = useState({});
  const [ssLoading, setSsLoading] = useState(false);
  const [ssError, setSsError] = useState(null);
  const [brandOptions, setBrandOptions] = useState([]);

  const qty = getQty(li);

  // Persist sizePrices on the line item when color data is available
  useEffect(() => {
    const colorPrices = (ssColors.find(c => c.colorName === li.garmentColor) || {}).sizePrices;
    if (colorPrices && Object.keys(colorPrices).length > 0) {
      sizePricesRef.current = colorPrices;
      const current = li.sizePrices || {};
      if (JSON.stringify(current) !== JSON.stringify(colorPrices)) {
        _rawOnChange({ ...li, sizePrices: colorPrices });
      }
    }
  }, [ssColors, li.garmentColor]);

  const previewLineItems = useMemo(
    () => (allLineItems || []).map((item) => (item.id === li.id ? li : item)),
    [allLineItems, li]
  );

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

      const selected =
        options.find(
          (option) =>
            cleanText(option.brandName).toLowerCase() === cleanText(li.brand).toLowerCase()
        ) || options[0];

      if (!selected) {
        throw new Error("No valid S&S results found");
      }

      setSsColors(selected.colors || []);
      setSsInventory(selected.inventoryMap || {});
      setSsPriceMap(selected.priceMap || {});
      onChange(applySelectedMatch(li, selected));
    } catch (e) {
      setBrandOptions([]);
      setSsColors([]);
      setSsInventory({});
      setSsPriceMap({});
      setSsError("Style not found on S&S");
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
    onChange(applySelectedMatch(li, selected));
  }

  function handleColorChange(colorName) {
    const selectedPrice = ssPriceMap[colorName] || {};
    const colorSizePrices = (ssColors.find(c => c.colorName === colorName) || {}).sizePrices || {};
    onChange({
      ...li,
      garmentColor: colorName,
      garmentCost:
        selectedPrice.piecePrice != null ? Number(selectedPrice.piecePrice) : li.garmentCost,
      casePrice:
        selectedPrice.casePrice != null ? Number(selectedPrice.casePrice) : li.casePrice,
      sizePrices: colorSizePrices,
    });
  }

  const currentInventory = ssInventory[li.garmentColor] || {};
  const selectedBrandOption =
    brandOptions.find(
      (option) =>
        cleanText(option.brandName).toLowerCase() === cleanText(li.brand).toLowerCase() &&
        cleanText(option.styleNumber).toUpperCase() ===
          cleanText(li.supplierStyleNumber || li.resolvedStyleNumber || li.styleNumber).toUpperCase()
    ) || brandOptions[0];

  function updateImprint(idx, patch) {
    const imprints = (li.imprints || []).map((im, i) =>
      i === idx ? { ...im, ...patch } : im
    );
    onChange({ ...li, imprints });
  }

  function addImprint() {
    if ((li.imprints || []).length >= 5) return;
    onChange({
      ...li,
      imprints: [
        ...(li.imprints || []),
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
    });
  }

  function removeImprint(idx) {
    onChange({ ...li, imprints: (li.imprints || []).filter((_, i) => i !== idx) });
  }

  return (
    <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white">
      <div className="bg-slate-50 px-5 py-3 border-b border-slate-200 space-y-3">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="text-sm text-slate-400 hover:text-slate-600 font-semibold transition"
          >
            {isCollapsed ? "▶ Expand" : "▼ Collapse"}
          </button>
          <div className="flex gap-3">
            {onDuplicate && (
              <button
                onClick={onDuplicate}
                className="text-xs text-indigo-500 hover:text-indigo-700 transition font-semibold"
              >
                ⧉ Duplicate
              </button>
            )}
            {canRemove && (
              <button
                onClick={onRemove}
                className="text-xs text-slate-300 hover:text-red-400 transition"
              >
                ✕ Remove
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-5 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">
              Style #
              {ssLoading && <span className="ml-1 text-indigo-400 normal-case font-normal">Looking up…</span>}
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
                value={selectedBrandOption?.id || ""}
                onChange={(e) => handleBrandSelection(e.target.value)}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
              >
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
                placeholder="e.g. Banana"
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
      </div>

      {!isCollapsed && (
        <div className="grid grid-cols-2 divide-x divide-slate-100">
          <div className="p-5 space-y-5">
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
                  2XL+ sizes highlighted — pricing based on actual wholesale cost per size.
                </div>
              )}
            </div>

            <div>
              <div className="flex justify-between items-center mb-3">
                <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                  Print Locations
                </div>
                <div className="flex gap-2 items-center">
                  <button
                    onClick={addImprint}
                    className="text-xs font-semibold text-indigo-600 border border-indigo-100 px-2.5 py-1 rounded-lg hover:bg-indigo-50 transition"
                  >
                    + Add Location
                  </button>
                </div>
              </div>

              <div className="space-y-2.5">
                {(li.imprints || []).map((imp, idx) => (
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

                      <div className="w-28">
                        <label className="block text-xs text-slate-400 mb-0.5">Technique</label>
                        <select
                          value={imp.technique}
                          onChange={(e) => updateImprint(idx, { technique: e.target.value })}
                          className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
                        >
                          {TECHNIQUES.map((t) => (
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
                      <label className="block text-xs text-slate-400 mb-0.5">Special Instructions</label>
                      <input
                        value={imp.details || ""}
                        onChange={(e) => updateImprint(idx, { details: e.target.value })}
                        placeholder="Any special notes or instructions..."
                        className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-2 space-y-2">
                <div className="text-xs text-slate-400 bg-slate-50 rounded-lg px-3 py-1.5 border border-slate-100">
                  Pricing note: First print = location with fewest colors. All pricing includes setup.
                </div>
                <div className="text-xs text-emerald-700 bg-emerald-50 rounded-lg px-3 py-1.5 border border-emerald-100">
                  Link matching artwork across garment groups to combine quantity for the print tier.
                </div>
              </div>
            </div>
          </div>

          <div className="p-5 bg-slate-50 space-y-4">
            <div>
              <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">
                Live Pricing Estimate
              </div>
              <BrokerPricePanel
                li={li}
                rushRate={rushRate}
                extras={extras}
                allLineItems={previewLineItems}
                onChange={onChange}
                sizePrices={(ssColors.find(c => c.colorName === li.garmentColor) || {}).sizePrices || undefined}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}