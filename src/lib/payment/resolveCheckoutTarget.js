/**
 * Decide where the customer's "Approve & Pay" button should send them.
 *
 *   resolveCheckoutTarget(quote) -> {
 *     provider: "qb" | "stripe",
 *     url: string | null,        // QB payment URL when provider==='qb', else null
 *   }
 *
 * The frontend stores `quote.qb_payment_link` whenever a quote was synced to
 * QuickBooks. Some of those URLs are **real** customer-facing payment pages
 * (issued by QB Payments), others are internal Intuit URLs that require the
 * customer to log into their own QB account — useless for paying. We have to
 * tell them apart.
 *
 * Heuristic: a QB link is a usable payment URL only when it points at a
 * payments host (`payments.intuit.com`, `quickbooks.intuit.com/payments/…`,
 * etc.). Hosts known to require an Intuit login (the legacy
 * `connect.intuit.com/portal/asei/…` fallback, the QBO web app at
 * `app.qbo.intuit.com`) are rejected and the caller falls through to Stripe.
 */

const QB_LOGIN_HOSTS = [
  "connect.intuit.com",       // legacy CommerceNetwork fallback (login required)
  "app.qbo.intuit.com",       // QBO web app (login required)
  "qbo.intuit.com",
  "accounts.intuit.com",      // Intuit SSO
];

const QB_PAYMENT_HOST_PATTERNS = [
  /(^|\.)payments\.intuit\.com$/i,
  /(^|\.)quickbooks\.intuit\.com$/i, // payments.quickbooks.intuit.com etc.
  /(^|\.)intuit-payments\.com$/i,
];

function parseHost(url) {
  if (typeof url !== "string" || !url.startsWith("http")) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isQBPaymentLink(url) {
  const host = parseHost(url);
  if (!host) return false;
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
