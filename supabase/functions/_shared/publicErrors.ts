// Customer-facing error copy — the last line of defense before a real person
// (our shop's CUSTOMER, who never signed up for anything) reads an error.
//
// The rule: a customer-facing endpoint may only ever emit a message WE wrote.
// Not a Postgres error, not a Stripe SDK message, not `String(err)`. Those
// leak implementation detail, look broken, and give the reader no next step.
//
// This is an ALLOWLIST, deliberately — a denylist of "scary looking strings"
// fails open the first time a new dependency invents a new error format. If a
// message isn't recognized here, the customer gets a friendly generic and the
// real text goes to the logs (where it's actually useful).
//
// Background: a customer was shown a raw
// `{"statusCode":"404","error":"Bucket not found"}` body on her art proof.
// The root cause was fixed (#680/#681); this closes the "raw text reaches a
// customer" class at the SERVER boundary for every customer-facing function.

/** Generic, friendly, actionable. Used whenever we don't recognize the error. */
export const PUBLIC_FALLBACK =
  "Something went wrong on our end. Please refresh and try again — if it keeps happening, contact the shop and they'll help you out.";

/**
 * Messages our own handlers intentionally return to customers. Anything in
 * this set passes through verbatim; anything else is replaced by a friendly
 * equivalent (or PUBLIC_FALLBACK).
 *
 * Keep these written for a CUSTOMER, not an engineer: no jargon, no IDs, and
 * always an implied next step.
 */
export const PUBLIC_SAFE_MESSAGES: ReadonlySet<string> = new Set([
  "Quote not found.",
  "Order not found.",
  "This quote link has expired.",
  "This quote has already been approved.",
  "This quote has already been paid.",
  "Online payment isn't available for this quote.",
  "Failed to approve quote.",
  "Could not verify the submission. Please try again.",
]);

/**
 * Terse internal messages (mostly raised by the wizard RPC) mapped to copy a
 * customer can actually act on. Matched case-insensitively on a normalized
 * substring so small wording drifts upstream don't silently fall through to
 * the generic.
 */
const FRIENDLY_REWRITES: ReadonlyArray<readonly [RegExp, string]> = [
  [/rate limit/i,
    "You've sent a few requests in a row — please wait a minute and try again."],
  [/payload too large|too large/i,
    "That submission was too large. Try removing a few items or images and send it again."],
  [/unknown shop|shop_owner is required/i,
    "This form isn't set up correctly. Please contact the shop directly so they can send you a working link."],
  [/request rejected/i,
    "We couldn't process that submission. Please refresh the page and try again."],
];

/**
 * Convert ANY thrown value / error message into something safe to show a
 * customer. Never returns raw input that we didn't explicitly approve.
 *
 * @param err       the caught error (or a string message)
 * @param fallback  override the generic (must itself be customer-safe copy)
 */
export function toPublicMessage(err: unknown, fallback: string = PUBLIC_FALLBACK): string {
  const raw = typeof err === "string"
    ? err
    : (err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string"
      ? (err as { message: string }).message
      : "");

  if (!raw) return fallback;

  const trimmed = raw.trim();
  if (PUBLIC_SAFE_MESSAGES.has(trimmed)) return trimmed;

  for (const [pattern, friendly] of FRIENDLY_REWRITES) {
    if (pattern.test(trimmed)) return friendly;
  }

  return fallback;
}

/**
 * Minimal styled HTML error page, for endpoints a customer can land on by
 * NAVIGATING (an emailed link, opening an image URL directly) rather than via
 * fetch. A bare `new Response("Not found")` renders as unstyled black text on
 * white — technically not an error code, but it reads as broken.
 *
 * Intentionally self-contained (no external CSS/fonts) and generic: this is
 * served on token failures too, so it must not reveal whether a record exists.
 */
export function publicErrorPage(
  status: number,
  title = "This link isn't available",
  detail = "It may have expired, or the address may be incomplete. Please check with the shop for an up-to-date link.",
): Response {
  const esc = (s: string) => s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!));
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;padding:24px">
<div style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:40px;max-width:420px;text-align:center">
<div style="font-size:40px;line-height:1;margin-bottom:16px">🔗</div>
<h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0f172a">${esc(title)}</h1>
<p style="margin:0;font-size:14px;line-height:1.6;color:#64748b">${esc(detail)}</p>
</div></body></html>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/**
 * True when the request looks like a browser NAVIGATION (address bar, clicked
 * link) rather than a subresource fetch (<img src>, fetch(), XHR). Navigations
 * get the styled HTML page; subresource fetches get a terse body, since no
 * human reads those and an HTML body would just be a broken image either way.
 */
export function isBrowserNavigation(req: Request): boolean {
  // Fetch metadata is the reliable signal in modern browsers; Accept is the
  // fallback for older clients. `navigate` covers top-level page loads.
  const mode = req.headers.get("sec-fetch-mode") || "";
  const dest = req.headers.get("sec-fetch-dest") || "";
  if (mode === "navigate" || dest === "document") return true;
  if (mode || dest) return false; // metadata present and says otherwise
  return (req.headers.get("accept") || "").includes("text/html");
}
