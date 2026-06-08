// Multi-factor authentication helpers.
//
// Thin wrapper around the three SECURITY DEFINER RPCs added in
// migration 20260622000000_mfa_phase1_backend.sql, plus a couple of
// read helpers that exercise the RLS-protected SELECT path on the
// underlying tables.
//
// Phase 2-5 UI surfaces (Account → Security, sign-in challenge,
// recovery flow, dashboard nudge banner) all consume this module —
// the React layer should never hit `supabase.rpc("...")` directly so
// the contract is enforced in one place.
//
// TOTP enrollment / challenge / verify uses Supabase Auth's native
// `supabase.auth.mfa.*` API directly from the React layer. We don't
// re-wrap those here — they're already idiomatic and well-typed in
// the Supabase SDK.

import { supabase } from "@/api/supabaseClient";

/**
 * Generate (or regenerate) 10 single-use recovery codes for the
 * currently-authenticated user. WIPES any existing codes — UI should
 * surface a "this will invalidate your current codes" confirm before
 * calling on regenerate.
 *
 * Returns the plaintext codes ONCE. They are not stored or logged
 * anywhere else; if the caller doesn't surface them to the user
 * immediately, they're gone.
 *
 * @returns {Promise<{ ok: true, codes: string[] } | { ok: false, error: string }>}
 */
export async function generateRecoveryCodes() {
  const { data, error } = await supabase.rpc("generate_mfa_recovery_codes");
  if (error) return { ok: false, error: error.message };
  if (!data || data.status !== "ok") {
    return { ok: false, error: data?.message || data?.status || "unknown_error" };
  }
  return { ok: true, codes: data.codes || [] };
}

/**
 * Validate a plaintext recovery code against the caller's stored
 * hashes. On success, the code is marked consumed and cannot be
 * reused. On failure (no match, already-consumed, malformed), returns
 * `invalid` — the RPC intentionally returns the same shape and timing
 * for all failure cases to minimize timing-oracle leaks.
 *
 * Caller is responsible for the lockout policy (count failed attempts
 * client-side, route to lockout state after N) — this RPC just answers
 * "was the code valid this time."
 *
 * @param {string} code  Plaintext code; case + separator tolerant.
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function consumeRecoveryCode(code) {
  const { data, error } = await supabase.rpc("consume_mfa_recovery_code", {
    p_code: code,
  });
  if (error) return { ok: false, error: error.message };
  if (!data || data.status !== "consumed") {
    return { ok: false, error: data?.status || "invalid" };
  }
  return { ok: true };
}

/**
 * Record an MFA event in the audit log. Used by Phase 2-4 UI to
 * capture state transitions the RPCs above don't already write:
 *   - 'enrolled'              after the user verifies the TOTP code at enrollment
 *   - 'disabled'              after the user turns off MFA
 *   - 'challenge_succeeded'   after a successful 6-digit code at sign-in
 *   - 'challenge_failed'      after a failed 6-digit code at sign-in
 *   - 'lockout'               when failed attempts cross the threshold
 *   - 'session_invalidated'   when enabling MFA forces other devices out
 *
 * `recovery_used`, `recovery_failed`, and `codes_generated` are
 * already written inside the RPCs — do not double-log them from the
 * client.
 *
 * @param {string} event       One of the allow-list values above.
 * @param {object} [opts]
 * @param {string} [opts.ipAddress]  Client-passed; not authoritative.
 * @param {string} [opts.userAgent]  Client-passed; not authoritative.
 * @param {object} [opts.metadata]   Per-event JSON details.
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function logMfaEvent(event, opts = {}) {
  const { data, error } = await supabase.rpc("log_mfa_event", {
    p_event:      event,
    p_ip_address: opts.ipAddress ?? null,
    p_user_agent: opts.userAgent ?? null,
    p_metadata:   opts.metadata ?? null,
  });
  if (error) return { ok: false, error: error.message };
  if (!data || data.status !== "ok") {
    return { ok: false, error: data?.status || "unknown_error" };
  }
  return { ok: true };
}

/**
 * Count the unused recovery codes for the current user. Used by the
 * Account → Security UI to show "X recovery codes left" and prompt
 * regeneration when the count gets low (≤2 is a sensible threshold).
 *
 * Goes through the RLS-protected SELECT — the user can only ever see
 * their own count, so even a malicious caller can't enumerate.
 *
 * @returns {Promise<{ ok: true, count: number } | { ok: false, error: string }>}
 */
export async function countUnusedRecoveryCodes() {
  const { count, error } = await supabase
    .from("mfa_recovery_codes")
    .select("*", { count: "exact", head: true })
    .is("consumed_at", null);
  if (error) return { ok: false, error: error.message };
  return { ok: true, count: count ?? 0 };
}

/**
 * Pull the caller's recent MFA audit-log rows, newest first. Powers
 * the "Recent activity" section on Account → Security.
 *
 * @param {number} [limit=20]
 * @returns {Promise<{ ok: true, events: Array<{ event: string, ip_address: string|null, user_agent: string|null, metadata: object|null, created_at: string }> } | { ok: false, error: string }>}
 */
export async function listMfaAuditEvents(limit = 20) {
  const { data, error } = await supabase
    .from("mfa_audit_log")
    .select("event, ip_address, user_agent, metadata, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return { ok: false, error: error.message };
  return { ok: true, events: data ?? [] };
}
