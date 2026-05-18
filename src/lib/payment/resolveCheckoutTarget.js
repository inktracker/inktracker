/**
 * Decide where the customer's "Approve & Pay" button should send them.
 *
 *   resolveCheckoutTarget(quote) -> {
 *     provider: "qb" | "stripe",
 *     url: string | null,        // QB payment URL when provider==='qb', else null
 *   }
 *
 * The frontend stores `quote.qb_payment_link` whenever a quote was synced to
 * QuickBooks. `connect.intuit.com` is messy: it hosts BOTH the real anonymous-
 * pay customer-facing share link AND a legacy login-required portal. We tell
 * them apart by path, not host:
 *
 *   ACCEPT — anonymous-pay share link (minted by POST /invoice/{id}/send):
 *     https://connect.intuit.com/portal/app/CommerceNetwork/view/scs-v1-…
 *
 *   REJECT — legacy fabricated fallback we used to construct (requires the
 *   customer to log into their own Intuit account):
 *     https://connect.intuit.com/portal/asei/CommerceNetwork/consumer/view-invoice?…
 *
 * Other Intuit payment hosts (`payments.intuit.com`, the payments subdomain
 * of `quickbooks.intuit.com`, etc.) are accepted at the host level. Known
 * login-only hosts (`app.qbo.intuit.com`, `accounts.intuit.com`) are
 * rejected at the host level.
 */

// connect.intuit.com hosts both real and fake payment URLs — distinguish by path.
const QB_SHARE_LINK_PATH_PREFIX = "/portal/app/CommerceNetwork/view/scs-";

const QB_PAYMENT_HOST_PATTERNS = [
  /(^|\.)payments\.intuit\.com$/i,
  /(^|\.)quickbooks\.intuit\.com$/i, // payments.quickbooks.intuit.com etc.
  /(^|\.)intuit-payments\.com$/i,
];

const QB_LOGIN_HOSTS = [
  "app.qbo.intuit.com",       // QBO web app (login required)
  "qbo.intuit.com",
  "accounts.intuit.com",      // Intuit SSO
];

function parseUrl(url) {
  if (typeof url !== "string" || !url.startsWith("http")) return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function isQBPaymentLink(url) {
  const parsed = parseUrl(url);
  if (!parsed) return false;
  const host = parsed.hostname.toLowerCase();

  // connect.intuit.com: accept only the real share-link path. The legacy
  // `/portal/asei/CommerceNetwork/consumer/view-invoice` fake URL falls
  // through and gets rejected here.
  if (host === "connect.intuit.com") {
    return parsed.pathname.startsWith(QB_SHARE_LINK_PATH_PREFIX);
  }

  if (QB_LOGIN_HOSTS.includes(host)) return false;
  return QB_PAYMENT_HOST_PATTERNS.some((re) => re.test(host));
}

export function resolveCheckoutTarget(quote) {
  const link = quote?.qb_payment_link;
  if (isQBPaymentLink(link)) {
    return { provider: "qb", url: link };
  }
  return { provider: "stripe", url: null };
}
