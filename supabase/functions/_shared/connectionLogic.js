// Pure logic for QuickBooks connection state. No I/O, no globals — everything
// here is testable from Vitest (Node) AND callable from the Deno edge
// functions. The edge functions wrap these in DB calls.
//
// If you change the behavior of any of these, the corresponding test in
// __tests__/connectionLogic.test.js MUST be updated. The tests are the
// canonical contract.

/** Set of secret column names that live on `profile_secrets` (new home)
 *  AND `profiles` (legacy). Order doesn't matter; presence does. */
export const SECRET_KEYS = [
  "qb_access_token",
  "qb_refresh_token",
  "qb_token_expires_at",
  "qb_realm_id",
  "qb_oauth_state",
  "gmail_access_token",
  "gmail_refresh_token",
  "gmail_token_expires_at",
  "gmail_oauth_state",
  "ac_password",
  "ac_subscription_key",
  "ss_account",
  "ss_api_key",
  "shopify_access_token",
  "stripe_customer_id",
  "stripe_subscription_id",
];

/**
 * Merge a `profiles` row with a `profile_secrets` row.
 *
 * Precedence: `secrets` wins per-key when present (non-null/undefined),
 * otherwise the value from `profile` is kept. Unknown keys on either input
 * are passed through from `profile` only.
 *
 * Why this matters: during the migration from profile columns → profile_secrets
 * table, both can coexist. If a writer updates one but not the other, reads
 * must still return the current value.
 */
export function mergeProfileSecrets(profile, secrets, secretKeys = SECRET_KEYS) {
  if (!profile) return null;
  const merged = { ...profile };
  if (!secrets) return merged;
  for (const k of secretKeys) {
    const v = secrets[k];
    if (v !== undefined && v !== null) merged[k] = v;
  }
  return merged;
}

/**
 * Decide whether an access token needs to be refreshed.
 *
 * Refreshes `leadMs` ms early so the token isn't on the verge of expiring
 * mid-call. Returns `true` if the token is expired, missing, or unparseable.
 */
export function decideTokenRefresh(expiresAtIso, nowMs = Date.now(), leadMs = 5 * 60 * 1000) {
  if (!expiresAtIso) return true;
  const t = new Date(expiresAtIso).getTime();
  if (!Number.isFinite(t)) return true;
  return nowMs > t - leadMs;
}

/**
 * Shape returned by the `checkConnection` edge function action.
 *
 * `connected` is true iff the profile has a non-empty access token. Realm
 * and expiry are surfaced so the UI can show "expires in N minutes" hints
 * without a second round-trip.
 */
export function extractConnectionStatus(profile) {
  return {
    connected: Boolean(profile?.qb_access_token),
    realmId: profile?.qb_realm_id ?? null,
    expiresAt: profile?.qb_token_expires_at ?? null,
  };
}

/**
 * Build the field object that should be written to the profile after a
 * successful OAuth callback. `tokens` is the raw Intuit token response
 * (`{ access_token, refresh_token, expires_in, ... }`). `expiresAtIso` is
 * usually `new Date(Date.now() + tokens.expires_in * 1000).toISOString()`.
 *
 * The same shape goes to BOTH `profiles` (legacy primary) and
 * `profile_secrets` (new RLS-locked home) — that's the dual-write contract.
 */
export function buildOAuthTokenFields(tokens, realmId, expiresAtIso) {
  return {
    qb_access_token:     tokens.access_token,
    qb_refresh_token:    tokens.refresh_token,
    qb_realm_id:         realmId,
    qb_token_expires_at: expiresAtIso,
    qb_oauth_state:      null, // one-time state cleared after consumption
  };
}

/**
 * Build the field object for a token-refresh write. Differs from the OAuth
 * write in that:
 *   - it preserves the previous refresh_token if Intuit doesn't rotate one
 *     (Intuit only rotates refresh tokens occasionally)
 *   - it does NOT touch realmId or oauth_state
 */
export function buildRefreshedTokenFields(freshTokens, previousRefreshToken, nowMs = Date.now()) {
  return {
    qb_access_token:     freshTokens.access_token,
    qb_refresh_token:    freshTokens.refresh_token ?? previousRefreshToken,
    qb_token_expires_at: new Date(nowMs + freshTokens.expires_in * 1000).toISOString(),
  };
}
