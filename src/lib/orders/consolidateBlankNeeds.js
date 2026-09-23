import { round2 } from "@/lib/pricing/round2";
// Consolidated blank buying — given the OPEN orders that still need goods
// ordered, work out every blank to buy, grouped by supplier and summed across
// jobs, so the shop places ONE purchase order per supplier for the week
// instead of one PO per order (then merging by hand).
//
// This is the pure part: it turns order line_items into an aggregated
// "needs" summary. Resolving each (style,color,size) into a supplier SKU +
// live cost happens later at PO-build time (via the supplier lookup APIs) —
// the order snapshot doesn't carry per-size SKUs.
//
// A line contributes only when it has a supplier AND a style AND a positive
// quantity; anything missing those lands in `unresolved` so the UI can show
// "these need a manual PO" rather than silently dropping them.

const SUPPLIER_ALIASES = {
  "s&s": "S&S Activewear",
  "s&s activewear": "S&S Activewear",
  "ss activewear": "S&S Activewear",
  "as colour": "AS Colour",
  "ascolour": "AS Colour",
  "as color": "AS Colour",
  sanmar: "SanMar",
};

// Canonical supplier name (so "s&s" and "S&S Activewear" group together and
// match the SUPPLIERS registry); unknown suppliers pass through trimmed.
export function normalizeSupplier(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return SUPPLIER_ALIASES[raw.toLowerCase()] || raw;
}

function sumSizes(sizes) {
  if (!sizes || typeof sizes !== "object") return 0;
  let total = 0;
  for (const v of Object.values(sizes)) total += Number(v) || 0;
  return total;
}


// Orders whose blanks still need ordering: active (not terminal) and NOT
// already covered by a SUBMITTED purchase order (via the scalar source_order_id
// OR the consolidated source_order_ids array). Draft POs don't count as covered
// — the goods aren't actually on order until the PO is submitted.
export const TERMINAL_ORDER_STATUSES = new Set(["Completed", "Cancelled", "Canceled", "Voided"]);

export function ordersNeedingGoods(orders, purchaseOrders) {
  const covered = new Set();
  for (const po of Array.isArray(purchaseOrders) ? purchaseOrders : []) {
    if (po?.status !== "submitted") continue;
    if (po.source_order_id) covered.add(String(po.source_order_id));
    for (const oid of Array.isArray(po.source_order_ids) ? po.source_order_ids : []) {
      if (oid) covered.add(String(oid));
    }
  }
  return (Array.isArray(orders) ? orders : []).filter((o) => {
    if (!o?.id) return false;
    if (TERMINAL_ORDER_STATUSES.has(o.status)) return false;
    if (covered.has(String(o.id))) return false;
    // Must have at least one line with a positive quantity to order.
    return (Array.isArray(o.line_items) ? o.line_items : []).some(
      (li) => li?.sizes && typeof li.sizes === "object" && Object.values(li.sizes).some((n) => (Number(n) || 0) > 0),
    );
  });
}

// aggregateBlankNeeds(orders) →
//   { bySupplier: { [supplier]: { supplier, lines[], totalQty, estSubtotal } },
//     unresolved: [ { orderId, orderRef, supplier, style, color, sizes, qty, productTitle } ] }
// Each `lines[]` element:
//   { supplier, brand, styleNumber, color, productTitle,
//     sizes: {size: qtySummed}, totalQty, unitCost, costMismatch?,
//     sourceOrders: [ { orderId, orderRef, qty } ] }
export function aggregateBlankNeeds(orders) {
  const groups = new Map(); // supplier -> Map(lineKey -> agg)
  const unresolved = [];

  for (const order of Array.isArray(orders) ? orders : []) {
    const orderId = order?.id ?? null;
    const orderRef = order?.order_id || order?.id || "";
    for (const li of Array.isArray(order?.line_items) ? order.line_items : []) {
      const supplier = normalizeSupplier(li?.supplier);
      const style = String(li?.styleNumber || li?.style || "").trim();
      const color = String(li?.garmentColor || "").trim();
      const sizes = li?.sizes && typeof li.sizes === "object" ? li.sizes : {};
      const lineQty = sumSizes(sizes);
      if (lineQty <= 0) continue; // nothing to order on this line

      if (!supplier || !style) {
        unresolved.push({
          orderId, orderRef, supplier, style, color, sizes,
          qty: lineQty, productTitle: li?.productTitle || li?.garmentName || "",
        });
        continue;
      }

      const lineKey = `${supplier}|${style}|${color}`.toLowerCase();
      if (!groups.has(supplier)) groups.set(supplier, new Map());
      const g = groups.get(supplier);
      let agg = g.get(lineKey);
      if (!agg) {
        agg = {
          supplier,
          brand: li?.brand || "",
          styleNumber: style,
          color,
          productTitle: li?.productTitle || li?.garmentName || "",
          sizes: {},
          totalQty: 0,
          unitCost: 0,
          sourceOrders: [],
        };
        g.set(lineKey, agg);
      }

      for (const [sz, n] of Object.entries(sizes)) {
        const q = Number(n) || 0;
        if (q > 0) agg.sizes[sz] = (agg.sizes[sz] || 0) + q;
      }
      agg.totalQty += lineQty;

      // Track garment cost. Saved quotes snapshot the cost at quote time, so
      // the SAME style across two jobs can carry different costs — take the
      // first non-zero and flag a mismatch so the UI can warn that the live
      // cost should be re-pulled at PO time.
      const cost = round2(li?.garmentCost);
      if (!agg.unitCost && cost) agg.unitCost = cost;
      else if (cost && agg.unitCost && Math.abs(cost - agg.unitCost) > 0.001) agg.costMismatch = true;

      agg.sourceOrders.push({ orderId, orderRef, qty: lineQty });
    }
  }

  const bySupplier = {};
  for (const [supplier, g] of groups) {
    const lines = [...g.values()].sort(
      (a, b) => a.styleNumber.localeCompare(b.styleNumber) || a.color.localeCompare(b.color),
    );
    const totalQty = lines.reduce((s, l) => s + l.totalQty, 0);
    const estSubtotal = round2(lines.reduce((s, l) => s + l.totalQty * (l.unitCost || 0), 0));
    bySupplier[supplier] = { supplier, lines, totalQty, estSubtotal };
  }

  return { bySupplier, unresolved };
}
