// Pure-logic for BrokerAnalytics.jsx. Three operations:
//   - filterByPeriod  — keep only quotes within a rolling N-day window
//   - pipelineCounts  — count quotes by status (Draft / Pending /
//                       Approved / Declined)
//   - performanceMetrics — total / approved / conversion rate /
//                       totalValue / avgValue
//
// totalValue / avgValue depend on calcQuoteTotals(q, BROKER_MARKUP)
// since brokers see broker-priced totals, not retail. We accept the
// calc function as a dependency injection arg so this module stays
// pure (no React, no pricing.jsx coupling for tests).

export const STATUS_KEYS = ["Draft", "Pending", "Approved", "Declined"];

export function filterByPeriod(quotes, periodDays, now = Date.now()) {
  if (!Array.isArray(quotes)) return [];
  if (!periodDays) return quotes;
  const cutoff = now - periodDays * 24 * 60 * 60 * 1000;
  return quotes.filter((q) => {
    const t = new Date(q.created_date || q.date).getTime();
    if (!Number.isFinite(t)) return false;
    return t >= cutoff;
  });
}

export function pipelineCounts(quotes) {
  const list = Array.isArray(quotes) ? quotes : [];
  return STATUS_KEYS.map((status) => ({
    status,
    count: list.filter((q) => q.status === status).length,
  }));
}

export function performanceMetrics(quotes, calcQuoteTotalFn) {
  const list = Array.isArray(quotes) ? quotes : [];
  const total = list.length;
  const approved = list.filter((q) => q.status === "Approved").length;
  const conversionRate = total > 0 ? Math.round((approved / total) * 100) : 0;
  const quotesWithValue = list.filter((q) => (q.line_items || []).length > 0);
  const totalValue = quotesWithValue.reduce((sum, q) => {
    try { return sum + (calcQuoteTotalFn(q)?.total || 0); } catch { return sum; }
  }, 0);
  const avgValue = quotesWithValue.length > 0 ? totalValue / quotesWithValue.length : 0;
  return { total, approved, conversionRate, totalValue, avgValue };
}
