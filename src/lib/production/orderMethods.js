// Decoration-method helpers for the Production board's method filter.
//
// Mixed shops (screen print + embroidery + DTF/heat transfer) asked to see
// jobs by method so the embroidery operator isn't scrolling past print work
// (r/screenprinting, 2026-09). Methods aren't a column — they live on each
// line item's imprints[].technique — so these derive them from the order.
//
// Pure + defensive: line_items / imprints may be missing, null, or a
// non-array on legacy rows.

// The set of decoration methods used anywhere in an order (normalized-trimmed
// technique strings; blanks dropped). "Screen Print", "Embroidery", etc.
export function orderMethods(order) {
  const out = new Set();
  const items = Array.isArray(order?.line_items) ? order.line_items : [];
  for (const li of items) {
    const imprints = Array.isArray(li?.imprints) ? li.imprints : [];
    for (const imp of imprints) {
      const t = typeof imp?.technique === "string" ? imp.technique.trim() : "";
      if (t) out.add(t);
    }
  }
  return out;
}

// True when the order uses the given method (case/space-insensitive). "All"
// or a falsy method means no filtering.
export function orderHasMethod(order, method) {
  if (!method || method === "All") return true;
  const want = String(method).trim().toLowerCase();
  for (const m of orderMethods(order)) {
    if (m.toLowerCase() === want) return true;
  }
  return false;
}

// The distinct methods present across a set of orders, in a stable order
// (known methods first in a sensible sequence, then any custom ones
// alphabetically). Used to build the filter chips — and to decide whether to
// show them at all (a single-method shop shouldn't see the row).
const KNOWN_ORDER = ["Screen Print", "Embroidery", "DTF", "Heat Transfer"];
export function availableMethods(orders) {
  const present = new Set();
  for (const o of Array.isArray(orders) ? orders : []) {
    for (const m of orderMethods(o)) present.add(m);
  }
  const known = KNOWN_ORDER.filter((m) => present.has(m));
  const custom = [...present].filter((m) => !KNOWN_ORDER.includes(m)).sort();
  return [...known, ...custom];
}
