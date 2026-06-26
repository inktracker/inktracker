// Password reset landing page.
//
// User clicks the link in the Supabase password-reset email and lands here.
// Supabase puts the recovery token in the URL hash; the supabase-js SDK
// auto-detects it and sets a temporary recovery session. Once that session
// is in place, calling auth.updateUser({ password }) sets the new password
// AND completes sign-in.
//
// Public route (no auth required to view this page itself).

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/api/supabaseClient";
import { Loader2, Eye, EyeOff, CheckCircle2, AlertCircle } from "lucide-react";

const INKTRACKER_LOGO =
  "https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/69aa650fd3e825e66ff81817/b4e2dc53f_logo.png";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [recoveryError, setRecoveryError] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  // Supabase's detectSessionInUrl auto-handles the #access_token=... hash.
  // We just need to wait for the resulting auth state event before showing
  // the form. If no recovery session lands within a couple seconds (e.g.
  // user navigated here directly without clicking an email link), show a
  // helpful error.
  useEffect(() => {
    let resolved = false;
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        resolved = true;
        setRecoveryReady(true);
      }
    });
    // Also check if a recovery session already exists (in case the event
    // fired before the listener was attached).
    supabase.auth.getSession().then(({ data }) => {
      if (resolved) return;
      if (data?.session) {
        // Could be a regular signed-in session — only allow password reset
        // if the URL fragment indicates recovery.
        const hash = window.location.hash || "";
        if (hash.includes("type=recovery")) {
          resolved = true;
          setRecoveryReady(true);
        }
      }
    });
    // Soft timeout — if neither path triggers, the link was probably
    // missing the recovery hash (direct navigation, expired link, etc.).
    const t = setTimeout(() => {
      if (!resolved) {
        setRecoveryError(
          "This password reset link is missing or expired. Request a new one from the sign-in page.",
        );
      }
    }, 2500);
    return () => {
      sub.subscription?.unsubscribe?.();
      clearTimeout(t);
    };
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (password.length < 9) {
      setError("Password must be at least 9 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setSaving(true);
    try {
      const { error: updErr } = await supabase.auth.updateUser({ password });
      if (updErr) throw updErr;
      setSuccess(true);
      // Full-page navigation rather than client-side route change so
      // AuthContext re-runs its initial auth check and picks up the
      // (now finalized) signed-in session. A client-side navigate("/")
      // would land on the public landing page because AuthContext's
      // SIGNED_IN handler is intentionally skipped while on the reset
      // page (see AuthContext password-recovery special-case).
      setTimeout(() => {
        window.location.assign("/");
      }, 1500);
    } catch (err) {
      setError(err?.message || "Couldn't update password. Try requesting a new reset link.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 w-full max-w-md p-8 space-y-6">
        <div className="text-center">
          <img src={INKTRACKER_LOGO} alt="InkTracker" className="h-10 mx-auto mb-3" />
          <h1 className="text-xl font-bold text-slate-900">Set a new password</h1>
        </div>

        {recoveryError && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{recoveryError}</span>
          </div>
        )}

        {success && (
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700 flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>Password updated. Taking you to your dashboard…</span>
          </div>
        )}

        {!recoveryReady && !recoveryError && (
          <div className="flex items-center justify-center py-6 text-slate-500 text-sm">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Verifying reset link…
          </div>
        )}

        {recoveryReady && !success && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                New password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={9}
                  autoComplete="new-password"
                  autoFocus
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 pr-11"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-1">Minimum 9 characters</p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                Confirm password
              </label>
              <input
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={9}
                autoComplete="new-password"
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={saving}
              className="w-full inline-flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-700 text-white font-semibold py-3 rounded-xl transition disabled:opacity-60"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {saving ? "Updating…" : "Update Password"}
            </button>
          </form>
        )}

        {recoveryError && (
          <button
            onClick={() => navigate("/")}
            className="block w-full text-center text-sm font-semibold text-teal-600 hover:text-teal-700"
          >
            Go back to sign in
          </button>
        )}
      </div>
    </div>
  );
}
