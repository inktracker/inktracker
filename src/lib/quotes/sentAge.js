// Pure-logic for the Quotes list "waiting on customer" signal line
// (design-language wording approved 2026-08-31).
//
// sentAge(sentDate, now)
//   → null when there's nothing to say (no/invalid date, non-sent row)
//   → { label, stale } — "Today · waiting", "3 days · waiting",
//     then "6 days · no reply" once STALE_AFTER_DAYS is reached; stale
//     flips with the wording so the row can quietly escalate to amber —
//     a quote sitting unanswered is the thing the owner most needs to see.

export const STALE_AFTER_DAYS = 5;

export function sentAge(sentDate, now = Date.now()) {
  if (!sentDate) return null;
  const t = new Date(sentDate).getTime();
  if (!Number.isFinite(t)) return null;
  const days = Math.floor((now - t) / 86400000);
  if (days < 0) return null; // clock skew — say nothing rather than nonsense
  const stale = days >= STALE_AFTER_DAYS;
  const when =
    days === 0 ? "Today" :
    days === 1 ? "Yesterday" :
    `${days} days`;
  return { label: `${when} · ${stale ? "no reply" : "waiting"}`, stale };
}
