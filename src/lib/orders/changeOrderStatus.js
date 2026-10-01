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
//   • leaving Art Approval forward → refused until the customer approved the
//                        current art, when the shop requires it
//                        (pricing_config.requireArtApproval). An owner or
//                        manager can approve on the customer's behalf with a
//                        note (artProof override), which satisfies the gate.
//   • "Order Goods"    → ensurePoDraftsForOrder (idempotent draft PO(s) per
//                        supplier), fire-and-forget; result reported through
//                        the optional onAutoPo callback.
//
// Status-change notifications and customer emails are DB triggers, so they
// fire the same for every write here. Returns the updated order row.
import { O_STATUSES, getShopPricingConfig } from "@/components/shared/pricing";
import { artGate } from "@/lib/art/artApproval";
import { runOrderCompletion } from "./runOrderCompletion";
import { ensurePoDraftsForOrder } from "./autoPoFromOrder";
import { todayInShopTz } from "@/lib/shopTimezone";

export const FIRST_STATUS = O_STATUSES[0];

/** Does this shop require customer art approval before production? */
export function shopRequiresArtApproval(pricingConfig = getShopPricingConfig()) {
  return pricingConfig?.requireArtApproval === true;
}

/**
 * Pure: may this status change go ahead? Only blocks leaving Art Approval
 * forward without approved art, and only when the shop requires approval.
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function checkArtGate(order, newStatus, requireArtApproval) {
  if (!requireArtApproval) return { ok: true };
  const g = artGate(order, effectiveStatus(order), newStatus, O_STATUSES);
  if (g.ok) return g;
  return {
    ok: false,
    reason: `${g.reason} Production waits for the customer's approval. An owner or manager can approve it for them (for example, approved by phone) from the order's Artwork section.`,
  };
}

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
/**
 * Throw the plain "art not approved" error when the gate says no. For the
 * few completion paths that call runOrderCompletion directly (Complete
 * buttons, bulk complete) so the gate can't be skipped through them.
 */
export function assertArtGate(order, newStatus, requireArtApproval = shopRequiresArtApproval()) {
  const gate = checkArtGate(order, newStatus, requireArtApproval);
  if (gate.ok) return;
  const err = new Error(gate.reason);
  err.code = "ART_NOT_APPROVED";
  throw err;
}

/**
 * The gate, on FRESH data: re-reads the order when the gate could block, so
 * a list row loaded before an override (or before someone sent a new proof
 * or changed the art) can't decide either way.
 */
export async function assertArtGateFresh(order, newStatus, base44, requireArtApproval = shopRequiresArtApproval()) {
  if (!requireArtApproval) return order;
  const artIdx = O_STATUSES.indexOf("Art Approval");
  const leavingForward = O_STATUSES.indexOf(effectiveStatus(order)) <= artIdx && O_STATUSES.indexOf(newStatus) > artIdx;
  if (!leavingForward) return order; // the gate can't apply — no extra read
  let fresh = order;
  try {
    fresh = (await base44.entities.Order.get(order.id)) || order;
  } catch {
    fresh = order;
  }
  assertArtGate(fresh, newStatus, requireArtApproval);
  return fresh;
}

export async function changeOrderStatus({ order, newStatus, user, base44, onAutoPo, autoPoOptions, completionMode = "full", requireArtApproval = shopRequiresArtApproval() }) {
  if (!order?.id) throw new Error("changeOrderStatus: order required");
  if (!O_STATUSES.includes(newStatus)) throw new Error(`changeOrderStatus: unknown status "${newStatus}"`);

  await assertArtGateFresh(order, newStatus, base44, requireArtApproval);

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
