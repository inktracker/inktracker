// User-facing messages for the OAuth callback's error codes.
//
// qbOAuthCallback redirects to /Account?qb_error=<code> on failure
// (or /BrokerDashboard?... for broker roles). The callback's code
// vocabulary is small and stable — this helper centralizes the copy
// so the shop UI and broker UI never drift apart on error wording.
//
// Codes the callback can emit (kept in sync with qbOAuthCallback/index.ts):
//   state_mismatch          — state value not found in profile_secrets
//   state_expired           — state older than 30 minutes (#340)
//   missing_params          — Intuit redirect lacked code/state/realmId
//   token_exchange_failed   — Intuit's /tokens/bearer returned non-2xx
//   malformed_token_response — Intuit returned 2xx but the body shape was wrong
//   storage_failed          — DB write failed after successful exchange
//   server_error            — unexpected exception
//   <any other code>        — fallback raw render
//
// All copy points the user at the next thing to do, even when the
// underlying cause is opaque ("try again" is the answer for most
// transient failures; "contact support" is the answer when retry
// can't help).

const MESSAGES = {
  state_mismatch:
    "Connection failed — the request couldn't be matched to your account. Please click Connect QuickBooks again.",
  state_expired:
    "Your connection request took too long. Please click Connect QuickBooks again — the consent flow needs to finish within 30 minutes.",
  missing_params:
    "QuickBooks did not return the expected data. Please try connecting again.",
  invalid_realm_id:
    "QuickBooks returned an unexpected company ID. Please try connecting again — if it keeps happening, contact support.",
  token_exchange_failed:
    "Could not connect to QuickBooks. Please try again — if the issue persists, contact support.",
  malformed_token_response:
    "QuickBooks returned an unexpected response. Please try again — if the issue persists, contact support.",
  storage_failed:
    "Connected to QuickBooks but could not save the connection. Please try again.",
  server_error:
    "Something went wrong. Please try again.",
};

/**
 * Resolve a callback error code to user-facing copy. Falls back to a
 * generic "Connection failed: <code>" line for any unknown code so
 * the user at least sees something other than the raw URL parameter.
 *
 * @param {string|null|undefined} code  The qb_error URL parameter value.
 * @returns {string}
 */
export function qbOAuthErrorMessage(code) {
  if (!code) return "";
  if (Object.prototype.hasOwnProperty.call(MESSAGES, code)) {
    return MESSAGES[code];
  }
  return `Connection failed: ${code}`;
}
