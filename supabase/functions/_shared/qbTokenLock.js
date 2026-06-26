// Serialize QuickBooks token refreshes across concurrent edge invocations.
//
// QB rotates refresh tokens — each refresh invalidates the previous one. Two
// requests that both cross the ~5-min refresh window at once would each POST
// the same refresh token to Intuit; one of the rotated results gets clobbered
// and the next QB call fails with invalid_grant. This is the intermittent
// "QuickBooks randomly disconnected" bug.
//
// Fix: a DB lease lock on profile_secrets.qb_token_refresh_lock. A refresher
// atomically claims it with a conditional UPDATE; Postgres serializes those via
// row locks, so only ONE refresh runs at a time. Losers wait briefly and reuse
// the winner's freshly-persisted token instead of refreshing again.
//
// Kept dependency-injected (no Deno / supabase-js imports beyond the passed
// `admin` query builder) so it's unit-testable with plain mocks.

const LOCK_TTL_MS = 30_000;        // stale-lease reclaim (crashed refresher)
const POLL_MS = 1200;              // wait between contended retries
const MAX_CONTENDED_WAITS = 5;     // ~6s before the last-resort unlocked refresh

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Atomically claim the refresh lease. Returns true iff this caller won it.
// The `.or(...)` means "claim only if free or the prior lease is stale"; the
// conditional UPDATE is serialized by Postgres row locks, so exactly one of N
// concurrent callers updates a row (and thus gets data.length === 1).
export async function claimRefreshLease(admin, profileId, nowMs = Date.now()) {
  const nowIso = new Date(nowMs).toISOString();
  const staleBefore = new Date(nowMs - LOCK_TTL_MS).toISOString();
  const { data, error } = await admin
    .from("profile_secrets")
    .update({ qb_token_refresh_lock: nowIso })
    .eq("profile_id", profileId)
    .or(`qb_token_refresh_lock.is.null,qb_token_refresh_lock.lt.${staleBefore}`)
    .select("profile_id");
  if (error) return false; // on error, don't claim — caller falls back to unlocked refresh
  return Array.isArray(data) && data.length > 0;
}

export async function releaseRefreshLease(admin, profileId) {
  try {
    await admin.from("profile_secrets").update({ qb_token_refresh_lock: null }).eq("profile_id", profileId);
  } catch { /* best-effort — the stale-reclaim TTL covers a missed release */ }
}

/**
 * Return a valid QB access token for `profile`, refreshing under the lease when
 * needed. Deps (all injected for testability):
 *   decideRefresh — (expiresAtIso) => bool           connectionLogic.decideTokenRefresh
 *   refreshFn     — (refreshToken) => raw token resp  function that POSTs to Intuit
 *   buildFields   — (fresh, prevRefresh, nowMs, prevRefreshExp) => fields to persist
 *   persist       — (profileId, fields) => Promise    updateProfileSecrets
 *   reload        — (profileId) => Promise<profile>   loadProfileWithSecrets by id
 *   sleepFn/nowFn — overridable clock/sleep for tests
 * Returns { accessToken, realmId }.
 */
export async function refreshQbTokenSerialized(admin, profile, deps) {
  const {
    decideRefresh, refreshFn, buildFields, persist, reload,
    sleepFn = defaultSleep, nowFn = Date.now,
  } = deps;

  if (!decideRefresh(profile.qb_token_expires_at)) {
    return { accessToken: profile.qb_access_token, realmId: profile.qb_realm_id };
  }

  let current = profile;
  for (let i = 0; i < MAX_CONTENDED_WAITS; i++) {
    if (await claimRefreshLease(admin, current.id, nowFn())) {
      try {
        const fresh = await refreshFn(current.qb_refresh_token);
        const fields = buildFields(fresh, current.qb_refresh_token, nowFn(), current.qb_refresh_token_expires_at);
        // Clear the lease in the SAME write that persists the rotated tokens.
        await persist(current.id, { ...fields, qb_token_refresh_lock: null });
        return { accessToken: fresh.access_token, realmId: current.qb_realm_id };
      } catch (err) {
        await releaseRefreshLease(admin, current.id);
        throw err;
      }
    }

    // Contended — another invocation holds the lease. Wait, re-read, and if it
    // already refreshed, reuse its token instead of refreshing again.
    await sleepFn(POLL_MS);
    const reloaded = await reload(current.id);
    if (reloaded) current = reloaded;
    if (current.qb_access_token && !decideRefresh(current.qb_token_expires_at)) {
      return { accessToken: current.qb_access_token, realmId: current.qb_realm_id };
    }
  }

  // Exhausted the wait budget and the token is still stale (e.g. the lease
  // holder is genuinely slow). Last resort: refresh without the lease rather
  // than hard-failing the user's action. Worst case is one redundant refresh.
  const fresh = await refreshFn(current.qb_refresh_token);
  const fields = buildFields(fresh, current.qb_refresh_token, nowFn(), current.qb_refresh_token_expires_at);
  await persist(current.id, { ...fields, qb_token_refresh_lock: null });
  return { accessToken: fresh.access_token, realmId: current.qb_realm_id };
}
