import { useState, useEffect } from "react";
import { X, ArrowRight, UserPlus, Eye, EyeOff, Mail } from "lucide-react";
import { supabase } from "@/api/supabaseClient";

export default function LoginModal({ isOpen, onClose, defaultMode }) {
  const [mode, setMode] = useState(defaultMode || "signin");

  useEffect(() => {
    if (isOpen && defaultMode) setMode(defaultMode);
  }, [isOpen, defaultMode]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [magicLoading, setMagicLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [resendLoading, setResendLoading] = useState(false);
  const [pendingConfirmEmail, setPendingConfirmEmail] = useState("");

  if (!isOpen) return null;

  const switchMode = (next) => {
    setMode(next);
    setError("");
    setSuccess("");
    setPendingConfirmEmail("");
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      if (mode === "signup") {
        const { data, error: signUpError } = await supabase.auth.signUp({ email, password });
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
        onClose();
      }
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
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
        options: { emailRedirectTo: `${window.location.origin}/` },
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">
            {mode === "signup" ? "Create Account" : "Sign In"}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Info banner for sign-up */}
          {mode === "signup" && (
            <div className="rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-4 flex gap-3">
              <UserPlus className="w-5 h-5 text-indigo-600 mt-0.5 shrink-0" />
              <div>
                <div className="text-sm font-semibold text-indigo-900">New users</div>
                <p className="text-sm text-indigo-800 leading-6 mt-1">
                  After creating your account, access remains pending until it is approved. Use
                  the same email address each time.
                </p>
              </div>
            </div>
          )}

          {/* Error / success banners */}
          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
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

          {/* Form */}
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
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 pr-11"
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

            <button
              type="submit"
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-xl transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading
                ? "Please wait…"
                : mode === "signup"
                ? "Create Account"
                : "Sign In"}
              {!loading && <ArrowRight className="w-4 h-4" />}
            </button>

            {mode === "signup" && (
              <p className="text-xs text-slate-500 leading-relaxed mt-3">
                Founding member rate ($99/month) is tied to a continuous subscription. If you cancel, the founding rate is forfeited — re-signup pricing is the standard $149/month.
              </p>
            )}
          </form>

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
                className="w-full inline-flex items-center justify-center gap-2 border border-indigo-200 text-indigo-700 font-semibold py-3 rounded-xl transition hover:bg-indigo-50 disabled:opacity-60"
              >
                <Mail className="w-4 h-4" />
                {magicLoading ? "Sending…" : "Email me a sign-in link"}
              </button>
              <p className="text-xs text-slate-400 text-center">
                No password yet? Use this if you were invited.
              </p>
            </>
          )}

          {/* Mode toggle */}
          <div className="text-center">
            {mode === "signin" ? (
              <p className="text-sm text-slate-500">
                Don&apos;t have an account?{" "}
                <button
                  onClick={() => switchMode("signup")}
                  className="font-semibold text-indigo-600 hover:text-indigo-700"
                >
                  Create one
                </button>
              </p>
            ) : (
              <p className="text-sm text-slate-500">
                Already have an account?{" "}
                <button
                  onClick={() => switchMode("signin")}
                  className="font-semibold text-indigo-600 hover:text-indigo-700"
                >
                  Sign in
                </button>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
