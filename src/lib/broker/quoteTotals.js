// Safe wrappers around the pricing calc functions for broker-facing
// quote/order rows. Both functions accept a calc function as a
// dependency so this module stays pricing-jsx-free for unit tests.
//
// getQuoteTotalSafe(quote, calcBrokerFn)
//   Broker's wholesale total. Prefers the SAVED `quote.total` stamp
//   (BrokerQuoteEditor writes the broker wholesale price there — that
//   premise "broker markup isn't persisted" is outdated). Live recompute
//   is the legacy fallback only. Reading the stamp holds the snapshot
//   invariant (history doesn't reprice when the shop changes rates) and
//   avoids the CACHE-01 `_pc` bleed on the multi-shop broker surface.
//
// getClientTotalSafe(quote, calcClientFn)
//   Client-facing total. Prefers the saved `quote.client_total` stamp
//   (what the broker charged the client); falls back to the legacy
//   `quote.total`, then the calc, if the client stamp is missing/zero.

export function getQuoteTotalSafe(quote, calcBrokerFn) {
  const saved = Number(quote?.total);
  if (Number.isFinite(saved) && saved > 0) return saved;
  try {
    const totals = calcBrokerFn(quote || {});
    return Number(totals?.total) || 0;
  } catch {
    return 0;
  }
}

export function getClientTotalSafe(quote, calcClientFn) {
  const savedClient = Number(quote?.client_total);
  if (Number.isFinite(savedClient) && savedClient > 0) return savedClient;
  const savedLegacy = Number(quote?.total);
  if (Number.isFinite(savedLegacy) && savedLegacy > 0) return savedLegacy;
  try {
    const totals = calcClientFn(quote || {});
    return Number(totals?.total) || 0;
  } catch {
    return 0;
  }
}
