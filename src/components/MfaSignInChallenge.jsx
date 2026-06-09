// Global MFA step-up overlay.
//
// Sole consumer of AuthContext's `mfaChallengeRequired` state. Renders
// a blocking modal whenever an authenticated session is at AAL1 with a
// verified TOTP factor — i.e. the user landed here via magic link or a
// session restore that didn't pass through LoginModal's password
// challenge.
//
// Mirrors LoginModal's mfa-challenge / mfa-recovery state machine:
//   - 6-digit code verify against the existing factor + challenge
//   - "Use a recovery code instead" → consume + unenroll factor
//   - 10-attempt lockout shared with LoginModal via the same
//     localStorage key
//   - Cancel / X signs the user out (no AAL1-bypass loophole)
//
// We deliberately do NOT offer "Remember this device" here. The
// trusted-device opt-in happens at the password sign-in step in
// LoginModal where the user is making an active choice to extend
// trust. A magic-link recipient is mid-flight; surfacing the toggle
// here would be a security-decision-by-context-switch.

import { useEffect, useState } from "react";
import { ShieldCheck, AlertTriangle, ArrowRight } from "lucide-react";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { consumeRecoveryCode, logMfaEvent } from "@/lib/mfa";

const MFA_MAX_ATTEMPTS = 10;
const MFA_LOCKOUT_MS = 15 * 60 * 1000;
const MFA_LOCKOUT_STORAGE_KEY = "inktracker_mfa_lockout_until"; // shared with LoginModal

