// Server-side port of src/lib/quotes/customerFacingQuote.js (the two pure
// helpers the public payment page needs). Kept in sync by the contract test
// at _shared/__tests__/customerFacingQuote.test.js.
//
// Why this matters: createCheckoutSession returns the quote to the UNauthenticated
// payment page. For BROKER quotes the raw row carries the broker's WHOLESALE
// pricing (the shop's price to the broker) in subtotal/total/_ppp/_lineTotal —
// which the end client must never see. toCustomerFacingQuote swaps the saved
// client-facing values onto the standard fields, OVERWRITING the wholesale
// numbers, so applying it server-side eliminates the leak from the payload (not
// just from the rendered page). Broker IDENTITY fields (broker_id/name/company)
// are intentionally preserved — the customer page shows the broker as the
// merchant of record, and stripping them would leak the print shop's name to
// the broker's client instead.

export function isBrokerQuote(q) {
  return Boolean(q?.broker_id || q?.broker_email || q?.brokerId);
}

export function toCustomerFacingQuote(quote) {
  if (!quote || !isBrokerQuote(quote)) return quote;

  const lineItems = Array.isArray(quote.line_items)
    ? quote.line_items.map((li) => {
        if (!li || typeof li !== "object") return li;
        const hasClientStamp =
          li._client_ppp != null || li._client_lineTotal != null;
        if (!hasClientStamp) return li;
        return {
          ...li,
          _ppp: li._client_ppp ?? li._ppp,
          _lineTotal: li._client_lineTotal ?? li._lineTotal,
          _rushFee: li._client_rushFee ?? li._rushFee,
        };
      })
    : quote.line_items;

  return {
    ...quote,
    line_items: lineItems,
    subtotal: quote.client_subtotal ?? quote.subtotal,
    tax: quote.client_tax ?? quote.tax,
    total: quote.client_total ?? quote.total,
    tax_rate: quote.broker_tax_rate != null ? quote.broker_tax_rate : quote.tax_rate,
  };
}
