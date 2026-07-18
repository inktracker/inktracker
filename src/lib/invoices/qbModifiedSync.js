// "Modified in QuickBooks — sync?" logic (pure).
//
// The qbWebhook mirrors QB-side edits onto qb_* columns in real time
// and notifies the shop; these helpers power the consent step — the
// banner that says QB disagrees, and the patches that adopt QB's
// numbers onto the as-sold rows when the shop clicks Sync. Adoption is
// always explicit (quote-snapshot invariant: nothing rewrites as-sold
// totals without the operator's click).

const TOLERANCE = 0.01;

const centsDelta = (a, b) => Math.abs(Number((Number(a) - Number(b)).toFixed(2)));

/**
 * Does this row's as-sold total disagree with QB's mirrored total?
 * Rows never mirrored (qb_total null) are never "modified".
 */
export function qbModifiedState(row) {
  if (!row || row.qb_total == null || row.total == null) {
    return { modified: false, localTotal: null, qbTotal: null, delta: 0 };
  }
  const localTotal = Number(row.total);
  const qbTotal = Number(row.qb_total);
  const delta = Number((qbTotal - localTotal).toFixed(2));
  return { modified: centsDelta(localTotal, qbTotal) > TOLERANCE, localTotal, qbTotal, delta };
}

const fmtUsd = (n) => `$${Number(n).toFixed(2)}`;

/**
 * One-line audit note describing what a QB sync changed, appended to
 * the invoice's existing notes so the change survives on the invoice
 * (and its PDF) permanently. Each sync appends its own dated line —
 * repeated syncs build a history, not a overwrite.
 */
export function buildSyncNote({ existingNotes, localTotal, qbTotal, localTax, qbTax, today }) {
  const date = today || new Date().toISOString().split("T")[0];
  let line = `[${date}] Synced from QuickBooks: total ${fmtUsd(localTotal)} → ${fmtUsd(qbTotal)}`;
  if (centsDelta(localTax ?? 0, qbTax ?? 0) > TOLERANCE) {
    line += `, tax ${fmtUsd(localTax ?? 0)} → ${fmtUsd(qbTax ?? 0)}`;
  }
  const prior = typeof existingNotes === "string" ? existingNotes.trim() : "";
  return prior ? `${prior}\n${line}` : line;
}

/**
 * Build the adopt patches for the invoice row and (when linked) its
 * quote and order, from the invoice's qb_* mirror. QB is the billing
 * authority: totals/tax follow QB; line items and production detail
 * are never touched. The invoice patch appends a dated sync note so
 * the adopted change is recorded on the invoice itself.
 */
export function buildAdoptPatches(invoice, { today } = {}) {
  const qbTotal = Number(invoice?.qb_total);
  if (!Number.isFinite(qbTotal)) return null;
  const qbTax = Number(invoice?.qb_tax_amount) || 0;
  const qbSubtotal = invoice?.qb_subtotal != null
    ? Number(invoice.qb_subtotal)
    : Number((qbTotal - qbTax).toFixed(2));
  // Effective rate against QB's own taxable base — matches how the
  // accept-QB-tax path derives it (qbSync adoptQbTaxFields).
  const taxRate = qbSubtotal > 0 ? Number(((qbTax / qbSubtotal) * 100).toFixed(4)) : 0;

  // Local `subtotal` is PRE-discount by app semantics; QB's is
  // post-discount. Overwriting it on a discounted row would make the
  // displayed breakdown subtract the discount twice (same rule the
  // pullInvoices item-preservation guard follows). Adopt subtotal only
  // when there's no discount in play; total/tax are always adopted —
  // they're the money truth.
  const hasDiscount = (Number(invoice?.discount) || 0) > 0;
  const notes = buildSyncNote({
    existingNotes: invoice?.notes,
    localTotal: invoice?.total ?? 0,
    qbTotal,
    localTax: invoice?.tax ?? 0,
    qbTax,
    today,
  });
  const invoicePatch = hasDiscount
    ? { tax: qbTax, total: qbTotal, tax_rate: taxRate, notes }
    : { subtotal: qbSubtotal, tax: qbTax, total: qbTotal, tax_rate: taxRate, notes };

  return {
    invoice: invoicePatch,
    quote:   { tax: qbTax, total: qbTotal, tax_rate: taxRate },
    order:   { tax: qbTax, total: qbTotal, tax_rate: taxRate },
  };
}
