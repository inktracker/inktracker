// Where should clicking a quote actually take the operator?
//
// Three possible destinations:
//   1. The quote IS converted and the order is in memory → open the
//      OrderDetailModal inline.
//   2. The quote IS converted but the order isn't loaded (e.g. the
//      calendar fetches the newest 200 orders only) → navigate to the
//      /Orders list page so they can find it manually. We deliberately
//      do NOT navigate to /Quotes because that page filters out
//      "Converted to Order" rows (Quotes.jsx ~line 97) — the operator
//      would land on a page that appears to be missing the quote.
//   3. The quote is truly unconverted → /Quotes?id=... is the right
//      destination, since the quote exists and is editable there.
//
// Pure logic so calendars + dashboards + production grids all stay
// in lockstep. The Alder Creek regression on 2026-05-30 happened
// because Calendar.jsx had this logic locally and Production.jsx
// didn't.

export const QUOTE_LINK_KIND = Object.freeze({
  OPEN_ORDER:     "open-order",
  NAVIGATE_ORDERS: "navigate-orders",
  NAVIGATE_QUOTE:  "navigate-quote",
});

/**
 * Decide what to do when an operator clicks a quote-shaped surface
 * (Quote Sent chip, Quote Approved chip, dashboard recent quotes
 * list, etc.).
 *
 * Two resolution strategies for "is this quote converted":
 *   - Forward link:  quote.converted_order_id → orders.find(o.order_id === ...)
 *     Always preferred when present (it's the definitive link).
 *   - Reverse link:  orders.find(o.quote_id === quote.quote_id)
 *     Fallback for legacy quotes where the forward pointer never got
 *     written (e.g. orders converted via a path that didn't yet set
 *     converted_order_id).
 *
 * Either match → OPEN_ORDER with the order row.
 * Otherwise, if the quote LOOKS converted (status or pointer set)
 * but we can't find the order in the loaded set → NAVIGATE_ORDERS.
 * Otherwise → NAVIGATE_QUOTE.
 *
 * @param {object} quote   The quote row.
 * @param {Array<object>} orders   Orders currently loaded in memory.
 * @returns {{kind: string, order?: object, quoteId?: string}}
 */
export function resolveQuoteLink(quote, orders) {
  const safeOrders = Array.isArray(orders) ? orders : [];

  // Forward link.
  if (quote?.converted_order_id) {
    const byForward = safeOrders.find((o) => o?.order_id === quote.converted_order_id);
    if (byForward) return { kind: QUOTE_LINK_KIND.OPEN_ORDER, order: byForward };
  }

  // Reverse link — orders carry the human-readable quote_id since
  // buildOrderFromQuote was introduced.
  if (quote?.quote_id) {
    const byReverse = safeOrders.find((o) => o?.quote_id === quote.quote_id);
    if (byReverse) return { kind: QUOTE_LINK_KIND.OPEN_ORDER, order: byReverse };
  }

  // Looks converted but order isn't in memory. Don't send them to
  // /Quotes — it'll be filtered out. Send to /Orders so they can hunt.
  if (quote?.status === "Converted to Order" || quote?.converted_order_id) {
    return { kind: QUOTE_LINK_KIND.NAVIGATE_ORDERS };
  }

  // True unconverted quote.
  return { kind: QUOTE_LINK_KIND.NAVIGATE_QUOTE, quoteId: quote?.id };
}
