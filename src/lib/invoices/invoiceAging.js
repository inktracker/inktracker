// Invoice aging for the Invoices list — the "how long has this been owed"
// signal the walkthrough flagged as missing (unpaid rows showed no age, only
// a Mark Paid button). Maps to the design-language color roles: slate =
// quiet, amber = aging/attention, red = overdue (past its due date).
//
// Pure and defensive: paid invoices and rows with no usable issue date
// return null (no signal).

const DAY = 86400000;
const AGING_DAYS = 30; // net-30 convention: past this and it's worth noticing

function toEpoch(dateStr) {
  if (!dateStr) return NaN;
  // Date-only strings ("2026-09-01") parse as UTC midnight; that's fine for
  // day-count math where both sides get the same treatment.
  const t = new Date(dateStr).getTime();
  return Number.isFinite(t) ? t : NaN;
}

// invoiceAging(invoice, now)
//   → null when paid, or when there's no issue date to age from
//   → { days, overdue, overdueDays, tone, label }
//       days        — whole days since the invoice date
//       overdue     — true when a due date exists and today is past it
//       overdueDays — whole days past the due date (0 when not overdue)
//       tone        — "red" (overdue) | "amber" (aging) | "slate"
//       label       — "5 days overdue" | "42 days outstanding" | "Due today"
export function invoiceAging(invoice, now = Date.now()) {
  if (!invoice || invoice.paid) return null;

  const issued = toEpoch(invoice.date || invoice.created_at);
  if (Number.isNaN(issued)) return null;

  const days = Math.max(0, Math.floor((now - issued) / DAY));

  const dueEpoch = toEpoch(invoice.due);
  const hasDue = !Number.isNaN(dueEpoch);
  const overdueDays = hasDue ? Math.floor((now - dueEpoch) / DAY) : 0;
  const overdue = hasDue && overdueDays > 0;

  let tone, label;
  if (overdue) {
    tone = "red";
    label = `${overdueDays} day${overdueDays === 1 ? "" : "s"} overdue`;
  } else if (hasDue && overdueDays === 0) {
    tone = "amber";
    label = "Due today";
  } else if (days >= AGING_DAYS) {
    tone = "amber";
    label = `${days} days outstanding`;
  } else {
    tone = "slate";
    label = `${days} day${days === 1 ? "" : "s"} outstanding`;
  }

  return { days, overdue, overdueDays: Math.max(0, overdueDays), tone, label };
}

// Tailwind text class per tone — kept next to the logic so the two can't drift.
export const AGING_TONE_CLASS = {
  red: "font-semibold text-red-600",
  amber: "font-semibold text-amber-700",
  slate: "text-slate-400",
};
