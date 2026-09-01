// Pure-logic for the Quotes list "waiting on customer" cue.
//
// sentAge(sentDate, now)
//   → null when there's nothing to say (no/invalid date, non-sent row)
//   → { label: "Sent today" | "Sent yesterday" | "Sent 6 days ago", stale }
//     stale flips at STALE_AFTER_DAYS so the row can quietly escalate —
//     a quote sitting unanswered is the thing the owner most needs to see.

export const STALE_AFTER_DAYS = 5;

export function sentAge(sentDate, now = Date.now()) {
  if (!sentDate) return null;
  const t = new Date(sentDate).getTime();
  if (!Number.isFinite(t)) return null;
  const days = Math.floor((now - t) / 86400000);
  if (days < 0) return null; // clock skew — say nothing rather than nonsense
  const label =
    days === 0 ? "Sent today" :
    days === 1 ? "Sent yesterday" :
    `Sent ${days} days ago`;
  return { label, stale: days >= STALE_AFTER_DAYS };
}
