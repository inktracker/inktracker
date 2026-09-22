// Shared reorder logic: clone a completed/existing order into a fresh Draft
// quote. Used by the order detail modal AND the customer view's "Recent Jobs"
// reorder so both entry points produce an identical quote.
//
// A reorder is, by definition, a repeat of a job whose screens already exist —
// so `is_reorder` is set true and the quote's per-screen fees fall to their
// reduced reorder rate automatically (see QuoteEditorModal fee math).

/**
 * Generate a quote id in the same `Q-YYYY-XXXX` shape the editors use.
 */
export function newReorderQuoteId(now = new Date()) {
  const suffix = now.getTime().toString(36).toUpperCase().slice(-4);
  return `Q-${now.getFullYear()}-${suffix}`;
}

/**
 * Build the Quote.create payload for reordering `order`. Pure — the caller
 * supplies the quote id and the shop-tz date so this stays testable and never
 * reaches for the clock/timezone itself.
 *
 * Inherits the order's line items, extras, notes, rush, discount, tax and
 * deposit terms; resets identity/lifecycle (new id, Draft, unpaid, no due date).
 */
export function buildReorderQuotePayload(order, { quoteId, today }) {
  return {
    quote_id: quoteId,
    shop_owner: order.shop_owner,
    customer_id: order.customer_id || "",
    customer_name: order.customer_name || "",
    job_title: order.job_title || "",
    date: today,
    due_date: null,
    status: "Draft",
    notes: order.notes || "",
    rush_rate: order.rush_rate || 0,
    extras: order.extras || {},
    line_items: order.line_items || [],
    discount: order.discount || 0,
    discount_type: order.discount_type || "percent",
    tax_rate: order.tax_rate || 0,
    // Reorders inherit the ORDER's deposit terms, not a hardcoded 50.
    deposit_pct: order.deposit_pct ?? 0,
    deposit_paid: false,
    // Screens already exist for a reorder → reduced per-screen fee rates.
    is_reorder: true,
  };
}
