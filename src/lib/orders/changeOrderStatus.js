// ONE status-change path for Orders, Production, and Shop Floor.
//
// Audit 2026-09-22 found the three pages doing different things on the same
// transition: Production/Orders auto-created draft POs on entering "Order
// Goods" but the floor didn't; Production's pipeline chip stamped a date on
// "Completed" while its Complete button (and the floor) ran invoicing and
// performance rows; nobody cleared a stage's checklist when a job was moved
// back, so a re-entered stage was already fully ticked and auto-advanced
// again on the next tap. Every page now calls changeOrderStatus() and gets
// identical side effects:
//
//   • "Completed"      → runOrderCompletion (completed_date, invoice link/
//                        create, performance rows, broker file + notify)…
//                        EXCEPT from the Shop Floor (completionMode "floor"):
//                        the floor stamps status + completed_date +
//                        floor_completed_at ("production done, needs
//                        invoicing") and the office finishes the money side
//                        with Create Invoice, which clears the flag. Floor
//                        staff never write invoices.
//   • backward move    → the re-entered stage's checklist is cleared so it
//                        can't bounce forward from stale ticks.
//   • "Order Goods"    → ensurePoDraftsForOrder (idempotent draft PO(s) per
//                        supplier), fire-and-forget; result reported through
//                        the optional onAutoPo callback.
//
// Status-change notifications and customer emails are DB triggers, so they
// fire the same for every write here. Returns the updated order row.
import { O_STATUSES } from "@/components/shared/pricing";
import { runOrderCompletion } from "./runOrderCompletion";
import { ensurePoDraftsForOrder } from "./autoPoFromOrder";
import { todayInShopTz } from "@/lib/shopTimezone";

export const FIRST_STATUS = O_STATUSES[0];

/** Status to treat an order as being in when its status is blank/unknown. */
export function effectiveStatus(order) {
  const s = order?.status;
  return O_STATUSES.includes(s) ? s : FIRST_STATUS;
}

/** Next / previous stage for an order, or null at the ends. */
export function nextStatusOf(order) {
  const idx = O_STATUSES.indexOf(effectiveStatus(order));
  return idx >= 0 && idx < O_STATUSES.length - 1 ? O_STATUSES[idx + 1] : null;
}
export function prevStatusOf(order) {
  const idx = O_STATUSES.indexOf(effectiveStatus(order));
  return idx > 0 ? O_STATUSES[idx - 1] : null;
}

/** Pure: the Shop Floor's completion payload — production done, money side deferred to the office. */
export function floorCompletionPayload(today = todayInShopTz(), now = new Date().toISOString()) {
  return { status: "Completed", completed_date: today, floor_completed_at: now };
}

/**
 * Pure: the update payload for a non-Completed status change.
 * Clears the checklist of the stage being re-entered on a backward move.
 */
export function buildStatusPayload(order, newStatus) {
  const from = effectiveStatus(order);
  const payload = { status: newStatus };
  const movingBack = O_STATUSES.indexOf(newStatus) < O_STATUSES.indexOf(from);
  if (movingBack && order?.checklist && order.checklist[newStatus] && Object.keys(order.checklist[newStatus]).length) {
    payload.checklist = { ...order.checklist, [newStatus]: {} };
  }
  return payload;
}

/**
 * @param {object} args
 * @param {object} args.order       current order row
 * @param {string} args.newStatus   one of O_STATUSES
 * @param {object} args.user        signed-in user (shop scope + auto-PO)
 * @param {object} args.base44      data client
 * @param {(res:{created:any[], warnings?:any[]}) => void} [args.onAutoPo]
 *        called after draft POs are (or aren't) created on entering Order Goods
 * @param {object} [args.autoPoOptions]  passed through to ensurePoDraftsForOrder
 * @param {"full"|"floor"} [args.completionMode="full"]  "floor" = stamp Completed +
 *        floor_completed_at and leave invoicing to the office
 * @returns {Promise<object>} updated order
 */
export async function changeOrderStatus({ order, newStatus, user, base44, onAutoPo, autoPoOptions, completionMode = "full" }) {
  if (!order?.id) throw new Error("changeOrderStatus: order required");
  if (!O_STATUSES.includes(newStatus)) throw new Error(`changeOrderStatus: unknown status "${newStatus}"`);

  if (newStatus === "Completed") {
    if (order.status === "Completed") return order;
    if (completionMode === "floor") {
      return base44.entities.Order.update(order.id, floorCompletionPayload());
    }
    return runOrderCompletion({ order, user, base44 });
  }

  const updated = await base44.entities.Order.update(order.id, buildStatusPayload(order, newStatus));

  if (newStatus === "Order Goods" && user?.email) {
    // Idempotent + fire-and-forget: the helper self-checks for an existing PO.
    ensurePoDraftsForOrder(updated, user, autoPoOptions)
      .then((res) => { if (onAutoPo) onAutoPo(res); })
      .catch((e) => console.warn("[changeOrderStatus] ensurePoDraftsForOrder failed:", e));
  }
  return updated;
}

/** Standard toast copy for the auto-PO result — shared so the three pages say the same thing. */
export function autoPoToast(res, orderLabel) {
  const created = res?.created || [];
  if (!created.length) return null;
  const label = created.length === 1 ? "Draft PO" : `${created.length} draft POs`;
  return `${label} created for ${orderLabel || "this order"} — review on Purchase Orders.`;
}
