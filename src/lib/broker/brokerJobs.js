// Pure-logic for BrokerInvoicesTab — assembles "completed jobs" from
// the orders + quotes the broker has access to, filters / searches /
// sorts them, and computes KPIs.
//
// "completed job" = either a status=Completed order, OR a status=
// "Converted to Order" quote whose converted_order_id isn't already
// in the orders list (covers the case where a broker's order row
// got deleted but the quote audit trail remains).
//
// Broker/client totals are computed off the raw quote when one is
// linked, so the broker sees the live broker-markup price even if
// the order row's `total` was saved at retail. Falls back to the
// order's saved total if no quote is linked. calc fns are
// dependency-injected to keep this module pricing-jsx-free for tests.

export function assembleCompletedJobs(orders, quotes, { calcBroker, calcClient } = {}) {
  const orderList = Array.isArray(orders) ? orders : [];
  const quoteList = Array.isArray(quotes) ? quotes : [];

  const jobsFromOrders = orderList
    .filter((o) => o.status === "Completed")
    .map((o) => {
      const matchingQuote = quoteList.find(
        (q) => q.converted_order_id === o.order_id || q.converted_order_id === o.id,
      );
      let brokerTotal = Number(o.total) || 0;
      let clientTotal = Number(o.total) || 0;
      if (matchingQuote) {
        try { if (calcBroker) brokerTotal = Number(calcBroker(matchingQuote)?.total) || brokerTotal; } catch {}
        try { if (calcClient) clientTotal = Number(calcClient(matchingQuote)?.total) || clientTotal; } catch {}
      }
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
      let brokerTotal = 0;
      let clientTotal = 0;
      try { if (calcBroker) brokerTotal = Number(calcBroker(q)?.total) || 0; } catch {}
      try { if (calcClient) clientTotal = Number(calcClient(q)?.total) || 0; } catch {}
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
