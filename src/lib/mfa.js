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

// ── Trusted device (Phase 3b) ──────────────────────────────────────
// "Remember this browser for 30 days." The plaintext token never
// leaves the device; we send it to the server only to hash + compare.

/**
 * localStorage key for the per-device trust token. The token is an
 * opaque random UUID generated client-side; the server only ever
 * sees its SHA-256 hash.
 */
export const TRUSTED_DEVICE_STORAGE_KEY = "inktracker_mfa_trusted_device_token";

/**
 * Read the plaintext token from localStorage, if any. Returns null
 * outside the browser (during tests / SSR / hostile environments).
 *
 * @returns {string | null}
 */
export function getLocalTrustedDeviceToken() {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(TRUSTED_DEVICE_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

/**
 * Mint a fresh per-device token, store it in localStorage, register
 * the hash with the server, and return the row id (so the caller can
 * surface it for later revocation).
 *
 * If anything fails between generation and persistence, clean up the
 * localStorage write so the device isn't left with a stale token the
 * server doesn't know about.
 *
 * @param {string} [deviceLabel]
 * @returns {Promise<{ ok: true, id: string } | { ok: false, error: string }>}
 */
export async function registerTrustedDevice(deviceLabel) {
  let token = null;
  try {
    if (typeof crypto === "undefined" || !crypto.randomUUID) {
      return { ok: false, error: "crypto.randomUUID unavailable" };
    }
    token = crypto.randomUUID();
    try {
      localStorage.setItem(TRUSTED_DEVICE_STORAGE_KEY, token);
    } catch {
      return { ok: false, error: "localStorage unavailable" };
    }
    const { data, error } = await supabase.rpc("register_mfa_trusted_device", {
      p_token: token,
      p_device_label: deviceLabel ?? null,
    });
    if (error) {
      try { localStorage.removeItem(TRUSTED_DEVICE_STORAGE_KEY); } catch { /* ignore */ }
      return { ok: false, error: error.message };
    }
    if (!data || data.status !== "ok") {
      try { localStorage.removeItem(TRUSTED_DEVICE_STORAGE_KEY); } catch { /* ignore */ }
      return { ok: false, error: data?.status || "unknown_error" };
    }
    return { ok: true, id: data.id };
  } catch (e) {
    try { localStorage.removeItem(TRUSTED_DEVICE_STORAGE_KEY); } catch { /* ignore */ }
    return { ok: false, error: e?.message || "unknown_error" };
  }
}

/**
 * Ask the server whether the currently-stored localStorage token
 * matches an unexpired trusted-device row for the authenticated user.
 *
 * `ok: true, trusted: true`  → caller can skip the MFA challenge.
 * `ok: true, trusted: false` → no match (no token, expired, revoked);
 *                              caller must run the challenge as usual.
 *
 * Stale local tokens (expired or revoked server-side) get dropped on
 * the way out so we don't keep re-sending dead values.
 *
 * @returns {Promise<{ ok: true, trusted: boolean } | { ok: false, error: string }>}
 */
export async function checkLocalTrustedDevice() {
  const token = getLocalTrustedDeviceToken();
  if (!token) return { ok: true, trusted: false };
  const { data, error } = await supabase.rpc("check_mfa_trusted_device", {
    p_token: token,
  });
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "no_response" };
  if (data.trusted === true) return { ok: true, trusted: true };
  try { localStorage.removeItem(TRUSTED_DEVICE_STORAGE_KEY); } catch { /* ignore */ }
  return { ok: true, trusted: false };
}

/**
 * List the caller's trusted devices (newest first). Reads the table
 * directly through RLS — Account → Security will use this in Phase 4.
 *
 * @returns {Promise<{ ok: true, devices: Array } | { ok: false, error: string }>}
 */
export async function listTrustedDevices() {
  const { data, error } = await supabase
    .from("mfa_trusted_devices")
    .select("id, device_label, last_used_at, expires_at, created_at")
    .order("created_at", { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, devices: data ?? [] };
}

/**
 * Revoke a specific trusted device by id.
 *
 * @param {string} id
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function revokeTrustedDevice(id) {
  const { data, error } = await supabase.rpc("revoke_mfa_trusted_device", { p_id: id });
  if (error) return { ok: false, error: error.message };
  if (!data || data.status !== "ok") {
    return { ok: false, error: data?.status || "unknown_error" };
  }
  return { ok: true };
}

/**
 * Revoke every trusted device for the caller. Drops the local token
 * too so the current browser is no longer trusted either.
 *
 * @returns {Promise<{ ok: true, count: number } | { ok: false, error: string }>}
 */
export async function revokeAllTrustedDevices() {
  const { data, error } = await supabase.rpc("revoke_all_mfa_trusted_devices");
  if (error) return { ok: false, error: error.message };
  if (!data || data.status !== "ok") {
    return { ok: false, error: data?.status || "unknown_error" };
  }
  try { localStorage.removeItem(TRUSTED_DEVICE_STORAGE_KEY); } catch { /* ignore */ }
  return { ok: true, count: Number(data.count) || 0 };
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
