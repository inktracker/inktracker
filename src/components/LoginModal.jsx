import { useState, useEffect } from "react";
import { X, ArrowRight, UserPlus, Eye, EyeOff, Mail, ShieldCheck } from "lucide-react";
import { supabase } from "@/api/supabaseClient";
import { consumeRecoveryCode, logMfaEvent } from "@/lib/mfa";

// Lockout policy for MFA challenge attempts. After this many failed
// codes in a row, the user is signed out and locked from re-attempting
// for the lockout duration. localStorage-backed so the lockout survives
// page reloads (and is enforced for the same browser on a brand-new
// tab). Server-side enforcement is the audit log + Supabase Auth's
// per-IP rate limit on the verify endpoint.
const MFA_MAX_ATTEMPTS = 10;
const MFA_LOCKOUT_MS = 15 * 60 * 1000;
const MFA_LOCKOUT_STORAGE_KEY = "inktracker_mfa_lockout_until";

export default function LoginModal({ isOpen, onClose, defaultMode }) {
  const [mode, setMode] = useState(defaultMode || "signin");

  useEffect(() => {
    if (isOpen && defaultMode) setMode(defaultMode);
  }, [isOpen, defaultMode]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Signup-only — second password field that has to match `password`
  // so a typo on signup doesn't quietly lock the user out of their
  // account. The previous flow only had one field, so a typo got
  // saved as the real password and the user couldn't sign in — they
  // ended up using "Forgot password" to set one they actually knew.
  // BrokerOnboarding + ResetPassword both already have this pattern.
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [magicLoading, setMagicLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [resendLoading, setResendLoading] = useState(false);
  const [pendingConfirmEmail, setPendingConfirmEmail] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  // Signup-only — explicit click-through of Terms + Privacy. The
  // checkbox is required to submit so a shop can't claim they never
  // saw or agreed to the platform agreement. Plain checkbox by design;
  // anything fancier reads as "growth-hack overlay" and erodes trust.
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  // ── MFA challenge state ─────────────────────────────────────────
  // After signInWithPassword succeeds, the session lands at AAL1. If
  // the user has a verified TOTP factor we switch the modal into
  // `mfa-challenge` mode (or `mfa-recovery` when they click "use a
  // recovery code instead") and don't dismiss until they step up to
  // AAL2 or successfully consume a recovery code. Closing the modal
  // mid-challenge signs them out — sitting at AAL1 with the rest of
  // the app open would be the bypass we're guarding against.
  const [mfaFactorId, setMfaFactorId] = useState(null);
  const [mfaChallengeId, setMfaChallengeId] = useState(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaFailedAttempts, setMfaFailedAttempts] = useState(0);
  const [mfaLockedUntil, setMfaLockedUntil] = useState(null);

  // Rehydrate lockout from localStorage on mount so a refresh during
  // lockout doesn't reset the timer.
  useEffect(() => {
    const stored = Number(localStorage.getItem(MFA_LOCKOUT_STORAGE_KEY));
    if (Number.isFinite(stored) && stored > Date.now()) {
      setMfaLockedUntil(stored);
    } else if (Number.isFinite(stored)) {
      // Expired — clean up so we don't keep re-reading a dead value.
      localStorage.removeItem(MFA_LOCKOUT_STORAGE_KEY);
    }
  }, []);

  // ── Cross-device confirmation sync ───────────────────────────────
  // After signup, the desktop tab shows "Confirmation email sent."
  // Operators commonly confirm on their phone (clicking the email
  // link there). The phone gets signed in and navigates to
  // onboarding, but the original desktop tab has no signal that the
  // confirmation happened — it just sits there until the user
  // manually refreshes.
  //
  // Fix: poll every 4 seconds while `pendingConfirmEmail` is set,
  // retrying signInWithPassword with the password the user just
  // typed. Supabase rejects sign-in for unconfirmed accounts; as
  // soon as confirmation lands (from any device), this call
  // succeeds — onClose() fires and the AuthContext listener takes
  // over to navigate into onboarding, identical to a normal sign-in.
  //
  // Cleanup runs on modal close, mode switch, or successful sign-in
  // so we don't keep pinging the auth endpoint forever.
  useEffect(() => {
    // Bail when the modal is closed — React doesn't unmount on
    // `if (!isOpen) return null` (early returns leave hooks live),
    // so the effect would otherwise keep polling Supabase silently
    // after the user dismissed the modal.
    if (!isOpen || !pendingConfirmEmail || !password) return undefined;
    let cancelled = false;
    const interval = setInterval(async () => {
      if (cancelled) return;
      try {
        const { data, error: pollErr } = await supabase.auth.signInWithPassword({
          email: pendingConfirmEmail,
          password,
        });
        if (!cancelled && !pollErr && data?.session) {
          clearInterval(interval);
          onClose();
        }
      } catch {
        // Swallow — keep polling until success, cleanup, or the
        // 10-minute timeout below stops us.
      }
    }, 4000);
    // Hard stop after 10 minutes. If the user hasn't confirmed by
    // then they probably aren't going to this session; no point
    // pinging Supabase's auth endpoint indefinitely from a
    // background tab.
    const timeout = setTimeout(() => clearInterval(interval), 10 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [pendingConfirmEmail, password, onClose]);

  if (!isOpen) return null;

  const switchMode = (next) => {
    setMode(next);
    setError("");
    setSuccess("");
    setPendingConfirmEmail("");
    setConfirmPassword("");
  };

  const handleResendConfirmation = async () => {
    if (!pendingConfirmEmail) return;
    setError("");
    setResendLoading(true);
    try {
      const { error: resendErr } = await supabase.auth.resend({
        type: "signup",
        email: pendingConfirmEmail,
      });
      if (resendErr) throw resendErr;
      setSuccess(`Confirmation email resent to ${pendingConfirmEmail}. If it still doesn't arrive, use "Email me a sign-in link" on the sign-in screen — it works even before you confirm.`);
    } catch (err) {
      setError(err.message || "Couldn't resend the confirmation email.");
    } finally {
      setResendLoading(false);
    }
  };

  // ── MFA verify handlers ───────────────────────────────────────────

  function lockoutMinutesRemaining() {
    if (!mfaLockedUntil) return 0;
    return Math.max(0, Math.ceil((mfaLockedUntil - Date.now()) / 60000));
  }

  async function applyMfaFailure(eventName, extraMetadata = {}) {
    const next = mfaFailedAttempts + 1;
    setMfaFailedAttempts(next);
    setMfaCode("");
    try {
      await logMfaEvent(eventName, { metadata: { attempt: next, ...extraMetadata } });
    } catch { /* audit failures are best-effort */ }
    if (next >= MFA_MAX_ATTEMPTS) {
      const lockUntil = Date.now() + MFA_LOCKOUT_MS;
      setMfaLockedUntil(lockUntil);
      localStorage.setItem(MFA_LOCKOUT_STORAGE_KEY, String(lockUntil));
      try { await logMfaEvent("lockout", { metadata: { attempts: next } }); } catch { /* ignore */ }
      // Drop AAL1 session so the user can't sit on the modal at AAL1
      // and bypass MFA by closing the X. They have to wait + sign in
      // again. Audit log already records the lockout.
      try { await supabase.auth.signOut(); } catch { /* ignore */ }
      setError(`Too many failed attempts. Wait ${Math.ceil(MFA_LOCKOUT_MS / 60000)} minutes before trying again. You've been signed out.`);
      return;
    }
    setError(`Invalid code — ${MFA_MAX_ATTEMPTS - next} attempt${MFA_MAX_ATTEMPTS - next === 1 ? "" : "s"} remaining.`);
  }

  const handleMfaVerify = async (e) => {
    e?.preventDefault?.();
    if (lockoutMinutesRemaining() > 0) {
      setError(`Too many failed attempts. Try again in ${lockoutMinutesRemaining()} minute(s).`);
      return;
    }
    const trimmed = mfaCode.trim().replace(/\s+/g, "");
    if (!/^\d{6}$/.test(trimmed)) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const { error: verifyErr } = await supabase.auth.mfa.verify({
        factorId: mfaFactorId,
        challengeId: mfaChallengeId,
        code: trimmed,
      });
      if (verifyErr) throw verifyErr;
      try { await logMfaEvent("challenge_succeeded"); } catch { /* ignore */ }
      setMfaFailedAttempts(0);
      localStorage.removeItem(MFA_LOCKOUT_STORAGE_KEY);
      onClose();
    } catch (err) {
      // Common Supabase error: "Invalid TOTP code entered" / "Code is incorrect"
      await applyMfaFailure("challenge_failed", { reason: err?.message?.slice(0, 80) });
    } finally {
      setLoading(false);
    }
  };

  const handleRecoveryCodeVerify = async (e) => {
    e?.preventDefault?.();
    if (lockoutMinutesRemaining() > 0) {
      setError(`Too many failed attempts. Try again in ${lockoutMinutesRemaining()} minute(s).`);
      return;
    }
    const trimmed = mfaCode.trim();
    if (!trimmed) {
      setError("Enter a recovery code.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await consumeRecoveryCode(trimmed);
      if (!result.ok) throw new Error(result.error || "invalid");
      // Recovery codes are a one-time bypass: they DISABLE MFA on the
      // account so the user can complete login. Re-enrollment happens
      // afterwards on Account → Security. This is the industry-standard
      // pattern (GitHub, Stripe, Linear). Without unenrolling, the
      // user's AAL would still be AAL1 and the session would be
      // unable to step up.
      try { await supabase.auth.mfa.unenroll({ factorId: mfaFactorId }); } catch { /* ignore */ }
      try { await logMfaEvent("disabled", { metadata: { via: "recovery_code" } }); } catch { /* ignore */ }
      setMfaFailedAttempts(0);
      localStorage.removeItem(MFA_LOCKOUT_STORAGE_KEY);
      onClose();
    } catch (err) {
      await applyMfaFailure("recovery_failed", { reason: err?.message?.slice(0, 80) });
    } finally {
      setLoading(false);
    }
  };

  // Close-guard: bailing out of a challenge means we sign out so the
  // user can't be left at AAL1 with the rest of the app accessible.
  const handleCloseModal = async () => {
    if (mode === "mfa-challenge" || mode === "mfa-recovery") {
      try { await supabase.auth.signOut(); } catch { /* ignore */ }
      setMode("signin");
      setMfaFactorId(null);
      setMfaChallengeId(null);
      setMfaCode("");
      setMfaFailedAttempts(0);
      setError("");
    }
    onClose();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      if (mode === "signup") {
        // Cheap client-side guards so a typo doesn't propagate into the
        // saved password. Supabase enforces minLength=6 server-side too,
        // but we want a clear inline error instead of the generic API
        // message.
        if (password.length < 6) {
          setError("Password must be at least 6 characters.");
          setLoading(false);
          return;
        }
        if (password !== confirmPassword) {
          setError("Passwords don't match.");
          setLoading(false);
          return;
        }
        if (!agreedToTerms) {
          setError("Please agree to the Terms of Service and Privacy Policy.");
          setLoading(false);
          return;
        }
        // Pin the confirmation-email redirect to whatever origin the
        // signup happened on. Without this, Supabase falls back to the
        // dashboard's "Site URL" — if that's set to a preview deploy,
        // an old domain, or just plain wrong, the email link lands the
        // user somewhere that doesn't establish a session and they
        // appear "signed up but not signed in". Mirrors the redirect
        // the magic-link path already uses below.
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/` },
        });
        if (signUpError) throw signUpError;
        // If email confirmation is disabled, user is immediately signed in
        if (data?.session) {
          onClose();
        } else {
          setPendingConfirmEmail(email);
          setSuccess(`Confirmation email sent to ${email}. Click the link in that email to activate your account.`);
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;

        // Password is correct. If the user has a verified TOTP factor
        // we're now sitting at AAL1 and need to step up to AAL2 before
        // dismissing the modal. getAuthenticatorAssuranceLevel returns
        // currentLevel + nextLevel — nextLevel === "aal2" means MFA is
        // enrolled and required. No factor → nextLevel === currentLevel.
        const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        const needsMfa = aalData?.nextLevel === "aal2" && aalData?.currentLevel === "aal1";
        if (needsMfa) {
          const { data: factorsData } = await supabase.auth.mfa.listFactors();
          const totp = (factorsData?.totp || []).find((f) => f.status === "verified");
          if (totp) {
            const { data: chData, error: chErr } = await supabase.auth.mfa.challenge({ factorId: totp.id });
            if (chErr) throw chErr;
            setMfaFactorId(totp.id);
            setMfaChallengeId(chData.id);
            setMode("mfa-challenge");
            setLoading(false);
            return; // don't onClose — modal stays in challenge mode
          }
        }
        onClose();
      }
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    setError("");
    setSuccess("");
    if (!email.trim()) {
      setError("Enter your email first, then click \"Send reset link.\"");
      return;
    }
    setResetLoading(true);
    try {
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/ResetPassword`,
      });
      if (resetErr) throw resetErr;
      // Intentionally neutral wording — don't confirm whether the email
      // exists in our system. Lets an attacker probing for valid accounts
      // come away with the same response either way. Supabase's own API
      // returns success regardless of whether the user exists; this just
      // matches that behavior in the UI.
      setSuccess("If an account exists for that email, we've sent a password-reset link. Check your inbox and spam folder.");
    } catch (err) {
      setError(err.message || "Couldn't send the reset link.");
    } finally {
      setResetLoading(false);
    }
  };

  const handleMagicLink = async () => {
    setError("");
    setSuccess("");
    if (!email.trim()) {
      setError("Enter your email first, then click \"Email me a sign-in link.\"");
      return;
    }
    setMagicLoading(true);
    try {
      const { error: otpErr } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: `${window.location.origin}/`,
          // Magic-link is for sign-IN only. Without shouldCreateUser:false,
          // Supabase silently creates a new auth row for any email that
          // isn't already confirmed — including ones that were partially
          // signed up via password but never confirmed. That duplicate row
          // breaks the subsequent password-set / confirm flow because the
          // original signup's confirm link points at a now-orphaned row.
          shouldCreateUser: false,
        },
      });
      if (otpErr) throw otpErr;
      setSuccess(`Check ${email.trim()} for a sign-in link. It works even if you haven't set a password.`);
    } catch (err) {
      setError(err.message || "Couldn't send sign-in link.");
    } finally {
      setMagicLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start sm:items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md my-auto max-h-[calc(100vh-2rem)] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">
            {mode === "signup"
              ? "Create Account"
              : mode === "forgot"
              ? "Reset Password"
              : mode === "mfa-challenge"
              ? "Verify your identity"
              : mode === "mfa-recovery"
              ? "Use a recovery code"
              : "Sign In"}
          </h2>
          <button onClick={handleCloseModal} className="text-slate-400 hover:text-slate-600 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Info banner for sign-up */}
          {mode === "signup" && (
            <div className="rounded-2xl border border-teal-200 bg-teal-50 px-4 py-4 flex gap-3">
              <UserPlus className="w-5 h-5 text-teal-600 mt-0.5 shrink-0" />
              <div>
                <div className="text-sm font-semibold text-teal-900">New users</div>
                <p className="text-sm text-teal-800 leading-6 mt-1">
                  After creating your account, access remains pending until it is approved. Use
                  the same email address each time.
                </p>
              </div>
            </div>
          )}

          {/* Error / success banners */}
          {error && (() => {
            // "Invalid login credentials" is Supabase's catch-all for THREE
            // distinct cases (anti-enumeration design): account has no
            // password set (invited user who never set one), email never
            // confirmed, or wrong password. The bare error message dead-ends
            // the user. When we see exactly that string in sign-in mode,
            // show a recovery panel with the two paths that work in all
            // three cases: magic link + password reset.
            const isInvalidCreds =
              mode === "signin" &&
              /invalid\s+login\s+credentials/i.test(error);
            if (!isInvalidCreds) {
              return (
                <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              );
            }
            return (
              <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800 space-y-3">
                <p className="leading-relaxed">
                  We couldn't sign you in with that password. If you were invited to InkTracker, you may not have a password set yet — or you may have reset it since.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={handleMagicLink}
                    disabled={magicLoading}
                    className="inline-flex items-center justify-center gap-1.5 border border-amber-300 bg-white text-amber-800 font-semibold py-2 px-3 rounded-lg text-xs hover:bg-amber-50 transition disabled:opacity-60"
                  >
                    <Mail className="w-3.5 h-3.5" />
                    {magicLoading ? "Sending…" : "Email me a sign-in link"}
                  </button>
                  <button
                    type="button"
                    onClick={() => switchMode("forgot")}
                    className="inline-flex items-center justify-center gap-1.5 border border-amber-300 bg-white text-amber-800 font-semibold py-2 px-3 rounded-lg text-xs hover:bg-amber-50 transition"
                  >
                    Reset password
                  </button>
                </div>
              </div>
            );
          })()}
          {success && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700">
              {success}
            </div>
          )}

          {pendingConfirmEmail && mode === "signup" && (
            <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-sm text-slate-600 space-y-2">
              <p className="leading-relaxed">
                Didn&apos;t get the email? Check spam, or:
              </p>
              <button
                type="button"
                onClick={handleResendConfirmation}
                disabled={resendLoading}
                className="w-full inline-flex items-center justify-center gap-2 border border-slate-300 bg-white text-slate-700 font-semibold py-2 rounded-lg transition hover:bg-slate-50 disabled:opacity-60"
              >
                {resendLoading ? "Sending…" : "Resend confirmation email"}
              </button>
              <p className="text-xs text-slate-500 leading-relaxed">
                Still no luck? Switch to sign-in and use &quot;Email me a sign-in link&quot; — it works before confirmation too.
              </p>
            </div>
          )}

          {/* Forgot-password mode: email field + "Send reset link" only. */}
          {mode === "forgot" ? (
            <div className="space-y-4">
              <p className="text-sm text-slate-600 leading-relaxed">
                Enter your account email. We'll send a link that lets you set a new password.
              </p>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Email address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  placeholder="you@example.com"
                />
              </div>
              <button
                type="button"
                onClick={handleResetPassword}
                disabled={resetLoading}
                className="w-full inline-flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-700 text-white font-semibold py-3 rounded-xl transition disabled:opacity-60"
              >
                <Mail className="w-4 h-4" />
                {resetLoading ? "Sending…" : "Send reset link"}
              </button>
            </div>
          ) : mode === "mfa-challenge" ? (
            <form onSubmit={handleMfaVerify} className="space-y-4">
              <div className="flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-teal-600 mt-0.5 shrink-0" />
                <p className="text-sm text-slate-600 leading-relaxed">
                  Two-factor authentication is on for this account. Enter the 6-digit code from your authenticator app.
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
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="123456"
                  className="w-40 px-4 py-2.5 border border-slate-200 rounded-xl text-base font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-teal-500"
                  autoFocus
                  disabled={lockoutMinutesRemaining() > 0}
                />
              </div>
              <button
                type="submit"
                disabled={loading || mfaCode.length !== 6 || lockoutMinutesRemaining() > 0}
                className="w-full inline-flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-700 text-white font-semibold py-3 rounded-xl transition disabled:opacity-60"
              >
                {loading ? "Verifying…" : "Verify and sign in"}
                <ArrowRight className="w-4 h-4" />
              </button>
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => { setMode("mfa-recovery"); setMfaCode(""); setError(""); }}
                  className="text-xs font-semibold text-teal-600 hover:text-teal-700"
                >
                  Use a recovery code instead
                </button>
              </div>
            </form>
          ) : mode === "mfa-recovery" ? (
            <form onSubmit={handleRecoveryCodeVerify} className="space-y-4">
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
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value.toUpperCase())}
                  placeholder="ABCDE-FGHJK"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-base font-mono tracking-wider focus:outline-none focus:ring-2 focus:ring-teal-500"
                  autoFocus
                  disabled={lockoutMinutesRemaining() > 0}
                />
              </div>
              <button
                type="submit"
                disabled={loading || !mfaCode.trim() || lockoutMinutesRemaining() > 0}
                className="w-full inline-flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-700 text-white font-semibold py-3 rounded-xl transition disabled:opacity-60"
              >
                {loading ? "Verifying…" : "Verify and sign in"}
                <ArrowRight className="w-4 h-4" />
              </button>
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => { setMode("mfa-challenge"); setMfaCode(""); setError(""); }}
                  className="text-xs font-semibold text-teal-600 hover:text-teal-700"
                >
                  Back to authenticator code
                </button>
              </div>
            </form>
          ) : (
          /* Form */
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-sm font-semibold text-slate-700">
                  Password
                </label>
                {mode === "signin" && (
                  <button
                    type="button"
                    onClick={() => switchMode("forgot")}
                    className="text-xs font-semibold text-teal-600 hover:text-teal-700"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 pr-11"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {mode === "signup" && (
                <p className="text-xs text-slate-400 mt-1">Minimum 6 characters</p>
              )}
            </div>

            {/* Confirm password — signup only. Catches typos before
                they get saved as the real password, which would
                otherwise leave the user unable to sign in until they
                reset via email. */}
            {mode === "signup" && (
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Confirm password
                </label>
                <input
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={6}
                  autoComplete="new-password"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  placeholder="••••••••"
                />
                {confirmPassword.length > 0 && password !== confirmPassword && (
                  <p className="text-xs text-red-600 mt-1">Passwords don't match yet</p>
                )}
              </div>
            )}

            {mode === "signup" && (
              <label className="flex items-start gap-2 text-xs text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreedToTerms}
                  onChange={(e) => setAgreedToTerms(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 flex-shrink-0"
                />
                <span className="leading-snug">
                  I agree to the{" "}
                  <a href="/terms" target="_blank" rel="noopener noreferrer" className="font-semibold text-teal-600 hover:text-teal-700 underline">
                    Terms of Service
                  </a>{" "}
                  and{" "}
                  <a href="/privacy" target="_blank" rel="noopener noreferrer" className="font-semibold text-teal-600 hover:text-teal-700 underline">
                    Privacy Policy
                  </a>
                  .
                </span>
              </label>
            )}

            <button
              type="submit"
              disabled={loading || (mode === "signup" && !agreedToTerms)}
              className="w-full inline-flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-700 text-white font-semibold py-3 rounded-xl transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading
                ? "Please wait…"
                : mode === "signup"
                ? "Create Account"
                : "Sign In"}
              {!loading && <ArrowRight className="w-4 h-4" />}
            </button>

          </form>
          )}

          {mode === "signin" && (
            <>
              <div className="flex items-center gap-3 text-xs text-slate-400">
                <div className="flex-1 border-t border-slate-200" />
                or
                <div className="flex-1 border-t border-slate-200" />
              </div>
              <button
                type="button"
                onClick={handleMagicLink}
                disabled={magicLoading}
                className="w-full inline-flex items-center justify-center gap-2 border border-teal-200 text-teal-700 font-semibold py-3 rounded-xl transition hover:bg-teal-50 disabled:opacity-60"
              >
                <Mail className="w-4 h-4" />
                {magicLoading ? "Sending…" : "Email me a sign-in link"}
              </button>
              <p className="text-xs text-slate-400 text-center">
                No password yet? Use this if you were invited.
              </p>
            </>
          )}

          {/* Mode toggle — hidden during MFA challenge / recovery since
              switching to "Sign up" or "Forgot password" mid-challenge
              would leave the session at AAL1. Use the X to bail (which
              signs the user out via handleCloseModal). */}
          {(mode === "mfa-challenge" || mode === "mfa-recovery") ? null : (
          <div className="text-center">
            {mode === "signin" ? (
              <p className="text-sm text-slate-500">
                Don&apos;t have an account?{" "}
                <button
                  onClick={() => switchMode("signup")}
                  className="font-semibold text-teal-600 hover:text-teal-700"
                >
                  Create one
                </button>
              </p>
            ) : mode === "forgot" ? (
              <p className="text-sm text-slate-500">
                Remembered it?{" "}
                <button
                  onClick={() => switchMode("signin")}
                  className="font-semibold text-teal-600 hover:text-teal-700"
                >
                  Back to sign in
                </button>
              </p>
            ) : (
              <p className="text-sm text-slate-500">
                Already have an account?{" "}
                <button
                  onClick={() => switchMode("signin")}
                  className="font-semibold text-teal-600 hover:text-teal-700"
                >
                  Sign in
                </button>
              </p>
            )}
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
