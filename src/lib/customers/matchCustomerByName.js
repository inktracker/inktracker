// Find an existing customer for a QB-originated invoice by name.
//
// QB-pulled invoices arrive with customer_id=null (connecting QB imports
// invoices, NOT customers — see the customer-import gap). When one of
// those is bridged onto production, the caller uses this to reuse the
// shop's existing customer record instead of creating a duplicate.
//
// Matching is deliberately conservative: exact name (or company) match,
// case/whitespace-insensitive. Fuzzy matching risks attaching a job to
// the wrong customer, which is worse than creating a new record the
// shop can merge later.

/**
 * @param {Array<object>} customers  the shop's customer rows
 * @param {string} name              invoice.customer_name as pulled from QB
 * @returns {object|null} the matched customer row, or null
 */
export function matchCustomerByName(customers, name) {
  const needle = normalize(name);
  if (!needle) return null;
  const list = Array.isArray(customers) ? customers.filter(Boolean) : [];
  return (
    list.find((c) => normalize(c.name) === needle) ||
    list.find((c) => normalize(c.company) === needle) ||
    null
  );
}

function normalize(s) {
  return typeof s === "string" ? s.trim().replace(/\s+/g, " ").toLowerCase() : "";
}