export default function MfaSignInChallenge() {
  const { mfaChallengeRequired, mfaFactorId, mfaChallengeId, clearMfaChallenge, checkAppState } = useAuth();
  const [mode, setMode] = useState("challenge"); // challenge | recovery
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(null);

  useEffect(() => {
    if (!mfaChallengeRequired) return;
    const stored = Number(localStorage.getItem(MFA_LOCKOUT_STORAGE_KEY));
    if (Number.isFinite(stored) && stored > Date.now()) setLockedUntil(stored);
    else if (Number.isFinite(stored)) localStorage.removeItem(MFA_LOCKOUT_STORAGE_KEY);
  }, [mfaChallengeRequired]);

  // Reset transient form state whenever a fresh challenge starts.
  useEffect(() => {
    if (mfaChallengeRequired) {
      setCode("");
      setError("");
      setMode("challenge");
    }
  }, [mfaChallengeId, mfaChallengeRequired]);

  if (!mfaChallengeRequired) return null;

  function lockoutMinutesRemaining() {
    if (!lockedUntil) return 0;
    return Math.max(0, Math.ceil((lockedUntil - Date.now()) / 60000));
  }

  async function applyFailure(eventName, extraMetadata = {}) {
    const next = failedAttempts + 1;
    setFailedAttempts(next);
    setCode("");
    try { await logMfaEvent(eventName, { metadata: { attempt: next, source: "magic-link", ...extraMetadata } }); } catch { /* ignore */ }
    if (next >= MFA_MAX_ATTEMPTS) {
      const lockUntil = Date.now() + MFA_LOCKOUT_MS;
      setLockedUntil(lockUntil);
      localStorage.setItem(MFA_LOCKOUT_STORAGE_KEY, String(lockUntil));
      try { await logMfaEvent("lockout", { metadata: { attempts: next, source: "magic-link" } }); } catch { /* ignore */ }
      try { await supabase.auth.signOut(); } catch { /* ignore */ }
      setError(`Too many failed attempts. Wait ${Math.ceil(MFA_LOCKOUT_MS / 60000)} minutes before trying again. You've been signed out.`);
      return;
    }
    setError(`Invalid code — ${MFA_MAX_ATTEMPTS - next} attempt${MFA_MAX_ATTEMPTS - next === 1 ? "" : "s"} remaining.`);
  }

  async function handleVerify(e) {
    e?.preventDefault?.();
    if (lockoutMinutesRemaining() > 0) {
      setError(`Too many failed attempts. Try again in ${lockoutMinutesRemaining()} minute(s).`);
      return;
    }
    const trimmed = code.trim().replace(/\s+/g, "");
    if (!/^\d{6}$/.test(trimmed)) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { error: verifyErr } = await supabase.auth.mfa.verify({
        factorId: mfaFactorId,
        challengeId: mfaChallengeId,
        code: trimmed,
      });
      if (verifyErr) throw verifyErr;
      try { await logMfaEvent("challenge_succeeded", { metadata: { source: "magic-link" } }); } catch { /* ignore */ }
      setFailedAttempts(0);
      localStorage.removeItem(MFA_LOCKOUT_STORAGE_KEY);
      clearMfaChallenge();
      // Re-evaluate so any downstream state (Sentry, profile) reflects
      // the new AAL2 session.
      try { await checkAppState({ silent: true }); } catch { /* ignore */ }
    } catch (err) {
      await applyFailure("challenge_failed", { reason: err?.message?.slice(0, 80) });
    } finally {
      setBusy(false);
    }
  }

  async function handleRecovery(e) {
    e?.preventDefault?.();
    if (lockoutMinutesRemaining() > 0) {
      setError(`Too many failed attempts. Try again in ${lockoutMinutesRemaining()} minute(s).`);
      return;
    }
    const trimmed = code.trim();
    if (!trimmed) {
      setError("Enter a recovery code.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await consumeRecoveryCode(trimmed);
      if (!result.ok) throw new Error(result.error || "invalid");
      // Recovery code = one-time bypass. Unenroll the factor so the
      // session proceeds at AAL1 without a step-up requirement. User
      // re-enrolls from Account → Security afterwards.
      try { await supabase.auth.mfa.unenroll({ factorId: mfaFactorId }); } catch { /* ignore */ }
      try { await logMfaEvent("disabled", { metadata: { via: "recovery_code", source: "magic-link" } }); } catch { /* ignore */ }
      setFailedAttempts(0);
      localStorage.removeItem(MFA_LOCKOUT_STORAGE_KEY);
      clearMfaChallenge();
      try { await checkAppState({ silent: true }); } catch { /* ignore */ }
    } catch (err) {
      await applyFailure("recovery_failed", { reason: err?.message?.slice(0, 80) });
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    // Bailing out of a magic-link challenge can't leave the user at
    // AAL1 with the rest of the app loaded behind us — sign them out
    // and clear the flag.
    try { await supabase.auth.signOut(); } catch { /* ignore */ }
    clearMfaChallenge();
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-[80] flex items-start sm:items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md my-auto">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">
            {mode === "challenge" ? "Verify your identity" : "Use a recovery code"}
          </h2>
        </div>
        <div className="p-6 space-y-4">
          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>{error}</div>
            </div>
          )}

          {mode === "challenge" ? (
            <form onSubmit={handleVerify} className="space-y-4">
              <div className="flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-teal-600 mt-0.5 shrink-0" />
                <p className="text-sm text-slate-600 leading-relaxed">
                  Two-factor authentication is on for this account. Enter the 6-digit code from your authenticator app to continue.
                </p>
              </div>
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
              <button
                type="submit"
                disabled={busy || code.length !== 6 || lockoutMinutesRemaining() > 0}
                className="w-full inline-flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-700 text-white font-semibold py-3 rounded-xl transition disabled:opacity-60"
              >
                {busy ? "Verifying…" : "Verify and continue"}
                <ArrowRight className="w-4 h-4" />
              </button>
              <div className="flex items-center justify-between text-xs">
                <button
                  type="button"
                  onClick={() => { setMode("recovery"); setCode(""); setError(""); }}
                  className="font-semibold text-teal-600 hover:text-teal-700"
                >
                  Use a recovery code instead
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  className="font-semibold text-slate-500 hover:text-slate-700"
                >
                  Sign out
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleRecovery} className="space-y-4">
              <div className="flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-teal-600 mt-0.5 shrink-0" />
                <p className="text-sm text-slate-600 leading-relaxed">
                  Enter one of your single-use recovery codes. Using a recovery code will turn off two-factor authentication — you'll need to re-enable it from Account → Security.
                </p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Recovery code
                </label>
                <input
                  type="text"
                  autoComplete="off"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="ABCDE-FGHJK"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-base font-mono tracking-wider focus:outline-none focus:ring-2 focus:ring-teal-500"
                  autoFocus
                  disabled={lockoutMinutesRemaining() > 0}
                />
              </div>
              <button
                type="submit"
                disabled={busy || !code.trim() || lockoutMinutesRemaining() > 0}
                className="w-full inline-flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-700 text-white font-semibold py-3 rounded-xl transition disabled:opacity-60"
              >
                {busy ? "Verifying…" : "Verify and continue"}
                <ArrowRight className="w-4 h-4" />
              </button>
              <div className="flex items-center justify-between text-xs">
                <button
                  type="button"
                  onClick={() => { setMode("challenge"); setCode(""); setError(""); }}
                  className="font-semibold text-teal-600 hover:text-teal-700"
                >
                  Back to authenticator code
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  className="font-semibold text-slate-500 hover:text-slate-700"
                >
                  Sign out
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
