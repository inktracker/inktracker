// Total Volume — pieces moved in a period across BOTH completed
// production orders and QB-only invoices (imported history / QB-first
// jobs never bridged to the schedule). Spec: docs/total-volume-scope.md.
//
// Units Sold stays production-scoped; this is the business-history stat.
// Keep the dedup + line rules in lockstep with performance_stats v3
// (migration 20260910) — the RPC is the primary source, this module is
// the client fallback and the unit-tested reference implementation.

import { getQty } from "../../components/shared/pricing";

export const COMPLETED_ORDER_STATUSES = new Set(["Completed", "Shipped", "Delivered", "Picked Up"]);

// Non-garment lines that ride QB invoices (and Add-to-Production orders
// inherit). Categorically not pieces; measured impact ~0.5% (Biota).
export const FEE_LINE_RE = /(shipping|setup|fee|rush|discount|surcharge)/i;

function isQbStubLine(li) {
  return String(li?.id ?? "").startsWith("qb-");
}

function lineUnits(li, { feeExcludable }) {
  if (feeExcludable && FEE_LINE_RE.test(String(li?.style ?? ""))) return 0;
  return getQty(li);
}

/** Units for an order row. Fee exclusion applies only to lines inherited
 *  from a QB invoice (id "qb-…") — production-born lines are garments. */
export function orderVolumeUnits(order) {
  return (order?.line_items || []).reduce(
    (sum, li) => sum + lineUnits(li, { feeExcludable: isQbStubLine(li) }),
    0,
  );
}

/** Units for an invoice row. All lines are fee-excludable (QB shape). */
export function invoiceVolumeUnits(invoice) {
  return (invoice?.line_items || []).reduce(
    (sum, li) => sum + lineUnits(li, { feeExcludable: true }),
    0,
  );
}

/**
 * Is this invoice QB-only (counted via the invoice bucket)?
 * NOT QB-only when either linkage exists:
 *   1. invoice.order_id resolves to a live order, or
 *   2. a quote with quote_id === invoice.invoice_id has converted_order_id
 *      (quote-born invoices usually carry order_id = null — the quote holds
 *      the pointer; checking only (1) double-counts every quoted job).
 */
export function isQbOnlyInvoice(invoice, { liveOrderIds, quotesByQuoteId }) {
  if (invoice?.order_id && liveOrderIds.has(invoice.order_id)) return false;
  const q = quotesByQuoteId.get(invoice?.invoice_id);
  if (q?.converted_order_id) return false;
  return true;
}

function inRange(dateStr, from, to) {
  if (!dateStr) return false;
  if (from && dateStr < from) return false;
  if (to && dateStr > to) return false;
  return true;
}

/**
 * Compute the Total Volume card's numbers.
 *
 * @param {object} args
 * @param {Array<object>} args.orders    all loaded orders
 * @param {Array<object>} args.invoices  all loaded invoices
 * @param {Array<object>} args.quotes    loaded quotes (quote_id + converted_order_id suffice)
 * @param {string|null} args.from        YYYY-MM-DD or null (open)
 * @param {string|null} args.to          YYYY-MM-DD or null (open)
 * @returns {{units:number, orderCount:number, invoiceCount:number}}
 */
export function computeTotalVolume({ orders = [], invoices = [], quotes = [], from = null, to = null }) {
  const liveOrderIds = new Set(orders.map((o) => o?.order_id).filter(Boolean));
  const quotesByQuoteId = new Map();
  for (const q of quotes) {
    if (q?.quote_id && !quotesByQuoteId.has(q.quote_id)) quotesByQuoteId.set(q.quote_id, q);
  }

  let units = 0;
  let orderCount = 0;
  for (const o of orders) {
    if (!o?.status || !COMPLETED_ORDER_STATUSES.has(o.status)) continue;
    if (!inRange(o.completed_date, from, to)) continue;
    orderCount += 1;
    units += orderVolumeUnits(o);
  }

  let invoiceCount = 0;
  for (const i of invoices) {
    if (!inRange(i?.date, from, to)) continue;
    if (!isQbOnlyInvoice(i, { liveOrderIds, quotesByQuoteId })) continue;
    invoiceCount += 1;
    units += invoiceVolumeUnits(i);
  }

  return { units, orderCount, invoiceCount };
}
