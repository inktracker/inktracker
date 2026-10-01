// Email format guard shared across forms that accept email input.
//
// Same minimal regex as the QB sync's _shared/qbInvoice.js isLikelyEmail —
// intentionally lax (something@something.something). Goal is "definitely
// not an email" rejection, not full RFC 822 validation. False positives
// like "a@b.c" still get through — those will be rejected at the QB
// API layer if they reach it, or never matter if the email stays
// internal.
//
// Why duplicate the QB lib's helper instead of importing: the QB version
// lives in supabase/functions/_shared/ (Deno), and this version lives
// in src/lib/ (browser via Vite). Keep them in sync if either changes.

export function isValidEmail(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return /^\S+@\S+\.\S+$/.test(trimmed);
}

// Delivery guard for sendQuoteEmail-style edge responses. The function
// reports a DELIVERY failure as HTTP 200 with { sent: false, results } —
// never an `error` field — so a caller that only checks invoke error +
// res.error treats "Resend rejected every recipient" as success. That
// exact gap marked quotes "Sent" while the customer got NOTHING
// (Ethan → Resend 422, 2026-09-25), and the invoice modal re-grew it
// (audit 2026-09-30). Every send surface must call this BEFORE flipping
// status / logging the outbound message. Throws with the failed
// recipients + reason; no-op when the send genuinely went out.
export function assertEmailDelivered(res, label = "email") {
  if (res && res.sent === false) {
    const failed = (res.results || []).filter((r) => !r.ok);
    const who = failed.map((r) => r.to).join(", ");
    const why = failed[0]?.reason ? ` (${failed[0].reason})` : "";
    throw new Error(
      `The ${label} couldn't be delivered${who ? ` to ${who}` : ""}${why}. Nothing was marked sent — please try again.`,
    );
  }
}
