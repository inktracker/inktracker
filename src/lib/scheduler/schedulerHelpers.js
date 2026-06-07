// Pure helpers behind the Press Scheduler view in /Production.
//
// Extracted from Production.jsx so they're unit-testable. Date math
// is done at noon to dodge DST hour shifts — two adjacent days in
// March or November can otherwise come out as 0.96 or 1.04 days
// apart, and Math.round at the rounding boundary flips the result.

import { normalizeAssignedPress } from "@/lib/presses/normalizePresses";

/**
 * Days between two YYYY-MM-DD ISO strings.
 *   daysBetween("2026-06-04", "2026-06-04") === 0
 *   daysBetween("2026-06-04", "2026-06-05") === 1
 *
 * @param {string} startIso
 * @param {string} endIso
 * @returns {number}
 */
export function daysBetween(startIso, endIso) {
  const a = new Date(startIso + "T12:00:00");
  const b = new Date(endIso + "T12:00:00");
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/**
 * Position of an ISO date within a week-strip that starts at
 * `weekStartIso`. 0 = first column. May be negative (before window)
 * or >= daysVisible (after window). Returns null when `iso` is
 * missing/empty.
 *
 * @param {string|null|undefined} iso
 * @param {string} weekStartIso
 * @returns {number | null}
 */
export function dayIndex(iso, weekStartIso) {
  if (!iso) return null;
  return daysBetween(weekStartIso, iso);
}

/**
 * Inclusive span length in days for a scheduled order.
 *   single-day:    spanDays({scheduled_date:"2026-06-04"}) === 1
 *   2-day span:    spanDays({scheduled_date:"6/4", scheduled_end_date:"6/5"}) === 2
 *   unscheduled:   spanDays({}) === 1   (treated as 1 so callers can
 *                                        safely divide estimated_hours
 *                                        without guarding for zero)
 *
 * @param {{ scheduled_date?: string|null, scheduled_end_date?: string|null }} order
 * @returns {number}
 */
export function spanDays(order) {
  if (!order?.scheduled_date) return 1;
  const end = order.scheduled_end_date || order.scheduled_date;
  return Math.max(1, daysBetween(order.scheduled_date, end) + 1);
}

/**
 * Compute the chip placements for a single press lane within the
 * visible week. Each item carries the column range it occupies and
 * a stack index so overlapping spans render on separate rows.
 *
 * Greedy first-fit on the stack: chip placed in the lowest stack
 * whose previously-placed chip ends before this one starts.
 *
 * @param {Array} orders            Active (non-Completed) orders, full list
 * @param {string} pressName        Filter — only orders on this press
 * @param {string} weekStartIso     YYYY-MM-DD of the first visible column
 * @param {number} [daysVisible=7]  Column count
 * @returns {{ items: Array<{
 *   order: object,
 *   startCol: number,
 *   endCol: number,
 *   clippedLeft: boolean,
 *   clippedRight: boolean,
 *   totalSpan: number,
 *   stackIdx: number,
 * }>, maxStack: number }}
 */
export function placementsForPress(orders, pressName, weekStartIso, daysVisible = 7) {
  const maxCol = daysVisible - 1;
  const items = (orders || [])
    .filter((o) => o && normalizeAssignedPress(o.assigned_press) === pressName && o.scheduled_date)
    .map((o) => {
      const rawStart = dayIndex(o.scheduled_date, weekStartIso);
      const rawEnd   = dayIndex(o.scheduled_end_date || o.scheduled_date, weekStartIso);
      if (rawEnd < 0 || rawStart > maxCol) return null;
      const startCol = Math.max(0, rawStart);
      const endCol   = Math.min(maxCol, rawEnd);
      return {
        order: o,
        startCol,
        endCol,
        clippedLeft:  rawStart < 0,
        clippedRight: rawEnd > maxCol,
        totalSpan:    spanDays(o),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.startCol - b.startCol);

  const stackEnds = []; // stackIdx → last endCol placed
  for (const p of items) {
    let i = 0;
    while (i < stackEnds.length && stackEnds[i] >= p.startCol) i++;
    if (i === stackEnds.length) stackEnds.push(p.endCol);
    else stackEnds[i] = p.endCol;
    p.stackIdx = i;
  }
  return { items, maxStack: stackEnds.length };
}

/**
 * Sum of estimated hours that fall on `dayIso` across all orders on
 * the given press. Each order's hours are split evenly across its
 * full span — a 16-hour, 2-day job contributes 8 hrs on each day.
 *
 * Capacity badge uses this. Rounded to one decimal so the UI
 * doesn't show "5.333..h" noise.
 *
 * @param {Array} orders
 * @param {string} pressName
 * @param {string} dayIso  YYYY-MM-DD
 * @returns {number}  hours, rounded to 0.1
 */
export function hoursOnPressDay(orders, pressName, dayIso) {
  let total = 0;
  for (const o of orders || []) {
    if (!o || normalizeAssignedPress(o.assigned_press) !== pressName || !o.scheduled_date) continue;
    const start = o.scheduled_date;
    const end   = o.scheduled_end_date || o.scheduled_date;
    if (dayIso < start || dayIso > end) continue;
    const hrs = Number(o.estimated_hours) || 0;
    if (!hrs) continue;
    total += hrs / spanDays(o);
  }
  return Math.round(total * 10) / 10;
}
