// Shop Floor work queues — pure helpers (unit-tested) behind the floor's
// filter tabs. "Ready for press" answers the operator's actual question —
// "what can I print right now?" — instead of the pipeline's: a job is ready
// once it's past Art Approval and Order Goods (art signed off, blanks in),
// i.e. status Pre-Press or Printing. Optionally narrowed to one press via
// the assigned_press the office set on the order.
import { normalizeAssignedPress } from "@/lib/presses/normalizePresses";

export const READY_FOR_PRESS_STATUSES = ["Pre-Press", "Printing"];

export function isReadyForPress(order) {
  return READY_FOR_PRESS_STATUSES.includes(order?.status);
}

/** Soonest scheduled/due first; undated jobs sink to the bottom. */
export function byScheduledThenDue(a, b) {
  return String(a?.scheduled_date || a?.due_date || "9999").localeCompare(String(b?.scheduled_date || b?.due_date || "9999"));
}

/**
 * The ready-for-press queue, optionally for one press.
 * @param {object[]} orders
 * @param {string} [press]  a press name from pressOptions(); "" / undefined = all presses
 */
export function readyForPress(orders, press = "") {
  const want = String(press || "").trim().toLowerCase();
  return (orders || [])
    .filter(isReadyForPress)
    .filter((o) => !want || String(normalizeAssignedPress(o.assigned_press) || "").trim().toLowerCase() === want)
    .sort(byScheduledThenDue);
}

/** Distinct press names assigned among ready jobs, for the press picker chips. */
export function pressOptions(orders) {
  const seen = new Map();
  for (const o of orders || []) {
    if (!isReadyForPress(o)) continue;
    const p = String(normalizeAssignedPress(o.assigned_press) || "").trim();
    if (p && !seen.has(p.toLowerCase())) seen.set(p.toLowerCase(), p);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
