// Helpers for reading/writing profile_secrets — a separate table from
// `profiles` that holds OAuth tokens and supplier credentials. Service-role
// only; never exposed to authenticated/anon clients.
//
// During the migration window, edge functions read from BOTH locations:
// preferring profile_secrets (the new home) and falling back to the old
// columns on `profiles`. Writes go to profile_secrets only. After all edge
// functions have been updated and verified, a follow-up migration will drop
// the old columns.

// deno-lint-ignore-file no-explicit-any

import { mergeProfileSecrets, SECRET_KEYS as SHARED_SECRET_KEYS } from "./connectionLogic.js";

export type ProfileWithSecrets = {
  // Mirrors profiles columns we commonly need.
  id: string;
  auth_id: string;
  email: string;
  shop_owner?: string | null;
  default_tax_rate?: number | null;
  // ...all the secret fields, merged from profile_secrets (preferred) or profiles (fallback).
  qb_access_token?: string | null;
  qb_refresh_token?: string | null;
  qb_token_expires_at?: string | null;
  qb_refresh_token_expires_at?: string | null;
  qb_token_refresh_lock?: string | null;
  qb_realm_id?: string | null;
  qb_oauth_state?: string | null;
  gmail_access_token?: string | null;
  gmail_refresh_token?: string | null;
  gmail_token_expires_at?: string | null;
  gmail_oauth_state?: string | null;
  ac_password?: string | null;
  ac_subscription_key?: string | null;
  ss_account_number?: string | null;
  ss_api_key?: string | null;
  sanmar_customer_number?: string | null;
  sanmar_username?: string | null;
  sanmar_password?: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  // Anything else returned by the profiles SELECT
  [key: string]: any;
};

const SECRET_KEYS = SHARED_SECRET_KEYS as readonly string[];

type SecretKey = string;

/**
 * Loads a profile and merges secrets from profile_secrets (preferred) or
 * falls back to the old columns on profiles. Use this anywhere an edge
 * function previously did `from('profiles').select('*').eq(...).single()`
 * and needed token fields.
 */
export async function loadProfileWithSecrets(
  admin: any,
  match: { auth_id?: string; email?: string; id?: string },
): Promise<ProfileWithSecrets | null> {
  let query = admin.from("profiles").select("*");
  if (match.auth_id) query = query.eq("auth_id", match.auth_id);
  else if (match.id) query = query.eq("id", match.id);
  else if (match.email) query = query.eq("email", match.email);
  else return null;

  const { data: profile, error } = await query.maybeSingle();
  if (error || !profile) return null;

  // Try the new table first.
  const { data: secrets } = await admin
    .from("profile_secrets")
    .select("*")
    .eq("profile_id", profile.id)
    .maybeSingle();

  // Merge: secrets (new) wins; fall back to profiles columns (old).
  // Pure logic + tests: ../_shared/connectionLogic.js + __tests__.
  return mergeProfileSecrets(profile, secrets, [...SECRET_KEYS]) as ProfileWithSecrets;
}

/**
 * Loads the **shop owner's** profile + secrets for a signed-in user.
 *
 * For shop owners / managers / employees, this is just their own profile.
 * For brokers (role === "broker"), the broker's own profile has no supplier
 * credentials — the relevant creds live on the assigned shop's profile. We
 * resolve the assigned shop via `profile.assigned_shops[0]` (the email of
 * the shop they're working under) and load THAT profile instead.
 *
 * Use this in any edge function that needs supplier creds (QB, AS Colour,
 * S&S, Shopify, Gmail), not just user-scoped lookups.
 *
 * Returns `{ profile, isBroker, brokerEmail }` so callers can stamp broker
 * context onto created records without re-querying.
 */
export async function loadShopProfileForUser(
  admin: any,
  authUserId: string,
): Promise<{
  profile: ProfileWithSecrets | null;
  isBroker: boolean;
  brokerEmail: string | null;
  brokerProfile: ProfileWithSecrets | null;
}> {
  const userProfile = await loadProfileWithSecrets(admin, { auth_id: authUserId });
  if (!userProfile) return { profile: null, isBroker: false, brokerEmail: null, brokerProfile: null };

  const role = (userProfile as any).role;
  const isBroker = role === "broker";
  if (!isBroker) {
    return { profile: userProfile, isBroker: false, brokerEmail: null, brokerProfile: null };
  }

  const assignedShops = Array.isArray((userProfile as any).assigned_shops)
    ? (userProfile as any).assigned_shops
    : [];
  const shopEmail = assignedShops[0];
  if (!shopEmail) {
    // Broker with no assigned shops — return the broker's profile so the caller
    // can produce a clear error rather than silently swapping to env defaults.
    return {
      profile: userProfile,
      isBroker: true,
      brokerEmail: userProfile.email,
      brokerProfile: userProfile,
    };
  }

  const shopProfile = await loadProfileWithSecrets(admin, { email: shopEmail });
  if (!shopProfile) {
    return {
      profile: userProfile,
      isBroker: true,
      brokerEmail: userProfile.email,
      brokerProfile: userProfile,
    };
  }
  return {
    profile: shopProfile,
    isBroker: true,
    brokerEmail: userProfile.email,
    brokerProfile: userProfile,
  };
}

/**
 * Updates secret fields. Writes to profile_secrets (upsert).
 *
 * `dualWrite` defaults to `false` now that the legacy secret columns
 * have been dropped from `profiles` (migration
 * 20260520_drop_legacy_profile_secret_columns). Existing callers that
 * still pass `{ dualWrite: true }` will log a non-fatal warning when
 * the profiles update hits the dropped columns; harmless but noisy.
 * Drop the `dualWrite: true` arg in those callers at your convenience.
 */
export async function updateProfileSecrets(
  admin: any,
  profileId: string,
  updates: Partial<Record<SecretKey, string | null>>,
  opts: { dualWrite?: boolean } = { dualWrite: false },
): Promise<void> {
  const filtered: Record<string, any> = {};
  for (const [k, v] of Object.entries(updates)) {
    if ((SECRET_KEYS as readonly string[]).includes(k)) filtered[k] = v;
  }
  if (Object.keys(filtered).length === 0) return;

  // Upsert into profile_secrets.
  const { error: upsertErr } = await admin
    .from("profile_secrets")
    .upsert(
      { profile_id: profileId, ...filtered, updated_at: new Date().toISOString() },
      { onConflict: "profile_id" },
    );
  if (upsertErr) {
    console.error("[profileSecrets] upsert failed:", upsertErr.message);
    throw upsertErr;
  }

  // Dual-write: keep the old columns in sync until they're dropped.
  if (opts.dualWrite) {
    const { error: profileErr } = await admin
      .from("profiles")
      .update(filtered)
      .eq("id", profileId);
    if (profileErr) {
      // Non-fatal — primary write to secrets succeeded. Old columns will go
      // stale, but that's expected during migration.
      console.warn("[profileSecrets] dual-write to profiles failed (non-fatal):", profileErr.message);
    }
  }
}
