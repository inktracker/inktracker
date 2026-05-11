// Pure operational stats over a list of local invoices.
//
// These replace the QB getPerformanceData round-trip we used to make from
// Dashboard / Invoices / Performance. The local invoices table tracks paid
// status (set by stripeWebhook on Stripe payments and by qbWebhook on QB
// payments), so we can compute the same numbers without a QB API call.
//
// Trade-off worth being honest about: if a shop owner marks an invoice paid
// directly inside QuickBooks AND the qbWebhook didn't fire (network issue,
// disabled webhook, stale realm), our local "paid" flag will be wrong until
// the next sync. That's the same risk we already have everywhere else that
// reads the local invoices table.
//
// All functions here are pure. Tests at __tests__/invoiceStats.test.js.

function asNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function withinRange(dateStr, fromIso, toIso) {
  if (!dateStr) return false;
  if (fromIso && dateStr < fromIso) return false;
  if (toIso   && dateStr > toIso)   return false;
  return true;
}

/**
 * Outstanding (unpaid) invoice totals.
 *
 *   computeOutstanding(invoices) -> { total, count }
 *
 * `total` is rounded to the nearest cent. `count` is the number of unpaid
 * invoices with a positive total (zero-total drafts shouldn't inflate the
 * count).
 */
export function computeOutstanding(invoices) {
  const safe = Array.isArray(invoices) ? invoices : [];
  let total = 0;
  let count = 0;
  for (const inv of safe) {
    if (!inv) continue;
    if (inv.paid) continue;
    const amt = asNumber(inv.total);
    if (amt <= 0) continue;
    total += amt;
    count += 1;
  }
  return { total: Math.round(total * 100) / 100, count };
}

/**
 * Same shape as computeOutstanding, but only counts invoices whose `date`
 * falls within [fromIso, toIso]. Either bound can be omitted to leave that
 * end open. Dates are compared as YYYY-MM-DD strings (ISO date), which is
 * how the invoices table stores them.
 */
export function computeOutstandingInRange(invoices, fromIso, toIso) {
  const safe = Array.isArray(invoices) ? invoices : [];
  const filtered = safe.filter((inv) => withinRange(inv?.date, fromIso, toIso));
  return computeOutstanding(filtered);
}

/**
 * Revenue totals over a date range — sums total of PAID invoices in window.
 *
 *   computeRevenueInRange(invoices, fromIso, toIso) -> { total, count }
 */
export function computeRevenueInRange(invoices, fromIso, toIso) {
  const safe = Array.isArray(invoices) ? invoices : [];
  let total = 0;
  let count = 0;
  for (const inv of safe) {
    if (!inv?.paid) continue;
    if (!withinRange(inv.date, fromIso, toIso)) continue;
    const amt = asNumber(inv.total);
    if (amt <= 0) continue;
    total += amt;
    count += 1;
  }
  return { total: Math.round(total * 100) / 100, count };
}
