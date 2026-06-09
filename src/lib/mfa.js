// MFA wrapper — email-based 6-digit sign-in codes.
//
// The product moved off TOTP / authenticator apps on 2026-06-08 because
// print shop owners aren't going to install an authenticator. Email
// codes are the SMB-SaaS standard, no app required, and the threat
// surface is the same as the password-reset flow.
//
// What lives here:
//   - is/enable/disableMfaEmail — read / flip the per-user flag on the
//     profile (single source of truth)
//   - requestSignInCode — calls the sendMfaSignInCode edge function to
//     mint a code + email it; rate-limited 60s per user
//   - verifySignInCode — checks the 6-digit code via RPC
//   - logMfaEvent / listMfaAuditEvents — audit log surface; same
//     wrapper functions used by SecuritySection's recent-activity feed
//   - trusted device helpers — unchanged from Phase 3b; still used to
//     let known browsers skip the code prompt for 30 days
//
// The UI never calls supabase.rpc / supabase.functions.invoke directly;
// it goes through this module so the RPC contract is enforced in one
// place.

import { supabase } from "@/api/supabaseClient";

/**
 * Read the caller's profiles.mfa_email_enabled flag. The flag is the
 * single source of truth for "does this user need a code at sign-in."
 *
 * @returns {Promise<{ ok: true, enabled: boolean } | { ok: false, error: string }>}
 */
export async function isMfaEmailEnabled() {
  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr) return { ok: false, error: userErr.message };
  if (!user) return { ok: true, enabled: false };
  const { data, error } = await supabase
    .from("profiles")
    .select("mfa_email_enabled")
    .eq("auth_id", user.id)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, enabled: !!data?.mfa_email_enabled };
}

/**
 * Look up another user's mfa_email_enabled WITHOUT requiring an
 * authenticated session — used at sign-in time after password verify,
 * since the user's session is freshly minted and a plain SELECT may
 * race the JWT-propagation. We pass through a fresh getUser to read
 * the row tied to the new session.
 *
 * Returns enabled=false on any error so a network blip can't lock the
 * user out (we'd rather under-protect than block sign-in entirely).
 *
 * @returns {Promise<boolean>}
 */
export async function isMfaEmailEnabledForCurrentSession() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { data } = await supabase
      .from("profiles")
      .select("mfa_email_enabled")
      .eq("auth_id", user.id)
      .maybeSingle();
    return !!data?.mfa_email_enabled;
  } catch {
    return false;
  }
}

/**
 * Turn email MFA on for the caller. Assumes the caller has just
 * verified a test code via the wrapper UI in SecuritySection — the
 * verify proves the email actually works before we flip the switch
 * (otherwise the user would lock themselves out).
 *
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function enableMfaEmail() {
  const { data, error } = await supabase.rpc("enable_mfa_email");
  if (error) return { ok: false, error: error.message };
  if (!data || data.status !== "ok") {
    return { ok: false, error: data?.status || "unknown_error" };
  }
  return { ok: true };
}

/**
 * Turn email MFA off and invalidate any outstanding sign-in codes so
 * they can't be replayed after the user toggles back on later.
 *
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function disableMfaEmail() {
  const { data, error } = await supabase.rpc("disable_mfa_email");
  if (error) return { ok: false, error: error.message };
  if (!data || data.status !== "ok") {
    return { ok: false, error: data?.status || "unknown_error" };
  }
  return { ok: true };
}

/**
 * Ask the server to email the caller a fresh 6-digit sign-in code.
 * The edge function mints + stores the hash + emails the plaintext.
 * Returns ok regardless of which inbox got it — never reveals the
 * email address to the browser.
 *
 * Rate-limited to one request per 60 seconds per user. On rate-limit
 * the caller surfaces a countdown ("wait Xs before requesting another
 * code") rather than a generic error.
 *
 * @returns {Promise<{ ok: true } | { ok: false, error: string, retryAfterSeconds?: number }>}
 */
export async function requestMfaSignInCode() {
  const { data, error } = await supabase.functions.invoke("sendMfaSignInCode", { body: {} });
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "no_response" };
  if (data.status === "ok") return { ok: true };
  if (data.status === "rate_limited") {
    return { ok: false, error: "rate_limited", retryAfterSeconds: data.retry_after_seconds };
  }
  return { ok: false, error: data.status || "unknown_error" };
}

/**
 * Verify a 6-digit sign-in code. Returns:
 *   ok: true            → code valid + consumed; caller proceeds
 *   ok: false, "expired"→ code is past its 10-min window
 *   ok: false, "invalid"→ no match / already consumed / malformed
 *
 * @param {string} code  Plaintext 6-digit string from the user.
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function verifyMfaSignInCode(code) {
  const { data, error } = await supabase.rpc("verify_mfa_signin_code", { p_code: code });
  if (error) return { ok: false, error: error.message };
  if (!data || data.status !== "ok") {
    return { ok: false, error: data?.status || "invalid" };
  }
  return { ok: true };
}

/**
 * Record an MFA event in the audit log. UI surfaces use this for
 * non-RPC state transitions:
 *   - 'lockout'             when client-side failed attempts hit the cap
 *   - 'session_invalidated' when toggling MFA forces other sessions out
 * The RPCs (enable / disable / request / verify) already write their
 * own events server-side — don't double-log.
 *
 * @param {string} event
 * @param {{ ipAddress?: string, userAgent?: string, metadata?: object }} [opts]
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
 * Pull the caller's recent MFA audit-log rows, newest first.
 *
 * @param {number} [limit=20]
 * @returns {Promise<{ ok: true, events: Array } | { ok: false, error: string }>}
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

// ── Trusted device (Phase 3b — unchanged) ──────────────────────────
// "Remember this browser for 30 days." The plaintext token never
// leaves the device; we send it to the server only to hash + compare.

export const TRUSTED_DEVICE_STORAGE_KEY = "inktracker_mfa_trusted_device_token";

export function getLocalTrustedDeviceToken() {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(TRUSTED_DEVICE_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

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

export async function checkLocalTrustedDevice() {
  const token = getLocalTrustedDeviceToken();
  if (!token) return { ok: true, trusted: false };
  const { data, error } = await supabase.rpc("check_mfa_trusted_device", { p_token: token });
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "no_response" };
  if (data.trusted === true) return { ok: true, trusted: true };
  try { localStorage.removeItem(TRUSTED_DEVICE_STORAGE_KEY); } catch { /* ignore */ }
  return { ok: true, trusted: false };
}

export async function listTrustedDevices() {
  const { data, error } = await supabase
    .from("mfa_trusted_devices")
    .select("id, device_label, last_used_at, expires_at, created_at")
    .order("created_at", { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, devices: data ?? [] };
}

export async function revokeTrustedDevice(id) {
  const { data, error } = await supabase.rpc("revoke_mfa_trusted_device", { p_id: id });
  if (error) return { ok: false, error: error.message };
  if (!data || data.status !== "ok") {
    return { ok: false, error: data?.status || "unknown_error" };
  }
  return { ok: true };
}

export async function revokeAllTrustedDevices() {
  const { data, error } = await supabase.rpc("revoke_all_mfa_trusted_devices");
  if (error) return { ok: false, error: error.message };
  if (!data || data.status !== "ok") {
    return { ok: false, error: data?.status || "unknown_error" };
  }
  try { localStorage.removeItem(TRUSTED_DEVICE_STORAGE_KEY); } catch { /* ignore */ }
  return { ok: true, count: Number(data.count) || 0 };
}
