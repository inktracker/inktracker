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
//   3. Clearing the style number never clears it — it's the shop's text.
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
export function customGarmentHeader(li, styleNumber) {
  const title = getCustomGarmentTitle(li);
  if (!title) return null;
  const num = clean(styleNumber);
  // Don't render "31-069 - 31-069" when the custom title IS the number.
  if (num && title.toLowerCase() === num.toLowerCase()) return num;
  return num ? `${num} - ${title}` : title;
}
