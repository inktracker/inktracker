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

// ── Customer-facing brand name ──────────────────────────────────────
//
// The end client always sees the merchant-of-record on top of the
// quote — the broker on broker quotes, the shop otherwise. Every
// customer-facing surface (email header, /QuotePayment page, PDF)
// reaches through this helper so a future surface can't quietly
// regress to "Your Shop" or leak the print-shop name into a broker's
// end-client inbox.
//
// Precedence (matches the chip-label resolver on Calendar/Production
// and the buildSendQuoteEmailRequest baseline):
//   1. broker_company (broker quotes only)
//   2. broker_name    (broker quotes only)
//   3. provided shopName (loaded from shops.shop_name by caller)
//   4. fallback (caller-supplied string for empty-everywhere cases)
//
// Admins, brokers, and direct shop owners all converge here — same
// quote shape, same logic. There's no "admin quote" special case in
// the model: a quote is either broker-attributed or not, based on
// broker_id/broker_email.
export function customerFacingShopName({ quote, shopName = "", fallback = "Shop" } = {}) {
  const broker = isBrokerQuote(quote);
  const brokerCompany = typeof quote?.broker_company === "string" && quote.broker_company.trim();
  const brokerName    = typeof quote?.broker_name    === "string" && quote.broker_name.trim();
  if (broker) {
    return brokerCompany || brokerName || shopName || fallback;
  }
  return shopName || fallback;
}

// Customer-facing tax/total for the /QuotePayment page.
//
// For a NON-broker quote with a QB invoice, QuickBooks' recorded numbers are
// authoritative — they're what the customer actually pays — so show/charge
// those (`qb_total`/`qb_tax_amount`), unless the quote was edited after the
// invoice was created (qbStale), in which case fall back to the saved totals.
//
// For a BROKER quote the shop's `qb_total` is the broker's WHOLESALE price
// (shop→broker), NOT the price the broker quoted their end client. It must
// NEVER be shown to or charged to the end client (the 2026-05-26 leak class).
// Broker quotes always use the client-facing fallback totals, and callers must
// also suppress the shop's QB payment link for them (see QuotePayment).
//
// `fallbackTax`/`fallbackTotal` are the already-client-swapped saved totals
// (from toCustomerFacingQuote). Returns { tax, total, isQbAuthoritative }.
export function customerFacingTotals(quote, { qbStale = false, fallbackTax = 0, fallbackTotal = 0 } = {}) {
  const qbAuthoritative =
    !isBrokerQuote(quote) && quote?.qb_total != null && !qbStale;
  if (qbAuthoritative) {
    return {
      tax: Number(quote.qb_tax_amount || 0),
      total: Number(quote.qb_total || 0),
      isQbAuthoritative: true,
    };
  }
  return {
    tax: Number(fallbackTax || 0),
    total: Number(fallbackTotal || 0),
    isQbAuthoritative: false,
  };
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
