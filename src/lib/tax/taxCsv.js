// CSV exporters for the sales-tax records (Phase 4 of multi-state tax).
// Instead of integrating a tax engine for non-QB shops, InkTracker hands the
// shop filing-ready data to give their accountant or import anywhere. Pure —
// builders return strings, the caller does the download. Mirrors poCsv.js.

/** RFC-4180-ish cell escape: quote anything with a comma/quote/newline. */
function csvCell(value) {
  if (value == null) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function money(n) {
  return (Number(n) || 0).toFixed(2);
}

const SUMMARY_HEADERS = ["State", "Invoices", "Taxable", "Tax Collected", "Total", "Exempt Invoices"];

/** By-state summary CSV from summarizeTaxByState() rows. */
export function buildTaxSummaryCsv(rows) {
  const out = [SUMMARY_HEADERS.join(",")];
  for (const r of rows || []) {
    out.push([
      csvCell(r.state),
      csvCell(r.count),
      money(r.taxable),
      money(r.tax),
      money(r.total),
      csvCell(r.exemptCount || 0),
    ].join(","));
  }
  return out.join("\n") + "\n";
}

const DETAIL_HEADERS = [
  "Date", "QB Invoice", "Quote", "Customer", "Ship-to State", "Ship-to ZIP",
  "Authority", "Subtotal", "Taxable", "Tax", "Total", "Effective Rate %",
  "Exempt", "Exemption Type", "Certificate #",
];

/** Per-invoice detail CSV from raw tax_records rows. */
export function buildTaxDetailCsv(records) {
  const out = [DETAIL_HEADERS.join(",")];
  for (const r of records || []) {
    out.push([
      csvCell(r.txn_date),
      csvCell(r.qb_invoice_id),
      csvCell(r.quote_id),
      csvCell(r.customer_name),
      csvCell(r.ship_to_state),
      csvCell(r.ship_to_zip),
      csvCell(r.authority),
      money(r.subtotal),
      money(r.taxable_amount),
      money(r.tax_total),
      money(r.total),
      csvCell(r.effective_rate == null ? "" : Number(r.effective_rate).toFixed(4)),
      csvCell(r.exempt ? "yes" : "no"),
      csvCell(r.exemption_type),
      csvCell(r.exemption_certificate_number),
    ].join(","));
  }
  return out.join("\n") + "\n";
}

/** Suggested filename: sales-tax-<kind>-<from>-<to>.csv (or -alltime). */
export function buildTaxCsvFilename(kind, { from, to } = {}) {
  const range = from || to ? `${from || "start"}_${to || "today"}` : "alltime";
  return `sales-tax-${kind}-${range}.csv`;
}
