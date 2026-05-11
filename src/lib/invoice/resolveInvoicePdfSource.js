/**
 * Decide where the PDF for an invoice should come from.
 *
 *   resolveInvoicePdfSource(invoice) -> {
 *     source: "qb" | "local",
 *     qbInvoiceId: string | null,
 *   }
 *
 * Rule: if the invoice has been synced to QuickBooks (`qb_invoice_id` is a
 * non-empty string), QB is the source of truth — fetch the PDF QB generated
 * so customers see the same document QB sends out. Otherwise fall back to
 * our locally-generated PDF.
 *
 * Pure function. No I/O. Tests at __tests__/resolveInvoicePdfSource.test.js.
 */
export function resolveInvoicePdfSource(invoice) {
  const qbId = invoice?.qb_invoice_id;
  if (typeof qbId === "string" && qbId.trim().length > 0) {
    return { source: "qb", qbInvoiceId: qbId };
  }
  if (typeof qbId === "number" && Number.isFinite(qbId)) {
    return { source: "qb", qbInvoiceId: String(qbId) };
  }
  return { source: "local", qbInvoiceId: null };
}
