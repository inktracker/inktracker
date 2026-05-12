// Stats derived from Inktracker's own data — quotes, orders, invoices,
// customers. Operational only — accounting (expenses, P&L) lives in QB.
//
// Inputs are arrays of raw entity rows. Returns a structured snapshot keyed
// by stat. Date range applies to "in-period" metrics; current-state metrics
// (open pipeline, outstanding) ignore the range.

function inRange(dateStr, from, to) {
  if (!dateStr) return false;
  const d = String(dateStr).slice(0, 10);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const COMPLETED_STATUSES = new Set(["Completed", "Shipped", "Delivered", "Picked Up"]);
const CANCELLED_STATUSES = new Set(["Cancelled", "Canceled", "Voided"]);
// Fuzzy-matched active order statuses — includes our canonical
// O_STATUSES production stages plus aliases for orders imported
// from external systems (Printavo, manual CSV, etc.) that use
// different conventions. Quality Check / Packing were our own
// legacy stages — dropped on 2026-05-12 when the pipeline slimmed
// to 5 stages.
const ACTIVE_ORDER_STATUSES = new Set([
  // Canonical InkTracker pipeline (O_STATUSES, minus terminal "Completed")
  "Art Approval", "Order Goods", "Pre-Press", "Printing",
  // External-system aliases tolerated by this classifier
  "Approved", "Pre-Production", "On Press", "Drying", "Curing", "Ready", "In Production",
]);

function isCompletedOrder(o) {
  return COMPLETED_STATUSES.has(o.status);
}
function isCancelledOrder(o) {
  return CANCELLED_STATUSES.has(o.status);
}
function isActiveOrder(o) {
  return !isCompletedOrder(o) && !isCancelledOrder(o);
}

export function computeNativeStats({
  quotes = [],
  orders = [],
  invoices = [],
  customers = [],
  archived = [],          // ShopPerformance rows — orders that have been completed-and-archived
  dateFrom = null,
  dateTo = null,
} = {}) {
  // ── Revenue (in period) ─────────────────────────────────────────────────
  // Sources: orders with completed_date in period + archived (ShopPerformance) rows.
  // Be careful not to double-count — ShopPerformance is created when an order
  // moves to Completed, which sometimes also triggers Order.delete (Production
  // / Calendar paths) and sometimes leaves the Order intact (Orders page).
  // We dedupe by order_id.
  const periodOrders = orders.filter((o) =>
    isCompletedOrder(o) && inRange(o.completed_date || o.date, dateFrom, dateTo)
  );
  const periodArchived = archived.filter((a) => inRange(a.date, dateFrom, dateTo));
  const seenOrderIds = new Set(periodOrders.map((o) => o.order_id).filter(Boolean));
  const archivedNotInOrders = periodArchived.filter((a) => !seenOrderIds.has(a.order_id));
  const revenue =
    periodOrders.reduce((s, o) => s + num(o.total), 0) +
    archivedNotInOrders.reduce((s, a) => s + num(a.total), 0);

  // ── Active pipeline (current state, not date-bound) ────────────────────
  const active = orders.filter(isActiveOrder);
  const activePipeline = active.reduce((s, o) => s + num(o.total), 0);

  // ── Quote pipeline value (Sent quotes, not yet ordered) ────────────────
  const sentQuotes = quotes.filter((q) => q.status === "Sent");
  const quotePipelineValue = sentQuotes.reduce((s, q) => s + num(q.total), 0);

  // ── Outstanding invoices ────────────────────────────────────────────────
  const outstandingInvoices = invoices.filter((i) => !i.paid && i.status !== "Voided");
  const outstanding = outstandingInvoices.reduce((s, i) => s + num(i.total), 0);

  // ── Quote conversion rate (in period) ──────────────────────────────────
  const sentInPeriod = quotes.filter((q) =>
    inRange(q.sent_date || q.date, dateFrom, dateTo) && q.status !== "Draft"
  );
  const convertedInPeriod = sentInPeriod.filter((q) =>
    q.status === "Converted to Order" || q.status === "Approved" ||
    q.status === "Approved and Paid" || q.status === "Client Approved"
  );
  const conversionRate = sentInPeriod.length
    ? convertedInPeriod.length / sentInPeriod.length
    : null;

  // ── Average order value (in period) ────────────────────────────────────
  const totalCompletedCount = periodOrders.length + archivedNotInOrders.length;
  const aov = totalCompletedCount ? revenue / totalCompletedCount : 0;

  // ── New customers (in period) ──────────────────────────────────────────
  const newCustomers = customers.filter((c) =>
    inRange(c.created_at || c.created_date, dateFrom, dateTo)
  ).length;

  // ── Repeat customer % (lifetime) ───────────────────────────────────────
  const ordersByCustomer = new Map();
  for (const o of orders) {
    if (isCancelledOrder(o)) continue;
    const key = o.customer_id || o.customer_name;
    if (!key) continue;
    ordersByCustomer.set(key, (ordersByCustomer.get(key) || 0) + 1);
  }
  for (const a of archived) {
    const key = a.customer_id || a.customer_name;
    if (!key) continue;
    ordersByCustomer.set(key, (ordersByCustomer.get(key) || 0) + 1);
  }
  const customersWithAnyOrder = ordersByCustomer.size;
  const customersWithMultiple = [...ordersByCustomer.values()].filter((n) => n > 1).length;
  const repeatRate = customersWithAnyOrder ? customersWithMultiple / customersWithAnyOrder : null;

  // ── Top customers (in period, by revenue) ──────────────────────────────
  const customerTotals = new Map();
  function bumpCustomer(name, amount) {
    if (!name) return;
    customerTotals.set(name, (customerTotals.get(name) || 0) + amount);
  }
  for (const o of periodOrders) bumpCustomer(o.customer_name, num(o.total));
  for (const a of archivedNotInOrders) bumpCustomer(a.customer_name, num(a.total));
  const topCustomers = [...customerTotals.entries()]
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  // ── Active orders by status ────────────────────────────────────────────
  const activeByStatus = {};
  for (const o of active) {
    const s = o.status || "Unknown";
    activeByStatus[s] = (activeByStatus[s] || 0) + 1;
  }
  const activeStatusList = Object.entries(activeByStatus)
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);

  return {
    period: { from: dateFrom, to: dateTo },
    revenue,
    activePipeline,
    activePipelineCount: active.length,
    quotePipelineValue,
    quotePipelineCount: sentQuotes.length,
    outstanding,
    outstandingCount: outstandingInvoices.length,
    conversionRate,
    conversionSentCount: sentInPeriod.length,
    conversionConvertedCount: convertedInPeriod.length,
    aov,
    completedCount: totalCompletedCount,
    newCustomers,
    repeatRate,
    repeatCustomersCount: customersWithMultiple,
    customersWithAnyOrder,
    topCustomers,
    activeStatusList,
  };
}
