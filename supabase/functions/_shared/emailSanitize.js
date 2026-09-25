// HTML-escape user-controlled strings before they're embedded in an outbound
// email body (audit INT-04). Escapes ALL FIVE HTML-significant characters,
// including quotes, so a value is safe in BOTH element-content and attribute
// contexts — sendQuoteEmail's custom body previously escaped only &<> (not
// quotes), which is fine in element content but a latent XSS hole the moment
// the value moves into an attribute or the template changes.
//
// Pure + unit-tested (__tests__/emailSanitize.test.js) so the edge functions
// share one correct escaper instead of hand-rolled per-function variants.

const HTML_ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

// Sanitize a multi-line custom message for an email body: fully escape it,
// THEN turn newlines into <br>. Escaping runs first so the user's text can
// never inject markup; the <br> we add afterward is our own literal HTML.
export function sanitizeEmailBody(body) {
  if (!body) return "";
  return escapeHtml(body).replace(/\n/g, "<br>");
}

// Resolve a value that SHOULD be an email address into a bare, valid one —
// or null. Broker-portal quotes carry the `broker:<email>` tenancy sentinel
// in shop_owner (pre-submission there is no shop yet); that sentinel reached
// Resend's bcc verbatim and 422'd the ENTIRE send, so the broker's customer
// never got the quote (Ethan → 2026-09-25). Every send path must pass owner-
// ish values through here before putting them in from/to/bcc/reply_to.
const EMAIL_RE = /^[^\s@:;,<>]+@[^\s@:;,<>]+\.[^\s@:;,<>]+$/;
export function asBareEmail(value) {
  const v = String(value ?? "").trim().replace(/^broker:/i, "");
  return EMAIL_RE.test(v) ? v : null;
}
