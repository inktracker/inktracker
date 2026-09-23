// Shared text/SKU parsing helpers for garment line items. These were
// copy-pasted verbatim into five components + pdfExport before this module
// existed (same story as customTitle precedence — see garmentTitle.js's
// header). One home so the code-detection heuristics can't drift: a style
// number that renders in the editor must parse identically on the customer
// PDF and the payment page.

export function cleanText(value) {
  return String(value || "").trim();
}

// "G5000", "PC61-LS", "1717" — short alphanumeric style codes (must contain
// a digit, no spaces) as opposed to prose titles.
export function looksLikeCode(value) {
  const txt = cleanText(value);
  if (!txt) return false;
  return /^[A-Z0-9-]{2,30}$/i.test(txt) && /\d/.test(txt) && !txt.includes(" ");
}

// Supplier warehouse SKUs (leading-zero or long all-digit runs) — never
// customer-facing style numbers.
export function isWarehouseSku(value) {
  const txt = cleanText(value).toUpperCase();
  if (!txt) return false;
  return /^0\d{3,}$/.test(txt) || /^\d{5,}$/.test(txt);
}

// "Heavyweight Tee - 1717" → "1717"
export function extractTrailingCode(title) {
  const txt = cleanText(title);
  if (!txt) return "";
  const match = txt.match(/-\s*([A-Z0-9-]{2,30})$/i);
  return match ? cleanText(match[1]).toUpperCase() : "";
}

// "Heavyweight Tee - 1717" → "Heavyweight Tee"
export function stripTrailingCode(title) {
  const txt = cleanText(title);
  if (!txt) return "";
  return txt.replace(/\s*-\s*[A-Z0-9-]{2,30}\s*$/i, "").trim();
}
