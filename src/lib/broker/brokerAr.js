// Shop-side broker accounts-receivable: from the shop's orders, summarize the
// wholesale invoices the shop billed brokers (orders.qb_broker_invoice_id) and
// what's still owed. Pure/injection-free so it's unit-testable and reusable.
//
// Amount comes from orders.qb_broker_invoice_total — QB's authoritative TotalAmt
// stamped at bill time by billBrokerForOrder. Orders billed before that column
// existed carry null; they still COUNT, but their dollars are unknown (surfaced
// via amountKnown so the UI can say "amount in QuickBooks" instead of $0).

function brokerKey(o) {
  return String(o?.broker_email || o?.broker_id || "").toLowerCase().trim();
}

function brokerName(o) {
  return o?.broker_company || o?.broker_name || o?.broker_email || o?.broker_id || "Broker";
}

/**
 * @param {Array} orders  the shop's orders (any status)
 * @returns {{
 *   brokers: Array<{ key, name, email, invoiceCount, paidCount, dueCount,
 *                    dueTotal, dueAmountKnown, invoices: Array }>,
 *   totalDue: number, totalDueAmountKnown: boolean,
 *   invoiceCount: number, dueCount: number,
 * }}
 */
export function summarizeBrokerAR(orders) {
  const list = Array.isArray(orders) ? orders : [];
  // Only orders that actually carry a wholesale broker invoice.
  const billed = list.filter((o) => o && o.qb_broker_invoice_id);

  const byBroker = new Map();
  for (const o of billed) {
    const key = brokerKey(o);
    if (!byBroker.has(key)) {
      byBroker.set(key, {
        key,
        name: brokerName(o),
        email: o.broker_email || o.broker_id || "",
        invoiceCount: 0,
        paidCount: 0,
        dueCount: 0,
        dueTotal: 0,
        dueAmountKnown: true, // false once any unpaid invoice has an unknown amount
        invoices: [],
      });
    }
    const b = byBroker.get(key);
    const paid = o.broker_invoice_paid === true;
    // NB: Number(null) === 0, so guard the null/undefined case explicitly —
    // a missing stamped total means "amount unknown", not "$0".
    const rawTotal = o.qb_broker_invoice_total;
    const amountKnown = rawTotal != null && Number.isFinite(Number(rawTotal)) && Number(rawTotal) >= 0;
    const amount = amountKnown ? Number(rawTotal) : null;

    b.invoiceCount += 1;
    if (paid) {
      b.paidCount += 1;
    } else {
      b.dueCount += 1;
      if (amountKnown) b.dueTotal += amount;
      else b.dueAmountKnown = false;
    }
    b.invoices.push({
      orderId: o.order_id || o.id,
      docNumber: o.qb_broker_doc_number || null,
      paymentLink: o.qb_broker_payment_link || null,
      paid,
      amount,
      syncedAt: o.qb_broker_invoice_synced_at || null,
    });
  }

  // Most money owed first; brokers with unknown-amount dues sort after known.
  const brokers = [...byBroker.values()].sort((a, b) => b.dueTotal - a.dueTotal);

  const totalDue = brokers.reduce((s, b) => s + b.dueTotal, 0);
  const totalDueAmountKnown = brokers.every((b) => b.dueAmountKnown);
  const invoiceCount = billed.length;
  const dueCount = brokers.reduce((s, b) => s + b.dueCount, 0);

  return { brokers, totalDue, totalDueAmountKnown, invoiceCount, dueCount };
}
