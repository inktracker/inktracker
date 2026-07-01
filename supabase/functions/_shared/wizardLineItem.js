// Pure line-item normalization for the bulk quote-create path
// (createQuoteFromPayload). Accepts the modal's LineItemEditor output OR a
// slimmer automation/wizard shape and fills defaults, so a caller that pastes
// a spreadsheet or drives it from an integration produces the same row shape
// the app expects.
//
// Extracted from createQuoteFromPayload/index.ts so it's unit-testable without
// booting the edge function. `now` is injected so generated ids are
// deterministic in tests (mirrors buildOrderFromQuote's `now`).

export function normalizeLineItem(raw, idx, now = Date.now()) {
  const ts = now;
  const sizes = {};
  if (raw?.sizes && typeof raw.sizes === "object") {
    for (const [k, v] of Object.entries(raw.sizes)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) sizes[k] = n;
    }
  }

  // Imprints can be a single object, an array, or absent. Normalize to array.
  let imprints = [];
  if (Array.isArray(raw?.imprints)) {
    imprints = raw.imprints;
  } else if (raw?.imprint && typeof raw.imprint === "object") {
    imprints = [raw.imprint];
  }
  if (imprints.length === 0) {
    imprints = [{
      id: `imp-${idx}-${ts}`,
      title: "",
      location: "Front",
      width: "",
      height: "",
      colors: 1,
      pantones: "",
      technique: "Screen Print",
      details: "",
      linked: false,
    }];
  } else {
    imprints = imprints.map((imp, i) => ({
      id: imp.id || `imp-${idx}-${i}-${ts}`,
      title: imp.title || "",
      location: imp.location || "Front",
      width: imp.width || "",
      height: imp.height || "",
      colors: Number(imp.colors) || 1,
      pantones: imp.pantones || "",
      technique: imp.technique || "Screen Print",
      details: imp.details || "",
      linked: !!imp.linked,
    }));
  }

  return {
    id: raw?.id || `li-${idx}-${ts}`,
    style: raw?.style || "",
    brand: raw?.brand || "",
    category: raw?.category || raw?.garment || "",
    garmentColor: raw?.garmentColor || raw?.color || "",
    garmentCost: Number(raw?.garmentCost) || 0,
    sizes,
    imprints,
    // Pass through optional catalog fields if provided
    ...(raw?.styleName ? { styleName: raw.styleName } : {}),
    ...(raw?.resolvedTitle ? { resolvedTitle: raw.resolvedTitle } : {}),
    ...(raw?.productNumber ? { productNumber: raw.productNumber } : {}),
    ...(raw?.supplier ? { supplier: raw.supplier } : {}),
  };
}
