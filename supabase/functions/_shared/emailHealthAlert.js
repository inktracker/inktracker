// Pure decision + formatting for the email-delivery health alert, extracted
// so the logic is unit-testable without a live cron run. Wired into
// qbReconcile's nightly sweep alongside the QB error digest.
//
// The blind spot this closes: every shop-owner notification (quote approved,
// payment received, artwork approved) failed silently with resend_403 from
// June 1 to July 2, 2026 — notification_log recorded all 40 failures, but
// nothing read it. This alert reads it.
//
// OPERATOR-ONLY by design: the alert text names shops and failure internals
// (secrets to check, Resend dashboard state). It must never route to a shop
// owner — the caller sends strictly to OPERATOR_ALERT_EMAIL and skips
// entirely when that secret is unset.

// Collapse the last-24h notification_log rows into what the operator needs
// to triage: how many failed, why, which event types, and which shops were
// waiting on those emails.
export function summarizeNotificationFailures(rows) {
  const failed = (rows || []).filter((r) => r?.status === "failed");
  const byReason = {};
  const byEvent = {};
  const shops = new Set();
  for (const r of failed) {
    const reason = r.failure_reason || "unknown";
    byReason[reason] = (byReason[reason] || 0) + 1;
    const evt = r.event_type || "unknown";
    byEvent[evt] = (byEvent[evt] || 0) + 1;
    if (r.shop_owner) shops.add(r.shop_owner);
  }
  return {
    total: (rows || []).length,
    failed: failed.length,
    byReason,
    byEvent,
    shops: [...shops].sort(),
  };
}

// Any post-retry failure is worth a nudge — resendClient already retries
// 429/5xx/network before a row lands as "failed", and at this volume a
// single failed notification is a real shop owner not finding out a
// customer approved or paid.
export function shouldSendEmailHealthAlert(summary) {
  return (summary?.failed ?? 0) >= 1;
}

export function buildEmailHealthAlertText(summary, { sinceHours = 24 } = {}) {
  const reasonLines = Object.entries(summary.byReason)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, n]) => `  • ${reason}: ${n}`)
    .join("\n");
  const eventLines = Object.entries(summary.byEvent)
    .sort((a, b) => b[1] - a[1])
    .map(([evt, n]) => `  • ${evt}: ${n}`)
    .join("\n");
  const shopLines = summary.shops.map((s) => `  • ${s}`).join("\n");

  return (
    `${summary.failed} of ${summary.total} notification email(s) FAILED in the last ${sinceHours}h.\n\n` +
    `Failure reasons:\n${reasonLines}\n\n` +
    `Event types affected:\n${eventLines}\n\n` +
    `Shops whose notifications didn't send:\n${shopLines}\n\n` +
    `Where to look (in order):\n` +
    `  • resend_403 → sender domain problem. The ONLY Resend-verified domain is\n` +
    `    info.inktracker.app — check resend.com/domains, and the APPROVAL_SEND_FROM /\n` +
    `    FROM_EMAIL secrets (must be @info.inktracker.app addresses).\n` +
    `  • resend_401 → RESEND_API_KEY invalid or rotated.\n` +
    `  • resend_429 / 5xx that exhausted retries → check Resend status page and plan limits.\n` +
    `  • Full detail: notification_log table, status='failed', newest first.\n\n` +
    `Affected shop owners got their in-app bell notifications but NO email — for\n` +
    `payment/approval events they may not know a customer acted. Consider a manual\n` +
    `heads-up once the send path is fixed.`
  );
}
