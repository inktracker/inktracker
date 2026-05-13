// Counts how many quotes, orders, and invoices reference a given customer.
// Used at the customer-delete gate to prevent silently orphaning history.
//
// Why both customer_id AND customer_name match: the modern create paths set
// customer_id on every related entity, but legacy rows (or rows imported via
// the email-paste flow) may only have customer_name. The merge-duplicates
// flow in Customers.jsx already does this dual lookup; this helper mirrors
// that defensiveness so the delete gate doesn't miss real dependents.
//
// Pure function — accepts pre-loaded arrays so it stays trivially testable.

function nameKey(s) {
  return (s || "").trim().toLowerCase();
}

function makeMatcher(customer) {
  const id = customer?.id;
  const name = nameKey(customer?.name);
  return (entity) => {
    if (!entity) return false;
    if (entity.customer_id && id) return entity.customer_id === id;
    // Fall back to name only when the entity has no customer_id at all.
    // If it has a different customer_id, that's a different customer who
    // happens to share a name — do NOT count.
    if (!entity.customer_id && name) return nameKey(entity.customer_name) === name;
    return false;
  };
}

/**
 * @param {object} customer  must have { id, name }
 * @param {object} buckets   pre-loaded arrays { quotes, orders, invoices }
 * @returns {{ quotes:number, orders:number, invoices:number, total:number }}
 */
export function countCustomerDependents(customer, buckets = {}) {
  if (!customer?.id) {
    return { quotes: 0, orders: 0, invoices: 0, total: 0 };
  }
  const match = makeMatcher(customer);
  const quotes = (buckets.quotes || []).filter(match).length;
  const orders = (buckets.orders || []).filter(match).length;
  const invoices = (buckets.invoices || []).filter(match).length;
  return { quotes, orders, invoices, total: quotes + orders + invoices };
}

/**
 * Format the counts for a user-facing alert.
 * Returns null if there are no dependents (caller treats null as "go ahead").
 */
export function formatDependentsMessage(counts, customerName = "this customer") {
  if (!counts || counts.total === 0) return null;
  const parts = [];
  if (counts.quotes)   parts.push(`${counts.quotes} quote${counts.quotes === 1 ? "" : "s"}`);
  if (counts.orders)   parts.push(`${counts.orders} order${counts.orders === 1 ? "" : "s"}`);
  if (counts.invoices) parts.push(`${counts.invoices} invoice${counts.invoices === 1 ? "" : "s"}`);
  const list = parts.join(", ");
  return `Can't delete ${customerName} — they're linked to ${list}. Deleting now would leave those records pointing at a customer that no longer exists. Use "Merge Duplicates" to consolidate, or edit those records to a different customer first.`;
}
