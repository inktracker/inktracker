// Pure-logic for BrokerClientList.jsx — search, filter, sort.
//
// Search matches case-insensitively against name/company/email.
// filters.taxExempt = true narrows to clients with tax_exempt set.
// Output is always sorted by name (case-insensitive, base-sensitivity).

export function filterClients(clients, { search = "", filters = {} } = {}) {
  if (!Array.isArray(clients)) return [];
  const q = String(search || "").toLowerCase();
  return clients.filter((c) => {
    if (q) {
      const hit =
        (c.name || "").toLowerCase().includes(q) ||
        (c.company || "").toLowerCase().includes(q) ||
        (c.email || "").toLowerCase().includes(q);
      if (!hit) return false;
    }
    if (filters.taxExempt && !c.tax_exempt) return false;
    return true;
  });
}

export function sortClientsByName(clients) {
  if (!Array.isArray(clients)) return [];
  return [...clients].sort((a, b) =>
    (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" }),
  );
}

// Convenience: filter + sort in one call (matches the inline behavior
// in BrokerClientList).
export function filterAndSortClients(clients, opts) {
  return sortClientsByName(filterClients(clients, opts));
}
