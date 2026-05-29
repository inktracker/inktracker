// Convert a PurchaseOrder row into a CSV string for paste / upload
// into a supplier's "order assistant" tool. AS Colour shipped one in
// May 2026 that accepts CSV / Excel / PDF / plain text describing an
// order — this exporter targets the CSV path. Operators can also use
// the file as a paper trail to email a supplier directly when API
// submission isn't an option.
//
// Format choice:
//   Style, Color, Size, Quantity, SKU
//
// Why these columns: the assistant's "parse this list" tool keys on
// style + color + size + qty; SKU is added as a parsing hint when the
// shop already has the supplier's SKU saved (skips fuzzy matching).
// Columns deliberately match the Inventory restock CSV the shop
// already produces — operators only learn one format.
//
// Pure — accepts a PO object, returns a string. No side effects, no
// DOM, trivially testable.

const HEADERS = ["Style", "Color", "Size", "Quantity", "SKU"];

/**
 * Escapes a single CSV cell. RFC-4180-ish: wrap any value containing
 * a comma, quote, or newline in double quotes, and double any internal
 * quotes. Numeric values pass through as strings.
 */
function csvCell(value) {
  if (value == null) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Build the CSV string for a PurchaseOrder. Returns "" when the PO
 * has no items so callers can short-circuit the download.
 *
 * Item shape expected: { style, color, size, qty, sku }. Matches
 * what AddItemsPanel + shortfallReorder both produce, so PO items
 * created either way export cleanly.
 */
export function buildPOCsv(po) {
  const items = Array.isArray(po?.items) ? po.items : [];
  if (items.length === 0) return "";
  const rows = [HEADERS.join(",")];
  for (const item of items) {
    rows.push([
      csvCell(item.style),
      csvCell(item.color),
      csvCell(item.size),
      csvCell(item.qty),
      csvCell(item.sku),
    ].join(","));
  }
  // Trailing newline — most spreadsheet importers handle either, but
  // a final \n keeps Excel from flagging "incomplete final row" on
  // some Windows imports.
  return rows.join("\n") + "\n";
}

/**
 * Suggested filename for the downloaded CSV. Embeds supplier + PO
 * reference + date so a shop downloading several at once can sort
 * them in their Downloads folder without renaming.
 */
export function buildPOCsvFilename(po, today = new Date()) {
  const supplier = (po?.supplier || "Order").replace(/[^A-Za-z0-9]+/g, "");
  const ref = (po?.reference || "PO")
    .replace(/[^A-Za-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const date = today.toISOString().slice(0, 10);
  return `${supplier}-${ref}-${date}.csv`;
}
