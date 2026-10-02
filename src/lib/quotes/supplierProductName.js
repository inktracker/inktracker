// ONE garment product-name resolver for every supplier-lookup editor.
//
// Both the shop quote editor (LineItemEditor) and the broker quote editor
// (BrokerLineItemEditor) take a supplier match (SanMar / S&S / AS Colour) and
// stamp a product NAME onto the line. They had forked this: LineItemEditor
// guarded against a marketing PARAGRAPH becoming the name (S&S uses a short
// description as the style name, but SanMar/AS Colour stuff the full spec
// paragraph into the description field), while BrokerLineItemEditor fell back
// to that long description UNCONDITIONALLY. Result: broker quotes stored
// "6.1-ounce, 100% US ring spun cotton Soft-washed, garment-dyed fabric…" as
// the garment name where the shop path stored "COMFORT COLORS Heavyweight Ring
// Spun Tee" — same style, same day (Joe, 2026-10-01). This is the shared,
// guarded logic both now use so they can't diverge again.

import { cleanText, looksLikeCode } from "./lineItemText";

// Extract the product description from a resolvedTitle like
// "Brand — Desc — PartNumber" — strips the brand prefix and part-number suffix.
export function extractDescFromTitle(title, brand, partNumber) {
  let t = cleanText(title);
  if (!t) return "";
  const num = cleanText(partNumber);
  if (brand) {
    const esc = cleanText(brand).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    t = t.replace(new RegExp(`^${esc}\\s*[-–—]\\s*`, "i"), "");
  }
  if (num) {
    const esc = num.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    t = t.replace(new RegExp(`\\s*[-–—]\\s*${esc}\\s*$`, "i"), "");
  }
  t = t.trim();
  if (!t || looksLikeCode(t) || t.toUpperCase() === num.toUpperCase()) return "";
  return t;
}

// The clean garment name for a supplier match. Precedence:
//   1. resolvedTitle (supplier's clean product title, style code already stripped)
//   2. the raw description — ONLY when it's SHORT (<80, not a code, not the
//      style number). A spec/marketing PARAGRAPH is never used as a name.
//   3. the middle segment extracted from a "Brand — Desc — PartNumber" title
// Returns "" when nothing clean is available (callers keep the prior value /
// let the display header fall back to the bare style number) — never a paragraph.
export function resolveSupplierProductName(selectedMatch, { brand = "", styleNumber = "" } = {}) {
  if (!selectedMatch) return "";
  const num = cleanText(styleNumber).toUpperCase();
  const resolvedTitle = cleanText(
    selectedMatch.resolvedTitle || selectedMatch.raw?.resolvedTitle || ""
  );
  const rawDesc = cleanText(selectedMatch.raw?.description || "");
  const isShortDesc =
    !!rawDesc && rawDesc.length < 80 && !looksLikeCode(rawDesc) && rawDesc.toUpperCase() !== num;

  let productName = resolvedTitle || (isShortDesc ? rawDesc : "");
  if (!productName) {
    const rawTitle = cleanText(
      selectedMatch.raw?.resolvedTitle || selectedMatch.raw?.title || ""
    );
    productName = extractDescFromTitle(rawTitle, cleanText(brand), num);
  }
  return productName;
}
