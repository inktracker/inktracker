// Pure-logic for BrokerInvoicesTab — assembles "completed jobs" from
// the orders + quotes the broker has access to, filters / searches /
// sorts them, and computes KPIs.
//
// "completed job" = either a status=Completed order, OR a status=
// "Converted to Order" quote whose converted_order_id isn't already
// in the orders list (covers the case where a broker's order row
// got deleted but the quote audit trail remains).
//
// Broker/client totals come from the quote's SAVED snapshot stamps:
// `quote.total` is the broker wholesale price (what the shop reads) and
// `quote.client_total` is what the broker charged their client (BrokerQuoteEditor
// writes both on save). Reading the saved stamps — not a live recompute — is the
// snapshot invariant: it stops broker history from repricing when the shop later
// changes rates, and it closes the CACHE-01 `_pc` bleed (a live calc runs under
// whatever shop's pricing config is currently loaded on this multi-shop surface).
// The injected calc fns are used ONLY as a fallback for legacy quotes that
// predate the client_* stamps (the 20260607 migration), and stay
// dependency-injected to keep this module pricing-jsx-free for tests.

// Resolve one job's { brokerTotal, clientTotal } — saved stamps win; live calc
// (or the order's own total) is the legacy fallback.
function resolveJobTotals(quote, fallbackTotal, { calcBroker, calcClient } = {}) {
  const fb = Number(fallbackTotal) || 0;
  const savedBroker = Number(quote?.total);
  const savedClient = Number(quote?.client_total);

  let brokerTotal = Number.isFinite(savedBroker) && savedBroker > 0 ? savedBroker : null;
  if (brokerTotal == null) {
    try { if (calcBroker) brokerTotal = Number(calcBroker(quote)?.total) || null; } catch { brokerTotal = null; }
  }
  if (brokerTotal == null) brokerTotal = fb;

  let clientTotal = Number.isFinite(savedClient) && savedClient > 0 ? savedClient : null;
  if (clientTotal == null) {
    try { if (calcClient) clientTotal = Number(calcClient(quote)?.total) || null; } catch { clientTotal = null; }
  }
  if (clientTotal == null) clientTotal = fb;

  return { brokerTotal, clientTotal };
}

export function assembleCompletedJobs(orders, quotes, { calcBroker, calcClient } = {}) {
  const orderList = Array.isArray(orders) ? orders : [];
  const quoteList = Array.isArray(quotes) ? quotes : [];

  const jobsFromOrders = orderList
    .filter((o) => o.status === "Completed")
    .map((o) => {
      const matchingQuote = quoteList.find(
        (q) => q.converted_order_id === o.order_id || q.converted_order_id === o.id,
      );
      // Saved stamps from the linked quote win; fall back to the order's own
      // total when no quote is linked (no snapshot to read).
      const { brokerTotal, clientTotal } = matchingQuote
        ? resolveJobTotals(matchingQuote, o.total, { calcBroker, calcClient })
        : { brokerTotal: Number(o.total) || 0, clientTotal: Number(o.total) || 0 };
      return {
        ...o,
        _type: "order",
        _brokerTotal: brokerTotal,
        _clientTotal: clientTotal,
        _rawQuote: matchingQuote || null,
      };
    });

  // Dedupe set covers BOTH possible references a quote can carry:
  //   converted_order_id === order.order_id (normal)
  //   converted_order_id === order.id (legacy fallback)
  // Previous inline code only included order_id, which let a
  // legacy-referenced quote slip through and double-count its order.
  const orderIdSet = new Set();
  for (const j of jobsFromOrders) {
    if (j.order_id) orderIdSet.add(j.order_id);
    if (j.id) orderIdSet.add(j.id);
  }

  const jobsFromQuotes = quoteList
    .filter(
      (q) =>
        q.status === "Converted to Order" &&
        q.converted_order_id &&
        !orderIdSet.has(q.converted_order_id),
    )
    .map((q) => {
      const { brokerTotal, clientTotal } = resolveJobTotals(q, 0, { calcBroker, calcClient });
      return {
        ...q,
        order_id: q.converted_order_id,
        _type: "quote",
        _brokerTotal: brokerTotal,
        _clientTotal: clientTotal,
        _rawQuote: q,
      };
    });

  return [...jobsFromOrders, ...jobsFromQuotes];
}

export function filterJobsByDate(jobs, dateFilter, now = Date.now()) {
  if (!Array.isArray(jobs)) return [];
  if (!dateFilter || dateFilter === "all") return jobs;
  return jobs.filter((j) => {
    const t = new Date(j.date || j.created_date).getTime();
    if (!Number.isFinite(t)) return true; // keep undated rows (matches inline behavior)
    const ageDays = (now - t) / 86400000;
    if (dateFilter === "30d") return ageDays <= 30;
    if (dateFilter === "90d") return ageDays <= 90;
    if (dateFilter === "year") return new Date(t).getFullYear() === new Date(now).getFullYear();
    return true;
  });
}

export function filterJobsBySearch(jobs, query) {
  if (!Array.isArray(jobs)) return [];
  const q = String(query || "").toLowerCase();
  if (!q) return jobs;
  return jobs.filter((j) =>
    (j.customer_name || "").toLowerCase().includes(q) ||
    (j.order_id || "").toLowerCase().includes(q) ||
    (j.quote_id || "").toLowerCase().includes(q),
  );
}

export function sortJobs(jobs, sortKey) {
  if (!Array.isArray(jobs)) return [];
  const list = [...jobs];
  if (sortKey === "date_desc") {
    return list.sort((a, b) => ((b.date || b.created_date || "") > (a.date || a.created_date || "") ? 1 : -1));
  }
  if (sortKey === "date_asc") {
    return list.sort((a, b) => ((a.date || a.created_date || "") > (b.date || b.created_date || "") ? 1 : -1));
  }
  if (sortKey === "value_desc") return list.sort((a, b) => (b._brokerTotal || 0) - (a._brokerTotal || 0));
  if (sortKey === "value_asc")  return list.sort((a, b) => (a._brokerTotal || 0) - (b._brokerTotal || 0));
  return list;
}

export function computeJobKpis(jobs) {
  const list = Array.isArray(jobs) ? jobs : [];
  const totalRevenue = list.reduce((s, j) => s + (Number(j._brokerTotal) || 0), 0);
  const totalClientRevenue = list.reduce((s, j) => s + (Number(j._clientTotal) || 0), 0);
  const totalMargin = totalClientRevenue - totalRevenue;
  const avgJobValue = list.length ? totalRevenue / list.length : 0;
  return {
    count: list.length,
    totalRevenue,
    totalClientRevenue,
    totalMargin,
    avgJobValue,
  };
}
