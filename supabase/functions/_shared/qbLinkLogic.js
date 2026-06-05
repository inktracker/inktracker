// Pure logic for the qbSync `linkQbInvoice` action.
//
// Use case: a QB invoice was created outside InkTracker (operator
// added it manually in QuickBooks, or it was migrated from an old
// system) but the corresponding InkTracker quote isn't linked. The
// operator pastes either the QB invoice Id (numeric) or DocNumber
// (e.g. "Q-2026-115") into a UI, and the edge function locates the
// invoice and writes qb_invoice_id back to the quote.
//
// Pure helpers:
//   - classifyLinkInput      → discriminates Id vs DocNumber vs invalid
//   - chooseInvoiceCandidate → picks the right hit from a multi-result
//   - buildLinkPatch          → the partial update to write back

import { isQbInvoicePaid, extractPaymentLink } from "./qbInvoice.js";

export const LINK_INPUT_KIND = Object.freeze({
  ID:        "id",         // all-numeric, treat as Invoice.Id
  DOCNUMBER: "docnumber",  // anything else with a non-empty value
  INVALID:   "invalid",    // empty / non-string
});

/**
 * Classify what the operator typed.
 *
 * All-numeric → Id (QB Invoice.Id is numeric on every realm we've
 * observed). Anything else with at least one printable char →
 * DocNumber. Empty / whitespace-only → INVALID.
 */
export function classifyLinkInput(raw) {
  if (typeof raw !== "string") return { kind: LINK_INPUT_KIND.INVALID, value: "" };
  const trimmed = raw.trim();
  if (!trimmed) return { kind: LINK_INPUT_KIND.INVALID, value: "" };
  if (/^[0-9]+$/.test(trimmed)) return { kind: LINK_INPUT_KIND.ID, value: trimmed };
  return { kind: LINK_INPUT_KIND.DOCNUMBER, value: trimmed };
}

export const LINK_OUTCOMES = Object.freeze({
  OK:           "ok",
  NOT_FOUND:    "not-found",
  AMBIGUOUS:    "ambiguous",   // DocNumber matched multiple invoices
  INVALID:      "invalid",
});

/**
 * Given a QB SELECT result for the user's input, decide whether we
 * can link safely.
 *
 * For Id lookups: at most one hit by construction (Id is PK). Empty
 * = NOT_FOUND.
 *
 * For DocNumber lookups: QB allows the same DocNumber across multiple
 * invoices (it isn't a constraint), so a match list of >1 is ambiguous
 * — we refuse to link silently and ask the operator to clarify (use
 * the Id form instead).
 */
export function chooseInvoiceCandidate(kind, hits) {
  const list = Array.isArray(hits) ? hits : [];
  if (list.length === 0) {
    return { outcome: LINK_OUTCOMES.NOT_FOUND };
  }
  if (kind === LINK_INPUT_KIND.DOCNUMBER && list.length > 1) {
    return {
      outcome: LINK_OUTCOMES.AMBIGUOUS,
      count:   list.length,
      candidateIds: list.map((i) => String(i?.Id || "")).filter(Boolean),
    };
  }
  return { outcome: LINK_OUTCOMES.OK, invoice: list[0] };
}

/**
 * Patch to write back to `quotes` once we've validated the link.
 * Includes paid state — if the invoice we're linking to is already
 * paid in QB, we want to flip the quote immediately rather than wait
 * for the next refresh.
 */
export function buildLinkPatch(qbInvoice) {
  if (!qbInvoice) throw new Error("buildLinkPatch: qbInvoice required");
  // Defensive — chooseInvoiceCandidate returns whatever QB gave us
  // in QueryResponse.Invoice[0]. If the row is somehow missing Id,
  // we'd write qb_invoice_id="" to the quote which silently breaks
  // every future refresh. Refuse to build the patch instead.
  if (!qbInvoice.Id) throw new Error("buildLinkPatch: qbInvoice.Id missing");
  const qbTotal     = Number(qbInvoice.TotalAmt ?? 0);
  const qbTaxAmount = Number(qbInvoice?.TxnTaxDetail?.TotalTax ?? 0);
  const qbSubtotal  = Number((qbTotal - qbTaxAmount).toFixed(2));
  const link        = extractPaymentLink(qbInvoice) ?? null;
  const paid        = isQbInvoicePaid(qbInvoice);
  const nowIso      = new Date().toISOString();

  const patch = {
    qb_invoice_id:   String(qbInvoice.Id || ""),
    qb_subtotal:     qbSubtotal,
    qb_tax_amount:   qbTaxAmount,
    qb_total:        qbTotal,
    qb_synced_at:    nowIso,
  };
  // Save the human-facing DocNumber alongside the internal id so the UI
  // can render the same identifier the operator sees inside QuickBooks.
  if (qbInvoice.DocNumber) patch.qb_doc_number = String(qbInvoice.DocNumber);
  if (link) patch.qb_payment_link = link;
  if (paid) {
    patch.paid      = true;
    patch.paid_date = nowIso;
  }
  return patch;
}
