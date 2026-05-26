// Pure validator for the OAuth token-refresh body returned by Intuit's
// `oauth2/v1/tokens/bearer` endpoint. Extracted so qbSync's refresh
// path is testable without spinning up an edge function.
//
// Intuit's 200 OK doesn't guarantee a complete body — malformed responses
// have been observed when their API is under stress. Without this check
// we'd persist `undefined` access_token / refresh_token to profile_secrets
// via updateProfileSecrets, silently locking the shop out of QB on the
// next request (the `!profile?.qb_access_token` gate short-circuits the
// entire flow with "QuickBooks not connected").
//
// Returns either { ok: true } or { ok: false, reason: <short string> }
// so callers can log the specific failure without re-deriving it.

export function validateQbTokenResponse(body) {
  if (!body || typeof body !== "object") {
    return { ok: false, reason: "response is not an object" };
  }
  if (!body.access_token || typeof body.access_token !== "string") {
    return { ok: false, reason: "access_token missing or not a string" };
  }
  if (!body.refresh_token || typeof body.refresh_token !== "string") {
    return { ok: false, reason: "refresh_token missing or not a string" };
  }
  if (typeof body.expires_in !== "number" || body.expires_in <= 0) {
    return { ok: false, reason: "expires_in missing or not a positive number" };
  }
  return { ok: true };
}
