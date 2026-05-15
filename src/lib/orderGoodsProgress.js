// Pure logic for the Order Goods stage's per-size tracking, shared
// across all three surfaces that render Floor Mode (ShopFloor route,
// OrderDetailModal Floor Mode panel, Production inline detail).
//
// The data model lives on order.checklist.goods_progress as a map
// keyed by `${liIdx}-${size}` with values { status, by, at,
// supplier_order_id? }. Status is "ordered" or "received".
//
// State machine (per size):
//   blank    →  ordered   — set automatically when the supplier PO
//                           submits via API (applyPOItemsToGoodsProgress
//                           in purchaseOrders.js does this). Operators
//                           do NOT advance to "ordered" by hand.
//   ordered  →  received  — manual tap by the operator when goods are
//                           physically received at the shop.
//   received →  (terminal) — physically you can't un-receive goods.

/**
 * Tally per-size goods status across an order's line items.
 * Sizes with qty <= 0 don't count (they're not real).
 *
 * @param {object} order  — order row with line_items[] and checklist.goods_progress
 * @returns {{ total: number, ordered: number, received: number, marked: number }}
 *   marked = ordered + received (sizes that have any non-blank status)
 */
export function countGoodsProgress(order) {
  let total = 0, ordered = 0, received = 0;
  const gp = order?.checklist?.goods_progress || {};
  const lineItems = order?.line_items || [];
  for (let idx = 0; idx < lineItems.length; idx++) {
    const li = lineItems[idx];
    for (const [size, count] of Object.entries(li?.sizes || {})) {
      if ((parseInt(count) || 0) <= 0) continue;
      total++;
      const s = gp[`${idx}-${size}`]?.status;
      if (s === "ordered") ordered++;
      else if (s === "received") received++;
    }
  }
  return { total, ordered, received, marked: ordered + received };
}

/**
 * For the Order Goods step, decide if a task is auto-derived from the
 * per-size status counts so the operator doesn't have to redundantly
 * tick it off.
 *
 *   "Place blank order" → auto-done when every size has been at-least-ordered
 *   "Receive goods"     → auto-done when every size has been received
 *
 * @returns {boolean | null}
 *   null  — task is manual (caller falls back to stepChecks[task])
 *   true  — auto-derived done
 *   false — auto-derive applies but condition not met
 */
export function autoCheckOrderGoodsTask(step, task, counts) {
  if (step !== "Order Goods") return null;
  if (task === "Place blank order") {
    return (counts?.total || 0) > 0 && (counts?.marked || 0) === counts.total;
  }
  if (task === "Receive goods") {
    return (counts?.total || 0) > 0 && (counts?.received || 0) === counts.total;
  }
  return null;
}

/**
 * Decide the next status when an operator taps a per-size button in
 * Order Goods. Manual flow only — ordered → received. Blank and
 * received are both no-ops. Returns the new status or null.
 */
export function nextGoodsStatusOnTap(currentStatus) {
  if (currentStatus === "ordered") return "received";
  return null;
}

/**
 * Number of sizes still not received. Used by the move-to-Pre-Press
 * soft-warn guard to tell the operator how much is outstanding before
 * they advance.
 */
export function unreceivedCount(order) {
  const { total, received } = countGoodsProgress(order);
  return Math.max(0, total - received);
}
