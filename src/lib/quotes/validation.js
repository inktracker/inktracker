// Pure validation rules for quotes. Used at the save gate
// (Quotes.jsx saveQuote) and the send gate (SendQuoteModal). Both
// gates enforce the audit fix from 2026-05-12: blank quotes can no
// longer be saved or sent. The send gate adds extra requirements
// (customer email, public token) since those are needed to deliver
// the quote to the customer.
//
// Returns null on success, or an array of human-readable error
// strings on failure. Caller surfaces them to the user (alert /
// toast).

import { getQty } from "../../components/shared/pricing";

/**
 * Validate a quote for SAVE. The minimum bar: it must be intelligible.
 * - Must have a customer_id (you can't quote anonymously)
 * - Must have at least one line item with qty > 0
 *
 * Drafts in progress with partial pricing / addresses / etc are
 * fine — but a quote with no customer or zero items is junk data
 * that shouldn't reach the database.
 *
 * @param {object} quote
 * @returns {string[] | null}  null = valid; array = error messages
 */
export function validateQuoteForSave(quote) {
  const errors = [];

  if (!quote || typeof quote !== "object") {
    return ["Quote is empty."];
  }

  const customerId = (quote.customer_id ?? "").toString().trim();
  if (!customerId) {
    errors.push("Pick a customer before saving.");
  }

  const lineItems = Array.isArray(quote.line_items) ? quote.line_items : [];
  const totalQty = lineItems.reduce((sum, li) => sum + (getQty(li) || 0), 0);
  if (totalQty <= 0) {
    errors.push("Add at least one line item with a quantity greater than zero.");
  }

  return errors.length > 0 ? errors : null;
}

/**
 * Validate a quote for SEND. Stricter than save — the quote is
 * about to leave the building.
 * - Everything required for save
 * - Customer email present (the quote is emailed)
 * - Public token present (the payment link needs it to grant
 *   anonymous customer access). The caller passes publicToken
 *   separately because it may have been freshly minted and not
 *   yet round-tripped onto the quote object.
 *
 * @param {object} quote
 * @param {string|null} publicToken
 * @returns {string[] | null}
 */
export function validateQuoteForSend(quote, publicToken) {
  const errors = validateQuoteForSave(quote) ?? [];

  const customerEmail = (quote?.customer_email ?? "").toString().trim();
  if (!customerEmail) {
    errors.push("The quote has no customer email — can't send.");
  }

  const tokenStr = (publicToken ?? "").toString().trim();
  if (!tokenStr) {
    errors.push(
      "Couldn't generate a secure link for this quote. Try again or contact support."
    );
  }

  return errors.length > 0 ? errors : null;
}
