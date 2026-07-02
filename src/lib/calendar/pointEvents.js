// Pure builder for the Production month-calendar chips, extracted from the
// pointEvents useMemo in Production.jsx so the dedup rules are unit-testable.
//
// Returns { "YYYY-MM-DD": [event, ...] } where an event is either
//   { order, step, isDue }                 — order pipeline chip
//   { kind: "quote", quote, step, isDue }  — quote lifecycle chip
//
// The bug this defends against: a completed order could grow TWO "Completed"
// chips — one from step_dates["Completed"] (the plannable pipeline step,
// which drag-and-drop writes) and one from completed_date (the status stamp
// the Dashboard / revenue stats key on). Moving the chip wrote only
// step_dates, so the completed_date chip stayed behind as a duplicate.
// Rule now: once an order is Completed with a completed_date, that column is
// the single source for its "Completed" chip; the step_dates entry renders
// only while the order is still in progress (a planned completion date).

import { O_STATUSES } from "../../components/shared/pricing";

export function buildPointEvents(orders, quotes) {
  const map = {};
  const push = (date, event) => {
    if (!map[date]) map[date] = [];
    map[date].push(event);
  };

  (orders || []).forEach((o) => {
    const stepDates = o.step_dates || {};
    // completed_date wins for Completed orders — see header comment.
    const completedChipFromColumn = o.status === "Completed" && o.completed_date;

    O_STATUSES.forEach((step) => {
      const val = stepDates[step];
      if (!val) return;
      if (step === "Completed" && completedChipFromColumn) return;

      if (step === "Printing" && typeof val === "object" && val.start && val.end) {
        // Printing as date range: add point events for start and end dates
        [val.start, val.end].forEach((date) => push(date, { order: o, step, isDue: false }));
      } else if (typeof val === "string") {
        // Single date for any step
        push(val, { order: o, step, isDue: false });
      }
    });

    if (o.date) push(o.date, { order: o, step: "Order Goods", isDue: false });

    // Completed orders get a green chip on completed_date so the
    // calendar serves as a historical "what shipped when" record even
    // when an order had no scheduled steps.
    if (completedChipFromColumn) {
      push(o.completed_date, { order: o, step: "Completed", isDue: false });
    }
    // Completed orders don't get a red "Due" chip — the job is done.
    if (o.due_date && o.status !== "Completed") {
      push(o.due_date, { order: o, step: "Due", isDue: true });
    }
  });

  // Quote lifecycle chips — pushed directly from quote rows, not joined
  // via order. A quote that's been sent but not converted still shows up.
  // Date strings normalized to YYYY-MM-DD (client_approved_at is full ISO).
  (quotes || []).forEach((q) => {
    if (q.sent_date) {
      push(String(q.sent_date).slice(0, 10), { kind: "quote", quote: q, step: "Quote Sent", isDue: false });
    }
    if (q.client_approved_at) {
      push(String(q.client_approved_at).slice(0, 10), { kind: "quote", quote: q, step: "Quote Approved", isDue: false });
    }
  });

  return map;
}
