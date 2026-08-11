// Pay-link validation monitor — pure logic, wired into qbReconcile's nightly
// sweep alongside the email-health and integrity scans.
//
// The blind spot this closes: the customer "Approve & Pay" button only
// renders when quote.qb_payment_link passes the frontend's known-good URL
// patterns (src/lib/payment/resolveCheckoutTarget.js). When Intuit changed
// their share-link format (~2026-08-06, /portal/app/CommerceNetwork/view/scs-
// → /t/scs-), every newly sent quote silently fell back to Approve-only and
// nobody knew until a shop owner noticed days later (Joe, 2026-08-11:
// "this needs to be monitored... should not happen"). This scan re-validates
// recent links server-side and alerts the operator with the exact URL shape
// that failed, so a future format flip is a next-morning email, not a
// revenue leak.
//
// LOCKSTEP: the patterns below MUST mirror resolveCheckoutTarget.js
// (isQBPaymentLink). Update both together; each file points at the other.

const QB_SHARE_LINK_PATH_PREFIXES = [
  "/portal/app/CommerceNetwork/view/scs-",
  "/t/scs-",
];

const QB_PAYMENT_HOST_PATTERNS = [
  /(^|\.)payments\.intuit\.com$/i,
  /(^|\.)quickbooks\.intuit\.com$/i,
  /(^|\.)intuit-payments\.com$/i,
];

const QB_LOGIN_HOSTS = ["app.qbo.intuit.com", "qbo.intuit.com", "accounts.intuit.com"];

export function isKnownQbPaymentLink(url) {
  if (typeof url !== "string" || !url.startsWith("http")) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  if (host === "connect.intuit.com") {
    return QB_SHARE_LINK_PATH_PREFIXES.some((p) => parsed.pathname.startsWith(p));
  }
  if (QB_LOGIN_HOSTS.includes(host)) return false;
  return QB_PAYMENT_HOST_PATTERNS.some((re) => re.test(host));
}

// Strip the token: host + first two path segments is enough to diagnose a
// format flip and safe to put in an email.
export function linkShape(url) {
  try {
    const u = new URL(url);
    const segs = u.pathname.split("/").filter(Boolean);
    return u.hostname + "/" + segs.slice(0, 2).join("/") + (segs.length > 2 ? "/…" : "");
  } catch {
    return String(url).slice(0, 60);
  }
}

/**
 * @param {Array<{quote_id:string, shop_owner:string, qb_payment_link:string}>} rows
 * @returns {{ checked:number, failing:Array<{quote_id:string,shop_owner:string,shape:string}> }}
 */
export function summarizePayLinkHealth(rows) {
  const failing = [];
  for (const r of rows || []) {
    if (!r?.qb_payment_link) continue;
    if (!isKnownQbPaymentLink(r.qb_payment_link)) {
      failing.push({ quote_id: r.quote_id, shop_owner: r.shop_owner, shape: linkShape(r.qb_payment_link) });
    }
  }
  return { checked: (rows || []).length, failing };
}

export function shouldSendPayLinkAlert(summary) {
  return (summary?.failing?.length ?? 0) >= 1;
}

export function buildPayLinkAlertText(summary, { sinceDays = 4 } = {}) {
  const shapes = [...new Set(summary.failing.map((f) => f.shape))];
  const lines = [
    `InkTracker pay-link monitor: ${summary.failing.length} of ${summary.checked} QB payment link(s) created in the last ${sinceDays} day(s) FAIL known-good validation.`,
    "",
    "Customers on these quotes see Approve-only (no online payment) until the",
    "frontend's accepted patterns are updated (src/lib/payment/resolveCheckoutTarget.js",
    "+ this scan's mirror in _shared/qbPayLinkAlert.js — keep in lockstep).",
    "",
    "Unrecognized URL shape(s):",
    ...shapes.map((s) => `  • ${s}`),
    "",
    "Affected quotes:",
    ...summary.failing.slice(0, 10).map((f) => `  • ${f.shop_owner} ${f.quote_id}`),
    summary.failing.length > 10 ? `  … and ${summary.failing.length - 10} more` : "",
    "",
    "Most likely cause: Intuit changed their share-link format again (they did",
    "on 2026-08-06). Verify one link opens an anonymous pay page, then add the",
    "new pattern to BOTH files above.",
  ];
  return lines.filter(Boolean).join("\n");
}
