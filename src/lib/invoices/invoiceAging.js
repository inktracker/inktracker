// Invoice aging for the Invoices list — the "how long has this been owed"
// signal (unpaid rows previously showed no age). Maps to the design-language
// color roles: slate = quiet, amber = aging/attention, red = overdue.
//
// Pure and timezone-correct: the caller passes `todayStr`, today's calendar
// date ("YYYY-MM-DD") in the SHOP's timezone (via todayInShopTz). All day
// math is calendar-day differences between date-only strings, so an invoice
// is never labeled overdue a day early because UTC crossed midnight before
// the shop's wall clock did. Paid invoices and rows with no usable issue
// date return null (no signal).

const DAY = 86400000;
const AGING_DAYS = 30; // net-30 convention: past this and it's worth noticing

// A date-only string ("2026-09-01"), the date portion of an ISO timestamp,
// or "" — normalized to "YYYY-MM-DD" or null. (invoice.date is date-only;
// created_at is a full timestamp whose leading 10 chars are its date.)
function toDateStr(value) {
  if (!value) return null;
  const s = String(value);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

// Whole calendar days from aStr to bStr (b - a). Both parsed as UTC midnight,
// so the result is an exact, timezone-independent day count.
function dayDiff(aStr, bStr) {
  const a = Date.parse(`${aStr}T00:00:00Z`);
  const b = Date.parse(`${bStr}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  return Math.round((b - a) / DAY);
}

// invoiceAging(invoice, todayStr)
//   todayStr — "YYYY-MM-DD" today in the shop's tz (todayInShopTz()).
//   → null when paid, or when there's no issue date to age from, or todayStr
//     is unusable.
//   → { days, overdue, overdueDays, tone, label }
export function invoiceAging(invoice, todayStr) {
  if (!invoice || invoice.paid) return null;
  const today = toDateStr(todayStr);
  if (!today) return null;

  const issued = toDateStr(invoice.date || invoice.created_at);
  if (!issued) return null;

  const rawDays = dayDiff(issued, today);
  if (Number.isNaN(rawDays)) return null;
  const days = Math.max(0, rawDays);

  const dueStr = toDateStr(invoice.due);
  const hasDue = !!dueStr;
  const overdueDays = hasDue ? dayDiff(dueStr, today) : 0;
  const overdue = hasDue && Number.isFinite(overdueDays) && overdueDays > 0;

  let tone, label;
  if (overdue) {
    tone = "red";
    label = `${overdueDays} day${overdueDays === 1 ? "" : "s"} overdue`;
  } else if (hasDue && overdueDays === 0) {
    tone = "amber";
    label = "Due today";
  } else if (!hasDue && days >= AGING_DAYS) {
    // Age-based heuristic only when there's no due date — a not-yet-due
    // net-60 invoice issued 40 days ago is not "attention", it's on time.
    tone = "amber";
    label = `${days} days outstanding`;
  } else {
    tone = "slate";
    label = `${days} day${days === 1 ? "" : "s"} outstanding`;
  }

  return { days, overdue, overdueDays: Math.max(0, Number.isFinite(overdueDays) ? overdueDays : 0), tone, label };
}

// Tailwind text class per tone — kept next to the logic so the two can't drift.
export const AGING_TONE_CLASS = {
  red: "font-semibold text-red-600",
  amber: "font-semibold text-amber-700",
  slate: "text-slate-400",
};
