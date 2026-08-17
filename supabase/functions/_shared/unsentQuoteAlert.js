// "Sent" quotes that were never actually emailed — pure logic, wired into
// qbReconcile's nightly sweep next to the pay-link and email-health scans.
//
// The blind spot this closes: a quote row can reach status "Sent" without a
// single message leaving the building. Joe hit it on Q-2026-HNUD
// (2026-08-17) — the QB invoice + pay link were created, the email never
// went, and the quote read "Sent" with sent_to/sent_date NULL. The customer
// heard nothing; the only symptom was Joe noticing his own copy missing.
// qbSync no longer advances status on invoice create, but ANY future path
// that stamps "Sent" without delivering (a thrown send, a half-finished
// flow, a shop closing the tab mid-send) reopens the same hole. So we watch
// the invariant itself rather than the one bug:
//
//   status === "Sent"  ⇒  sent_date IS NOT NULL  AND  sent_to IS NOT NULL
//
// A row violating that is a quote the shop believes went out and didn't.

// Grace period: a send in flight can legitimately sit in "Sent" for a few
// seconds before the post-send patch lands. Only rows older than this count.
const GRACE_MINUTES = 30;

export function isUnsentSentQuote(row, { now = 0, graceMinutes = GRACE_MINUTES } = {}) {
  if (!row || row.status !== "Sent") return false;
  const hasDate = Boolean(String(row.sent_date ?? "").trim());
  const hasTo = Boolean(String(row.sent_to ?? "").trim());
  if (hasDate && hasTo) return false;
  // Ignore rows still inside the grace window (send may be in flight).
  const stamp = Date.parse(row.updated_at || row.created_at || "");
  if (Number.isFinite(stamp) && now && now - stamp < graceMinutes * 60 * 1000) return false;
  return true;
}

/**
 * @param {Array<{quote_id:string, shop_owner:string, status:string, sent_date:any, sent_to:any, created_at:string}>} rows
 * @returns {{ checked:number, failing:Array<{quote_id:string, shop_owner:string, missing:string}> }}
 */
export function summarizeUnsentQuotes(rows, opts = {}) {
  const failing = [];
  for (const r of rows || []) {
    if (!isUnsentSentQuote(r, opts)) continue;
    const missing = [
      String(r.sent_date ?? "").trim() ? null : "sent_date",
      String(r.sent_to ?? "").trim() ? null : "sent_to",
    ].filter(Boolean).join(" + ");
    failing.push({ quote_id: r.quote_id, shop_owner: r.shop_owner, missing });
  }
  return { checked: (rows || []).length, failing };
}

export function shouldSendUnsentQuoteAlert(summary) {
  return (summary?.failing?.length ?? 0) >= 1;
}

export function buildUnsentQuoteAlertText(summary, { sinceDays = 7 } = {}) {
  const lines = [
    `InkTracker send monitor: ${summary.failing.length} of ${summary.checked} quote(s) from the last ${sinceDays} day(s) are marked "Sent" but were never emailed.`,
    "",
    "These shops believe their customer received a quote. The customer did not.",
    "Each row below has status = Sent with no delivery record:",
    "",
    ...summary.failing.slice(0, 15).map((f) => `  • ${f.shop_owner} ${f.quote_id} — missing ${f.missing}`),
    summary.failing.length > 15 ? `  … and ${summary.failing.length - 15} more` : "",
    "",
    "What to do: open the quote and re-send it (the QB invoice, if any, already",
    "exists — re-sending does not duplicate it). Then find out what swallowed the",
    "send: a thrown error in SendQuoteModal.handleSend, a rejected Resend call, or",
    "a path that stamps status without delivering.",
    "",
    "Invariant being watched: status \"Sent\" implies sent_date AND sent_to are set.",
  ];
  return lines.filter(Boolean).join("\n");
}
