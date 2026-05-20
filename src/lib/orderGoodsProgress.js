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
 * Order Goods. Cycles through the three states so a wrong tap is
 * always undoable:
 *
 *   blank → "ordered" → "received" → blank → "ordered" → …
 *
 * Returns:
 *   "ordered"  — caller should set status to "ordered"
 *   "received" — caller should set status to "received"
 *   null       — caller should DELETE the entry (cycle back to blank)
 *
 * Note: this is a contract change from the old "ordered → received,
 * everything else is no-op" version. The old behavior assumed sizes
 * could only get to "ordered" via the AS Colour PO auto-mark; for
 * shops not on that integration, the cycle lets them advance through
 * blank → ordered → received manually.
 */
export function nextGoodsStatusOnTap(currentStatus) {
  if (currentStatus === "received") return null;       // received → blank (cycle)
  if (currentStatus === "ordered") return "received";  // ordered → received
  return "ordered";                                    // blank → ordered
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

/**
 * Bulk-toggle every size on every line item for the given parent task.
 * Used by the Order Goods parent buttons ("Place blank order" /
 * "Receive goods") as a manual override for shops whose blanks don't
 * come from an InkTracker-integrated supplier (AS Colour).
 *
 * The function is a TOGGLE — clicking the parent advances if the
 * step isn't complete, and undoes if it is:
 *
 *   target = "ordered"  ("Place blank order")
 *     Not yet at-target → set every blank size to "ordered" (leaves
 *                         sizes already ordered/received alone — no
 *                         regression)
 *     At-target         → CLEAR every size back to blank. (If the
 *                         user accidentally clicked "Place blank
 *                         order," they get a one-click undo.)
 *
 *   target = "received" ("Receive goods")
 *     Not yet at-target → set every blank/ordered size to "received"
 *     At-target         → roll every size back to "ordered" (less
 *                         destructive than clearing to blank — the
 *                         shop usually still wants to remember the
 *                         order was placed)
 *
 * "At-target" semantics mirror autoCheckOrderGoodsTask so the parent
 * button's visual state matches its toggle behavior.
 *
 * @param {object} order
 * @param {"ordered" | "received"} target
 * @param {string} actor — display name to stamp on `by` for set keys
 * @returns {object} the new goods_progress map (don't mutate the input)
 */
export function bulkSetOrderGoodsStep(order, target, actor) {
  if (target !== "ordered" && target !== "received") return order?.checklist?.goods_progress || {};
  const lineItems = order?.line_items || [];
  const gp = { ...(order?.checklist?.goods_progress || {}) };
  const now = new Date().toISOString();

  // Collect every real size key so we can act on all of them atomically.
  const allKeys = [];
  for (let idx = 0; idx < lineItems.length; idx++) {
    for (const [size, count] of Object.entries(lineItems[idx]?.sizes || {})) {
      if ((parseInt(count) || 0) <= 0) continue;
      allKeys.push(`${idx}-${size}`);
    }
  }
  if (allKeys.length === 0) return gp;

  const isAtTarget = (key) => {
    const s = gp[key]?.status;
    if (target === "ordered") return s === "ordered" || s === "received";  // any non-blank counts
    return s === "received";
  };
  const allAtTarget = allKeys.every(isAtTarget);

  if (allAtTarget) {
    // UNDO branch
    if (target === "ordered") {
      // "Place blank order" undo: clear everything back to blank.
      for (const key of allKeys) delete gp[key];
    } else {
      // "Receive goods" undo: roll back to ordered (don't lose that
      // the order was placed at all).
      for (const key of allKeys) {
        gp[key] = { status: "ordered", by: actor || "Manual", at: now };
      }
    }
  } else {
    // FORWARD branch
    for (const key of allKeys) {
      const current = gp[key]?.status;
      if (target === "ordered") {
        if (!current) gp[key] = { status: "ordered", by: actor || "Manual", at: now };
      } else {
        if (current !== "received") gp[key] = { status: "received", by: actor || "Manual", at: now };
      }
    }
  }
  return gp;
}
