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
  // ~100-day refresh-token expiry. The access token (above) auto-refreshes
  // hourly and is invisible to the shop; THIS is the one whose lapse silently
  // kills the connection, so we track it to warn before it does.
  "qb_refresh_token_expires_at",
  "qb_realm_id",
  "qb_oauth_state",
  "qb_oauth_state_at",
  "gmail_access_token",
  "gmail_refresh_token",
  "gmail_token_expires_at",
  "gmail_oauth_state",
  "ac_email",
  "ac_password",
  "ac_subscription_key",
  // The S&S account number column on `profiles` is `ss_account_number`
  // (verified in production schema). An earlier draft of the profile_secrets
  // migration used the shorter name `ss_account`; the actual data lives in
  // `ss_account_number`, so reads must use that name. If the `profile_secrets`
  // table also has a column under the old name, it's now orphaned.
  "ss_account_number",
  "ss_api_key",
  "stripe_customer_id",
  "stripe_subscription_id",
];

/**
 * Split an update object into the fields that belong on the `profiles`
 * table vs the `profile_secrets` table. Stripe ids (stripe_customer_id,
 * stripe_subscription_id) and all OAuth/credential fields live in
 * profile_secrets now; everything else (subscription_tier,
 * subscription_status, trial_ends_at, …) stays on `profiles`.
 *
 * Why this exists: billingWebhook used to `.from("profiles").update({…})`
 * with stripe_subscription_id mixed in — but those columns were moved to
 * profile_secrets, so the whole update silently matched zero rows and
 * subscriptions never unlocked. Callers must route each half to the
 * correct table; this keeps that split in one tested place.
 */
export function partitionSecretUpdates(updates, secretKeys = SECRET_KEYS) {
  const secretSet = new Set(secretKeys);
  const profileUpdates = {};
  const secretUpdates = {};
  for (const [k, v] of Object.entries(updates || {})) {
    if (secretSet.has(k)) secretUpdates[k] = v;
    else profileUpdates[k] = v;
  }
  return { profileUpdates, secretUpdates };
}

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
 * `connected` reflects whether QB calls will actually WORK — not just whether
 * an access-token string exists. An access token can linger in the DB after
 * the ~100-day refresh token has expired; the next real action would then fail
 * with invalid_grant. So a profile whose refresh token is KNOWN to be expired
 * reports connected=false + needsReconnect=true, letting the UI flip to the
 * reconnect panel instead of a false "Connected" badge.
 *
 * Unknown refresh expiry (older connections not yet repopulated) is treated as
 * healthy — we never falsely disconnect a working shop on missing data.
 */
export function extractConnectionStatus(profile, nowMs = Date.now()) {
  const hasToken = Boolean(profile?.qb_access_token);
  const refreshTokenExpiresAt = profile?.qb_refresh_token_expires_at ?? null;
  let refreshExpired = false;
  if (refreshTokenExpiresAt) {
    const t = new Date(refreshTokenExpiresAt).getTime();
    refreshExpired = Number.isFinite(t) && nowMs > t;
  }
  return {
    connected: hasToken && !refreshExpired,
    // Distinguishes "connection expired, reconnect" from "never connected".
    needsReconnect: hasToken && refreshExpired,
    realmId: profile?.qb_realm_id ?? null,
    expiresAt: profile?.qb_token_expires_at ?? null,
    // The refresh-token expiry the UI uses to warn "reconnect by X".
    refreshTokenExpiresAt,
  };
}

/**
 * Days remaining until the refresh token expires (the connection-killing
 * expiry). Returns null when unknown (older connections made before we
 * tracked it). Used by the UI to decide whether to nudge a reconnect.
 */
export function refreshTokenDaysLeft(refreshExpiresAtIso, nowMs = Date.now()) {
  if (!refreshExpiresAtIso) return null;
  const t = new Date(refreshExpiresAtIso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((t - nowMs) / (24 * 60 * 60 * 1000));
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
export function buildOAuthTokenFields(tokens, realmId, expiresAtIso, refreshExpiresAtIso = null) {
  return {
    qb_access_token:     tokens.access_token,
    qb_refresh_token:    tokens.refresh_token,
    qb_realm_id:         realmId,
    qb_token_expires_at: expiresAtIso,
    // ~100-day refresh-token expiry (from Intuit's x_refresh_token_expires_in).
    // null when the provider didn't send it, so the UI just won't warn.
    qb_refresh_token_expires_at: refreshExpiresAtIso,
    qb_oauth_state:      null, // one-time state cleared after consumption
  };
}

/**
 * Compute the refresh-token expiry ISO string from a raw Intuit token
 * response's `x_refresh_token_expires_in` (seconds). Returns `fallbackIso`
 * (usually the previously-stored value) when the field is absent/invalid, so
 * a refresh that omits it doesn't wipe a known expiry. Exposed + tested.
 */
export function refreshExpiryFromTokens(tokens, nowMs = Date.now(), fallbackIso = null) {
  const secs = Number(tokens?.x_refresh_token_expires_in);
  if (Number.isFinite(secs) && secs > 0) {
    return new Date(nowMs + secs * 1000).toISOString();
  }
  return fallbackIso;
}

/**
 * Build the field object for a token-refresh write. Differs from the OAuth
 * write in that:
 *   - it preserves the previous refresh_token if Intuit doesn't rotate one
 *     (Intuit only rotates refresh tokens occasionally)
 *   - it does NOT touch realmId or oauth_state
 */
export function buildRefreshedTokenFields(freshTokens, previousRefreshToken, nowMs = Date.now(), previousRefreshExpiresAt = null) {
  return {
    qb_access_token:     freshTokens.access_token,
    qb_refresh_token:    freshTokens.refresh_token ?? previousRefreshToken,
    qb_token_expires_at: new Date(nowMs + freshTokens.expires_in * 1000).toISOString(),
    // Intuit returns x_refresh_token_expires_in on refresh too; keep it fresh.
    // Preserve the prior value if this response omits it (don't wipe it).
    qb_refresh_token_expires_at: refreshExpiryFromTokens(freshTokens, nowMs, previousRefreshExpiresAt),
  };
}
