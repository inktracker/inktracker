// Pure helper that returns a quote shaped for customer-facing display.
//
// Broker quotes save TWO parallel pricings on the same row:
//   broker side : line._ppp / line._lineTotal / quote.subtotal / quote.total
//                 (BROKER_MARKUP — what the shop charges the broker)
//   client side : line._client_ppp / line._client_lineTotal /
//                 quote.client_subtotal / quote.client_total
//                 (STANDARD_MARKUP — what the broker charges the end client,
//                 plus broker_tax_rate)
//
// Non-broker quotes only stamp the broker side (which IS the customer side).
//
// Customer-facing surfaces (email body, /QuotePayment page) used to read
// the broker-side fields directly. For broker quotes that meant the email
// showed $646 instead of the $753 the broker had quoted to their client —
// a real bug caught 2026-05-26. The PDF (pdfExport.jsx:678-686) already
// does this swap inline; this helper consolidates it for reuse.
//
// Invariant preserved: this returns a NEW object. The saved row is not
// mutated. Consumers that write back to the DB (buildPostSendQuotePatch,
// etc.) must still use the original quote so the broker-side fields stay
// authoritative on the row.

export function isBrokerQuote(q) {
  return Boolean(q?.broker_id || q?.broker_email || q?.brokerId);
}

export function toCustomerFacingQuote(quote) {
  if (!quote || !isBrokerQuote(quote)) return quote;

  const lineItems = Array.isArray(quote.line_items)
    ? quote.line_items.map((li) => {
        if (!li || typeof li !== "object") return li;
        // Swap client-side stamps onto the standard fields. Leave the
        // original `_client_*` in place too so anything that reads them
        // explicitly still works.
        const hasClientStamp =
          li._client_ppp != null || li._client_lineTotal != null;
        if (!hasClientStamp) return li;
        return {
          ...li,
          _ppp:       li._client_ppp ?? li._ppp,
          _lineTotal: li._client_lineTotal ?? li._lineTotal,
          _rushFee:   li._client_rushFee ?? li._rushFee,
        };
      })
    : quote.line_items;

  return {
    ...quote,
    line_items: lineItems,
    // Top-level totals — only swap when the client-side field is set.
    // A broker quote that somehow lacks client_* (legacy / partial save)
    // falls back to the broker-side values so the page still renders
    // numbers rather than zero.
    subtotal: quote.client_subtotal ?? quote.subtotal,
    tax:      quote.client_tax ?? quote.tax,
    total:    quote.client_total ?? quote.total,
    // Tax rate also swaps: brokers use broker_tax_rate for their client.
    tax_rate: quote.broker_tax_rate != null ? quote.broker_tax_rate : quote.tax_rate,
  };
}
