// Safe wrappers around the pricing calc functions for broker-facing
// quote/order rows. Both functions accept a calc function as a
// dependency so this module stays pricing-jsx-free for unit tests.
//
// getQuoteTotalSafe(quote, calcBrokerFn)
//   Broker's view of the quote total. Always recomputed via the
//   injected calc (broker markup is not persisted on the quote, so
//   reading quote.total would give the retail number).
//
// getClientTotalSafe(quote, calcClientFn)
//   Client-facing total. Prefers the saved `quote.total` field
//   (what the client actually saw on their copy of the quote); falls
//   back to the calc if the saved value is missing or zero.

export function getQuoteTotalSafe(quote, calcBrokerFn) {
  try {
    const totals = calcBrokerFn(quote || {});
    return Number(totals?.total) || 0;
  } catch {
    return 0;
  }
}

export function getClientTotalSafe(quote, calcClientFn) {
  const saved = Number(quote?.total);
  if (Number.isFinite(saved) && saved > 0) return saved;
  try {
    const totals = calcClientFn(quote || {});
    return Number(totals?.total) || 0;
  } catch {
    return 0;
  }
}
