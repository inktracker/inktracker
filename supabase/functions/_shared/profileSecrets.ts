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
  qb_realm_id?: string | null;
  qb_oauth_state?: string | null;
  gmail_access_token?: string | null;
  gmail_refresh_token?: string | null;
  gmail_token_expires_at?: string | null;
  gmail_oauth_state?: string | null;
  ac_password?: string | null;
  ac_subscription_key?: string | null;
  ss_account?: string | null;
  ss_api_key?: string | null;
  shopify_access_token?: string | null;
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
  return mergeProfileSecrets(profile, secrets, SECRET_KEYS) as ProfileWithSecrets;
}

/**
 * Updates secret fields. Writes to profile_secrets (upsert). Optionally
 * dual-writes to the old profiles columns during the migration window so
 * frontend code that hasn't been updated still sees current values.
 */
export async function updateProfileSecrets(
  admin: any,
  profileId: string,
  updates: Partial<Record<SecretKey, string | null>>,
  opts: { dualWrite?: boolean } = { dualWrite: true },
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
