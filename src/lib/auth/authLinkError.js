// Turn a Supabase auth-redirect error hash into something a shop owner can act on.
//
// When a sign-in link, invite, or password-reset link fails, Supabase bounces
// the browser back to the redirect URL with the failure in the URL FRAGMENT:
//
//   /#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired
//
// Nothing read that on the sign-in screen, so the user landed on a normal
// login form with no idea why they weren't signed in — they'd just tried the
// link and, from their side, nothing happened. (Truman, 2026-08-25: three
// consecutive "Email link is invalid or has expired" verifications before
// falling back to a password reset.)
//
// The single most common cause is NOT the user being slow. Magic links are
// one-time tokens, and corporate/consumer mail scanners routinely PREFETCH
// links to check them for malware — which consumes the token before the human
// ever taps it. Requesting several links also invalidates all but the newest.
// So the copy must never imply the user did something wrong, and must always
// offer the one-click way out: send a fresh link.

/** Human copy per Supabase error_code. Keep every message actionable. */
const MESSAGES = {
  otp_expired:
    "That sign-in link has already been used or has expired. Links work once, and some email apps open them automatically to scan for viruses — which uses the link up. Send yourself a fresh one below.",
  access_denied:
    "That sign-in link couldn't be used. It may have expired or already been opened. Send yourself a fresh one below.",
  email_link_invalid:
    "That sign-in link isn't valid anymore. Send yourself a fresh one below.",
  // Not a link failure — the account genuinely isn't confirmed yet.
  email_not_confirmed:
    "This email hasn't been confirmed yet. Send yourself a sign-in link below to finish setting up.",
};

const FALLBACK =
  "That link didn't work. Send yourself a fresh sign-in link below.";

/**
 * Parse an auth error out of a URL hash (or query string).
 *
 * @param {string} hashOrSearch  e.g. "#error=access_denied&error_code=otp_expired"
 * @returns {{code: string, message: string, raw: string|null}|null}
 *          null when there's no auth error present — callers must treat null
 *          as "nothing to show", never as "unknown error".
 */
export function parseAuthLinkError(hashOrSearch) {
  if (!hashOrSearch || typeof hashOrSearch !== "string") return null;

  const cleaned = hashOrSearch.replace(/^[#?]/, "");
  if (!cleaned) return null;

  let params;
  try {
    params = new URLSearchParams(cleaned);
  } catch {
    return null;
  }

  const error = params.get("error");
  const code = params.get("error_code");
  // Require an actual error marker. A hash carrying access_token (the SUCCESS
  // case) must never be read as a failure.
  if (!error && !code) return null;

  const key = code || error;
  return {
    code: key,
    message: MESSAGES[key] || FALLBACK,
    // Supabase's own wording, kept for logs — never shown to the user.
    raw: params.get("error_description"),
  };
}

/**
 * Does this hash represent a SUCCESSFUL auth redirect (tokens present)?
 * Used to make sure we never clear or misread a good callback.
 */
export function isAuthSuccessHash(hash) {
  if (!hash || typeof hash !== "string") return false;
  const cleaned = hash.replace(/^[#?]/, "");
  if (!cleaned) return false;
  try {
    const p = new URLSearchParams(cleaned);
    return !!(p.get("access_token") || p.get("refresh_token"));
  } catch {
    return false;
  }
}
