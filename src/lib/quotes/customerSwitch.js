// Customer switching + quote duplication — the pure rules.
//
// Shop report (2026-08-06): "duplicated an order to switch it to a new
// client, but the old client detail kept filling the data." Two root
// causes, both fixed here and pinned by tests:
//
//   1. Switching the customer in the quote editor only updated
//      name/company/tax_rate/deposit_pct — customer_email, phone,
//      tax_id, and tax_exempt kept the OLD client's values. Emails and
//      payment links kept going to the old client; the old client's
//      tax exemption rode into the new client's quote.
//   2. handleDuplicate spread-copied every column not explicitly
//      excluded — including public_token (minted at first send, never
//      rotated), so the OLD client's emailed link would open the NEW
//      quote. Approval/sent/paid lifecycle survived too.
//
// One rule now: customerSnapshotPatch is the ONLY way quote-level
// customer fields get written on a switch, and buildQuoteDuplicate is
// the ONLY way a quote is duplicated.

const clean = (v) => (typeof v === "string" ? v.trim() : v ?? "");

/**
 * Every quote-level field that snapshots the selected customer, derived
 * from the customer record in one place. Passing null (customer
 * cleared) blanks the snapshot rather than leaving the old client's
 * data behind.
 */
export function customerSnapshotPatch(customer, { defaultTaxRate, currentTaxRate, currentDepositPct } = {}) {
  if (!customer) {
    return {
      customer_id: "",
      customer_name: "",
      customer_email: "",
      phone: "",
      company: "",
      tax_id: "",
      tax_exempt: false,
    };
  }
  return {
    customer_id: customer.id,
    customer_name: clean(customer.name),
    customer_email: clean(customer.email),
    phone: clean(customer.phone),
    // Denormalized so list/email/payment views show the company even when
    // the viewer can't read the customer record (section-gated manager) or
    // it was later deleted/merged.
    company: clean(customer.company),
    tax_id: clean(customer.tax_id),
    tax_exempt: customer.tax_exempt === true,
    tax_rate: customer.tax_exempt === true
      ? 0
      : (currentTaxRate || defaultTaxRate || 8.265),
    // The client's default payment terms apply to the quote being built.
    deposit_pct: Number(customer.default_deposit_pct ?? currentDepositPct ?? 0),
  };
}

/**
 * Fields a duplicated quote must NOT inherit — identity, QB linkage,
 * customer-approval/sent/paid lifecycle, and above all public_token:
 * tokens are minted at first send and never rotated, so a copied token
 * makes the ORIGINAL customer's emailed link open the duplicate.
 */
// Deposit-path columns are LIFECYCLE state, never job shape: a duplicate
// inheriting qb_deposit_invoice_id would share ONE live QB deposit invoice
// between two quotes — the webhook lookup breaks on the multi-match, the
// nightly reconcile converts BOTH quotes off one payment, and whichever
// settles first strands the other (audit 2026-08-12, CRITICAL 2).
export const QUOTE_DUPLICATE_EXCLUDED = [
  "id", "created_date", "created_at",
  // QB linkage (a duplicate has no QB invoice)
  "qb_invoice_id", "qb_payment_link", "qb_total", "qb_tax_amount",
  "qb_subtotal", "qb_synced_at", "qb_doc_number", "qb_line_snapshot",
  // conversion linkage (a Draft born converted can never convert)
  "converted_order_id", "converted_at",
  // origin + dedupe helpers
  "source_email_id", "possible_existing_customer_id", "is_reorder",
  // customer-facing lifecycle — the duplicate was never sent/approved/paid
  "public_token", "payment_link", "sent_to", "sent_date",
  "sent_to_client_at", "client_status", "client_approved_at",
  "payment_status", "paid", "paid_date", "deposit_paid", "expires_date",
  // deposit-path lifecycle (see comment above): the SNAPSHOT and the live
  // deposit-invoice pointers must never survive duplication. deposit_pct
  // stays (job-shaped terms); everything minted/collected resets.
  "deposit_amount", "deposit_paid_at", "qb_deposit_invoice_id", "qb_deposit_payment_link",
];

/**
 * The duplicate payload: everything job-shaped survives (line items,
 * imprints, notes, pricing, artwork); identity + lifecycle reset.
 */
export function buildQuoteDuplicate(quote, { quoteId, date }) {
  const dup = { ...quote };
  for (const key of QUOTE_DUPLICATE_EXCLUDED) delete dup[key];
  return { ...dup, quote_id: quoteId, status: "Draft", date };
}
