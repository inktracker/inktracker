// Agenda planning helpers — surface "what should I do on this day" hints
// in the calendar / production agenda panel. Pure functions, no React,
// no DB calls — keeps the logic testable and the page components clean.

import { countGoodsProgress } from "@/lib/orderGoodsProgress";

/**
 * Returns an ISO date string (YYYY-MM-DD) `n` days after the given ISO
 * date. Pure — no timezone juggling beyond what Date already does.
 * Returns the input unchanged when it's not a recognizable date.
 */
export function addDaysISO(isoDate, n) {
  if (typeof isoDate !== "string") return isoDate;
  const [y, m, d] = isoDate.slice(0, 10).split("-").map((s) => parseInt(s, 10));
  if (!y || !m || !d) return isoDate;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + (Number(n) || 0));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * "in N days" / "today" / "overdue N days" — copy for an upcoming due
 * date relative to a base date. Both args are YYYY-MM-DD ISO strings.
 */
export function relativeDueLabel(dueDate, baseDate) {
  if (!dueDate || !baseDate) return "";
  const due = dueDate.slice(0, 10);
  const base = baseDate.slice(0, 10);
  if (due === base) return "Due today";
  // Compute day diff via UTC math to dodge DST shenanigans.
  const [dy, dm, dd] = due.split("-").map((s) => parseInt(s, 10));
  const [by, bm, bd] = base.split("-").map((s) => parseInt(s, 10));
  if (!dy || !by) return `Due ${due}`;
  const dueMs = Date.UTC(dy, dm - 1, dd);
  const baseMs = Date.UTC(by, bm - 1, bd);
  const diff = Math.round((dueMs - baseMs) / 86400000);
  if (diff === 1) return "Due tomorrow";
  if (diff > 1) return `Due in ${diff} days`;
  if (diff === -1) return "Overdue 1 day";
  return `Overdue ${Math.abs(diff)} days`;
}

/**
 * Returns a short string describing the most immediate action this
 * order needs, or null if no specific hint applies. Drives the
 * "Order goods pending" / "Receive blanks" / "Get art approved" copy
 * in the agenda. The CALLER decides whether to show it (e.g. skip when
 * order is Completed).
 *
 * Order Goods sub-state (anyOrdered, allReceived) comes from
 * countGoodsProgress so the agenda hint can't drift from what the
 * Floor Mode panel shows for the same order.
 */
export function getOrderActionHint(order) {
  if (!order) return null;
  const status = order.status;
  if (status === "Completed" || status === "Cancelled") return null;

  if (status === "Art Approval") return "Get art approved";

  if (status === "Order Goods") {
    const { total, ordered, received, marked } = countGoodsProgress(order);
    if (total === 0) return null; // no sizes to order — line items missing
    if (marked === 0) return "Order blanks";
    if (received < total && ordered + received < total) return "Finish ordering blanks";
    if (received < total) return "Receive blanks";
    return null; // all received — ready to move on
  }

  if (status === "Pre-Press") return "Set up screens";
  if (status === "Printing") return "Print scheduled";

  return null;
}
