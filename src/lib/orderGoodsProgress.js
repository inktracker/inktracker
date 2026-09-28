// Pure logic for per-size goods tracking, shared across all three
// surfaces that render Floor Mode (ShopFloor route, OrderDetailModal
// Floor Mode panel, Production inline detail).
//
// The data model lives on order.checklist.goods_progress as a map
// keyed by `${liIdx}-${size}` with values { status, by, at,
// supplier_order_id? }. Status is "ordered" or "received".
//
// Which stage owns which half of the cycle (2026-09-28): ORDERING happens
// on Order Goods, RECEIVING moved to Pre-Press — so Order Goods purely
// means "still needs ordering" and it's obvious at a glance what's
// outstanding. These constants are the single source of truth for that
// split; both Floor Mode UIs read them.
export const GOODS_ORDER_STAGE = "Order Goods";
export const GOODS_RECEIVE_STAGE = "Pre-Press";

// State machine (per size):
//   blank    →  ordered   — on Order Goods (manual tap, or auto when the
//                           supplier PO submits via API —
//                           applyPOItemsToGoodsProgress in purchaseOrders.js).
//   ordered  →  received  — on Pre-Press: manual tap when goods physically
//                           arrive at the shop.
//   received →  ordered   — on Pre-Press: tap again to undo a mis-receive
//                           (kept recoverable rather than terminal).

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
 * Decide if a goods task is auto-derived from the per-size status counts
 * so the operator doesn't have to redundantly tick it off. The two tasks
 * now live on different stages (see GOODS_ORDER_STAGE / GOODS_RECEIVE_STAGE):
 *
 *   Order Goods · "Place blank order" → auto-done when every size is at-least-ordered
 *   Pre-Press   · "Receive goods"     → auto-done when every size is received
 *
 * @returns {boolean | null}
 *   null  — task is manual on this stage (caller falls back to stepChecks[task])
 *   true  — auto-derived done
 *   false — auto-derive applies but condition not met
 */
// Canonical task names that get auto-derived from per-size
// goods_progress. If a shop renames either via Account → Production
// Tasks, auto-derive stops firing for that task and the operator
// has to check it manually — the UI warns them about this in the
// Production Tasks editor.
export const ORDER_GOODS_AUTO_PLACE = "Place blank order";
export const ORDER_GOODS_AUTO_RECEIVE = "Receive goods";

// "Art Approval" → the "Get approval" task IS the customer's approval on the
// order (art_approved, written by the ArtApproval page when the customer
// signs off). Floor staff can't grant it by tapping; it derives from the
// record. Returns null for every other task so it stays operator-tickable.
export const ART_APPROVAL_AUTO_TASK = "Get approval";
export function autoCheckArtApprovalTask(step, task, order) {
  if (step !== "Art Approval") return null;
  if (task !== ART_APPROVAL_AUTO_TASK) return null;
  return !!order?.art_approved;
}

// One entry point: auto-derived state for any stage's task, or null when the
// task is a plain operator checkbox. Goods tasks derive from per-size counts
// (ordering on Order Goods, receiving on Pre-Press), Art Approval from the
// customer's approval.
export function autoCheckTask(step, task, order, counts) {
  const art = autoCheckArtApprovalTask(step, task, order);
  if (art !== null) return art;
  return autoCheckGoodsTask(step, task, counts || countGoodsProgress(order));
}

// "Place blank order" auto-derives on Order Goods (every size at-least-ordered);
// "Receive goods" auto-derives on Pre-Press (every size received). Each fires
// ONLY on its own stage, so the same task name on the wrong stage stays a
// manual checkbox.
export function autoCheckGoodsTask(step, task, counts) {
  if (step === GOODS_ORDER_STAGE && task === ORDER_GOODS_AUTO_PLACE) {
    return (counts?.total || 0) > 0 && (counts?.marked || 0) === counts.total;
  }
  if (step === GOODS_RECEIVE_STAGE && task === ORDER_GOODS_AUTO_RECEIVE) {
    return (counts?.total || 0) > 0 && (counts?.received || 0) === counts.total;
  }
  return null;
}

// Back-compat alias — older imports referenced autoCheckOrderGoodsTask.
export const autoCheckOrderGoodsTask = autoCheckGoodsTask;

/**
 * Decide the next status when an operator taps a per-size button, given
 * the stage they're on. Ordering and receiving are now split across two
 * stages, so the tap cycle is stage-scoped and every tap stays undoable:
 *
 *   Order Goods (GOODS_ORDER_STAGE):   blank ⇄ ordered
 *     blank → "ordered", ordered → blank. (A stray "received" also clears
 *     to blank — receiving isn't done on this stage.)
 *
 *   Pre-Press (GOODS_RECEIVE_STAGE):   ordered ⇄ received
 *     blank → "received", ordered → "received", received → "ordered"
 *     (undo a mis-receive without losing that it was ordered).
 *
 * Returns:
 *   "ordered"  — caller should set status to "ordered"
 *   "received" — caller should set status to "received"
 *   null       — caller should DELETE the entry (cycle back to blank)
 *
 * `stage` is optional; when omitted it falls back to the legacy single-stage
 * full cycle (blank → ordered → received → blank) so older callers are safe.
 */
export function nextGoodsStatusOnTap(currentStatus, stage) {
  if (stage === GOODS_ORDER_STAGE) {
    return currentStatus === "ordered" ? null : (currentStatus === "received" ? null : "ordered");
  }
  if (stage === GOODS_RECEIVE_STAGE) {
    return currentStatus === "received" ? "ordered" : "received";
  }
  // Legacy full cycle (no stage supplied).
  if (currentStatus === "received") return null;       // received → blank
  if (currentStatus === "ordered") return "received";  // ordered → received
  return "ordered";                                    // blank → ordered
}

/**
 * Number of sizes still not received. Used by the Pre-Press → Printing
 * soft-warn guard to tell the operator how much is outstanding before
 * they start printing (receiving now happens on Pre-Press).
 */
export function unreceivedCount(order) {
  const { total, received } = countGoodsProgress(order);
  return Math.max(0, total - received);
}

/**
 * Bulk-toggle every size on every line item for the given parent task.
 * Used by the "Place blank order" button (Order Goods) and the
 * "Receive goods" button (Pre-Press) as a manual override for shops
 * whose blanks don't come from an InkTracker-integrated supplier (AS
 * Colour). Target-based, so it's stage-agnostic.
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
