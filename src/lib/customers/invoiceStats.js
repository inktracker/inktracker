// Per-customer invoice aggregates for the Customers page profile cards.
//
// Why local instead of QB: the card previously showed QB-sourced stats
// (qbSync getCustomerStats), which silently undercounted any customer
// with pre-QB-integration history — Beloved's showed "2 invoices /
// $3,550" while the Invoices tab correctly listed 4 totaling $8,210.
// The coherent rule: the profile card summarizes exactly what the
// Invoices tab shows, which is InkTracker's own invoices table (the
// superset — QB-created invoices have local rows too).

export function aggregateInvoiceStatsByCustomer(invoices) {
  const byCustomer = {};
  for (const inv of invoices ?? []) {
    const key = inv?.customer_id;
    if (!key) continue;
    if (!byCustomer[key]) byCustomer[key] = { count: 0, collected: 0 };
    byCustomer[key].count += 1;
    // "collected" means money actually received — unpaid invoices count
    // toward the invoice tally but not the dollar figure.
    if (inv.paid) byCustomer[key].collected += Number(inv.total) || 0;
  }
  return byCustomer;
}
