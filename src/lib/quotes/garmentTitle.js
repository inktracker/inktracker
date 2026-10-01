// Custom garment title — the shop's own display text for a line item.
//
// Root cause (Truman, 2026-08-03, style 31-069): the shop sells an OTTO
// cap numbered 31-069, but S&S also has a 31-069 (a women's fleece
// crewneck). The style-blur supplier lookup matched S&S's product and
// stamped its name over every naming field, so the display header read
// "WOMEN'S REFLEX FLEECE CREWNECK SWEATSHIRT" — and there was NO field
// anywhere to type the shop's own title (the user resorted to cramming
// it into Brand).
//
// `customTitle` is that field. The contract, enforced across every
// header renderer (LineItemEditor, QuoteDetailModal, QuotePayment,
// pdfExport, BrokerPricePanel, order modal, QB line description):
//
//   1. When set, customTitle WINS over every resolved/supplier field.
//   2. Supplier lookups (applySelectedMatch, both editors) never write it.
//   3. BLANKING the style number never clears it — it's the shop's text,
//      and blanking is how you re-search the same garment.
//   4. Retyping the style number to a DIFFERENT one DOES clear it
//      (customTitleAfterStyleChange, below). Joe, 2026-09-28: duplicated a
//      garment line, pointed the copy at AS Colour 5030, and the header
//      still read "5030 - HEAVY FADED MINUS TEE" — the title he'd typed for
//      the ORIGINAL garment. Duplicate copies the whole line, customTitle
//      included, and rule 1 then makes that stale text beat the correct
//      supplier name on the quote, the PDF, the customer page and the QB
//      line description. A title names one garment; a new style number is a
//      new garment.
//
// Keep this the single source of that precedence — five header builders
// already forked before this existed; don't add a sixth reading
// customTitle its own way.

const clean = (v) => (typeof v === "string" ? v.trim() : "");

/** The shop's custom title for this line, or "" when unset. */
export function getCustomGarmentTitle(li) {
  return clean(li?.customTitle);
}

/**
 * Header line "STYLE - TITLE" when a custom title is set; null otherwise
 * so callers fall through to their existing resolved-field logic.
 * `styleNumber` comes from the caller (each surface already has its own
 * preferred-number logic; don't fork that too).
 */
/**
 * The customTitle a line should keep when its style number changes to
 * `nextStyle` — "" when the title described a DIFFERENT garment (rule 4).
 *
 * Compares against the line's CURRENT style, so it is safe to call from a
 * per-keystroke onChange: the first edited character already makes the
 * number a different one. Blanking the field keeps the title (rule 3).
 */
export function customTitleAfterStyleChange(li, nextStyle) {
  const title = getCustomGarmentTitle(li);
  if (!title) return "";
  const next = clean(nextStyle);
  if (!next) return title;                    // blanked → keep (rule 3)
  const prev = clean(li?.style);
  // Same number modulo case/whitespace → same garment → keep.
  return next.toLowerCase() === prev.toLowerCase() ? title : "";
}

export function customGarmentHeader(li, styleNumber) {
  const title = getCustomGarmentTitle(li);
  if (!title) return null;
  const num = clean(styleNumber);
  // Don't render "31-069 - 31-069" when the custom title IS the number.
  if (num && title.toLowerCase() === num.toLowerCase()) return num;
  return num ? `${num} - ${title}` : title;
}

// Supplier catalogs (AS Colour, Comfort Colors, …) stuff the full marketing/
// spec PARAGRAPH into the product-name fields (styleName / productTitle /
// resolvedTitle). Used as a line-item header it becomes a wall of "6.1-ounce,
// 100% US ring spun cotton Soft-washed, garment-dyed fabric…" on the customer
// quote — ugly, and worse on a broker's white-label quote (Joe, 2026-10-01).
// Treat such text as NOT a product name so the header falls back to a clean
// "Brand Style#". A real garment name is short and reads like a title.
export function isSpecDump(text) {
  const t = clean(text);
  if (!t) return false;
  if (t.length > 55) return true;                          // names are short
  if (/[.!?]\s+\S/.test(t)) return true;                   // more than one sentence
  if (/\b\d+(?:\.\d+)?\s?(?:oz|ounce|gsm|singles|gm)\b/i.test(t)) return true; // spec
  return false;
}

// The fallback header when no concise product name exists: "Brand Style#"
// (e.g. "Comfort Colors 1717"), or whichever half is present.
export function brandStyleHeader(brand, styleNumber) {
  const b = clean(brand);
  const n = clean(styleNumber);
  if (b && n) return `${b} ${n}`;
  return b || n || "Garment";
}

// Singular, human label for a wizard garment category ("T-Shirts" → "T-Shirt")
// so a header with no supplier name can still say WHAT the garment is:
// "Comfort Colors 1717 — T-Shirt" instead of a bare SKU (Joe, 2026-10-01).
// Simple plurals get de-pluralized; compound categories ("Hoodies &
// Sweatshirts") are left as-is (still informative).
export function categoryLabel(category) {
  const c = clean(category);
  if (!c) return "";
  if (c.includes("&")) return c;           // compound — leave it
  return c.replace(/s$/i, "");             // T-Shirts→T-Shirt, Tanks→Tank, Polos→Polo
}

// The full fallback header when no supplier product NAME exists:
// "Brand Style — Category", dropping any half that's missing. The spec
// paragraph is never used; the category gives the garment type.
export function brandStyleCategoryHeader(brand, styleNumber, category) {
  const base = brandStyleHeader(brand, styleNumber);
  const cat = categoryLabel(category);
  return cat ? `${base} — ${cat}` : base;
}
