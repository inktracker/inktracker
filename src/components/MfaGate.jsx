import { useState, useEffect } from "react";
import { ShieldCheck, ArrowRight, LogOut } from "lucide-react";
import { supabase } from "@/api/supabaseClient";
import {
  requestMfaSignInCode,
  verifyMfaSignInCode,
  registerTrustedDevice,
  logMfaEvent,
} from "@/lib/mfa";
import { markMfaSessionVerified } from "@/lib/mfaSession";

// Full-screen blocking MFA challenge. Rendered by AuthenticatedApp when
// the user's profile has mfa_email_enabled = true AND the current tab
// hasn't been verified AND no trusted-device match. Until the user
// verifies, the rest of the app is unreachable — the AuthContext gate
// is what makes MFA real (the LoginModal alone can't enforce it because
// the session is created before any code can be checked).
//
// Lockout policy: 10 failed code entries → 15-min lockout + sign-out.
// localStorage-backed so the timer survives reload. The verify RPC is
// already row-level rate-limited (single-use codes); this guard exists
// to slow a hammering attacker.

const MAX_ATTEMPTS = 10;
const LOCKOUT_MS = 15 * 60 * 1000;
const LOCKOUT_STORAGE_KEY = "inktracker_mfa_lockout_until";

export default function MfaGate({ userId, userEmail, onPass }) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [retryAfter, setRetryAfter] = useState(0);
  const [trustDevice, setTrustDevice] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(null);
  const [sendOnMountDone, setSendOnMountDone] = useState(false);

  // Rehydrate lockout from localStorage on mount.
  useEffect(() => {
    try {
      const stored = Number(localStorage.getItem(LOCKOUT_STORAGE_KEY));
      if (Number.isFinite(stored) && stored > Date.now()) {
        setLockedUntil(stored);
      } else if (Number.isFinite(stored) && stored > 0) {
        localStorage.removeItem(LOCKOUT_STORAGE_KEY);
      }
    } catch { /* ignore */ }
  }, []);

  // Send a code immediately when the gate opens (unless locked).
  // Idempotent via sendOnMountDone; rate-limit returns surface as info
  // text rather than as an error so the user knows to check inbox.
  useEffect(() => {
    if (sendOnMountDone) return undefined;
    if (lockedUntil && lockedUntil > Date.now()) {
      setSendOnMountDone(true);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      const r = await requestMfaSignInCode();
      if (cancelled) return;
      if (r.ok) {
        setInfo("We sent a 6-digit code to your email.");
        setRetryAfter(60);
      } else if (r.error === "rate_limited") {
        setInfo("A recent code is still valid — check your inbox.");
        setRetryAfter(r.retryAfterSeconds || 60);
      } else {
        setError("Couldn't send the sign-in code. Click Resend to try again.");
      }
      setSendOnMountDone(true);
    })();
    return () => { cancelled = true; };
  }, [sendOnMountDone, lockedUntil]);

  // Resend countdown tick.
  useEffect(() => {
    if (retryAfter <= 0) return undefined;
    const t = setTimeout(() => setRetryAfter((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [retryAfter]);

  function lockoutMinutesRemaining() {
    if (!lockedUntil) return 0;
    return Math.max(0, Math.ceil((lockedUntil - Date.now()) / 60000));
  }

  async function applyFailure(reason) {
    void reason;
    const next = failedAttempts + 1;
    setFailedAttempts(next);
    setCode("");
    // Note: the verify RPC already records 'signin_code_failed' server-side
    // (and counts it toward the SEC-02 lockout), so we deliberately do NOT
    // log it again here — double-logging would trip the server lockout at
    // half the intended threshold.
    if (next >= MAX_ATTEMPTS) {
      const lockUntil = Date.now() + LOCKOUT_MS;
      setLockedUntil(lockUntil);
      try { localStorage.setItem(LOCKOUT_STORAGE_KEY, String(lockUntil)); } catch { /* ignore */ }
      try { await logMfaEvent("lockout", { metadata: { attempts: next } }); } catch { /* ignore */ }
      try { await supabase.auth.signOut(); } catch { /* ignore */ }
      setError(`Too many failed attempts. Wait ${Math.ceil(LOCKOUT_MS / 60000)} minutes before trying again. You've been signed out.`);
      return;
    }
    setError(`Invalid code — ${MAX_ATTEMPTS - next} attempt${MAX_ATTEMPTS - next === 1 ? "" : "s"} remaining.`);
  }

  const handleVerify = async (e) => {
    e?.preventDefault?.();
    if (lockoutMinutesRemaining() > 0) {
      setError(`Locked. Try again in ${lockoutMinutesRemaining()} minute(s).`);
      return;
    }
    const trimmed = code.trim().replace(/\D/g, "");
    if (trimmed.length !== 6) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    setLoading(true);
    setError("");
    setInfo("");
    try {
      const v = await verifyMfaSignInCode(trimmed);
      if (!v.ok) {
        if (v.error === "expired") {
          setError("That code expired. Click Resend to get a new one.");
          setCode("");
        } else if (v.error === "locked_out") {
          // Server enforced the SEC-02 brute-force lockout — mirror it in the
          // UI and sign out, same as the client-side cap path.
          const lockUntil = Date.now() + LOCKOUT_MS;
          setLockedUntil(lockUntil);
          try { localStorage.setItem(LOCKOUT_STORAGE_KEY, String(lockUntil)); } catch { /* ignore */ }
          setCode("");
          try { await supabase.auth.signOut(); } catch { /* ignore */ }
          setError(`Too many failed attempts. Wait ${Math.ceil(LOCKOUT_MS / 60000)} minutes before trying again. You've been signed out.`);
        } else {
          await applyFailure(v.error);
        }
        return;
      }
      setFailedAttempts(0);
      try { localStorage.removeItem(LOCKOUT_STORAGE_KEY); } catch { /* ignore */ }
      if (trustDevice) {
        try {
          const label = (navigator?.userAgent || "Unknown device").slice(0, 200);
          await registerTrustedDevice(label);
        } catch { /* best-effort */ }
      }
      markMfaSessionVerified(userId);
      onPass();
    } catch (err) {
      await applyFailure(err?.message?.slice(0, 80));
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setError("");
    setInfo("");
    setLoading(true);
    try {
      const r = await requestMfaSignInCode();
      if (r.ok) {
        setInfo("New code sent. Check your email.");
        setRetryAfter(60);
        return;
      }
      if (r.error === "rate_limited") {
        setRetryAfter(r.retryAfterSeconds || 60);
        setInfo("A recent code is still valid — check your inbox.");
        return;
      }
      setError(r.error || "Couldn't send a new code. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    try { await supabase.auth.signOut(); } catch { /* ignore */ }
    // AuthContext's SIGNED_OUT handler resets state, but a hard reload
    // guarantees the gate disappears even if something downstream got
    // stuck. Lands on the public landing page.
    window.location.href = "/";
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-teal-100 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-teal-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">Verify it's you</h2>
            <p className="text-xs text-slate-500 truncate max-w-[20rem]">{userEmail || "Signed in"}</p>
          </div>
        </div>

        {info && !error && (
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700">
            {info}
          </div>
        )}
        {error && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleVerify} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              6-digit code
            </label>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="123456"
              className="w-40 px-4 py-2.5 border border-slate-200 rounded-xl text-base font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-teal-500"
              autoFocus
              disabled={lockoutMinutesRemaining() > 0}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={trustDevice}
              onChange={(e) => setTrustDevice(e.target.checked)}
              disabled={loading}
            />
            <span>Remember this device for 30 days</span>
          </label>
          <button
            type="submit"
            disabled={loading || code.length !== 6 || lockoutMinutesRemaining() > 0}
            className="w-full inline-flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-700 text-white font-semibold py-3 rounded-xl transition disabled:opacity-60"
          >
            {loading ? "Verifying…" : "Verify and continue"}
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <div className="flex items-center justify-between text-xs">
          <button
            type="button"
            onClick={handleResend}
            disabled={loading || retryAfter > 0}
            className="font-semibold text-teal-600 hover:text-teal-700 disabled:opacity-60"
          >
            {retryAfter > 0 ? `Resend in ${retryAfter}s` : "Resend code"}
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            className="inline-flex items-center gap-1 font-semibold text-slate-500 hover:text-slate-700"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
