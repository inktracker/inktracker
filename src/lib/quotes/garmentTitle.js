import { cleanText, looksLikeCode, isWarehouseSku, extractTrailingCode } from "./lineItemText";
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


// ── Shared garment HEADER resolver ───────────────────────────────────────────
// ONE header builder for every customer- and shop-facing surface — the quote
// detail (admin), the customer QuotePayment page, and the PDF. These had each
// forked their own copy and drifted: the customer page showed the raw supplier
// spec paragraph ("1717 - 6.1-ounce, 100% US ring spun cotton…") while the
// admin quote read cleanly ("1717 - COMFORT COLORS Heavyweight Ring Spun Tee").
// Joe, 2026-10-01: "have it match how the admin quotes read." This IS the admin
// quote's logic, lifted verbatim, so all three now render identically.

const DASH = "[-–—]"; // hyphen, en-dash, em-dash

function resolveGarmentNumber(li) {
  const candidates = [
    li?.supplierStyleNumber, li?.resolvedStyleNumber, li?.styleNumber,
    li?.garmentNumber, li?.productNumber, li?.style,
  ];
  for (const candidate of candidates) {
    const value = cleanText(candidate).toUpperCase();
    if (!value) continue;
    if (isWarehouseSku(value)) continue;
    if (!looksLikeCode(value)) continue;
    return value;
  }
  const productTitleTail = extractTrailingCode(li?.productTitle).toUpperCase();
  if (productTitleTail && !isWarehouseSku(productTitleTail)) return productTitleTail;
  const resolvedTitleTail = extractTrailingCode(li?.resolvedTitle).toUpperCase();
  if (resolvedTitleTail && !isWarehouseSku(resolvedTitleTail)) return resolvedTitleTail;
  return cleanText(li?.style).toUpperCase() || "GARMENT";
}

// Take the first sentence and hard-cap at 80 chars so a marketing paragraph
// doesn't run off the line; supplier names that ARE clean pass through whole.
function trimToShortTitle(text) {
  if (!text) return "";
  const firstSentence = String(text).split(/(?<=\.)\s+/)[0] || text;
  const trimmed = firstSentence.replace(/\.$/, "").trim();
  if (trimmed.length > 80) return trimmed.slice(0, 77).trimEnd() + "…";
  return trimmed;
}

function scrubDescription(raw, garmentNumber, brand) {
  if (!raw) return "";
  let t = cleanText(raw);
  t = t.replace(new RegExp(`^[A-Z0-9-]{2,20}\\s*${DASH}\\s*`, "i"), "");
  t = t.replace(new RegExp(`\\s*${DASH}\\s*[A-Z0-9-]{2,20}\\s*$`, "i"), "");
  if (garmentNumber) {
    const escaped = garmentNumber.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
    t = t.replace(new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`, "gi"), " ");
  }
  t = t.replace(new RegExp(`^[\\s${DASH}]+|[\\s${DASH}]+$`, "g"), "").replace(/\s{2,}/g, " ").trim();
  if (brand && t.toLowerCase() === brand.toLowerCase()) return "";
  return t;
}

function resolveGarmentDescription(li) {
  const garmentNumber = resolveGarmentNumber(li).toLowerCase();
  const rawCandidates = [
    li?.styleName, li?.resolvedDescription, li?.productDescription,
    li?.product_description, li?.garmentName, li?.productTitle,
    li?.resolvedTitle, li?.description, li?.displayName, li?.title,
  ];
  const brand = cleanText(li?.brand).toLowerCase();
  for (const raw of rawCandidates) {
    const candidate = scrubDescription(raw, garmentNumber, brand);
    if (!candidate) continue;
    const normalized = candidate.toLowerCase();
    if (normalized === garmentNumber) continue;
    if (looksLikeCode(candidate)) continue;
    if (["shirt", "garment", "tee"].includes(normalized)) continue;
    return candidate;
  }
  return "";
}

// The one header string every surface renders. customTitle (shop's own) wins;
// else "STYLE - <short supplier name>"; else just the style number.
export function resolveGarmentHeader(li) {
  const number = resolveGarmentNumber(li);
  const custom = customGarmentHeader(li, number);
  if (custom) return custom;
  const storedName = cleanText(li?.productName || "");
  const rawDescription = (storedName && !looksLikeCode(storedName))
    ? storedName
    : resolveGarmentDescription(li);
  const description = trimToShortTitle(rawDescription);
  return description ? `${number} - ${description}` : number;
}
