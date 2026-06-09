// MFA email recovery landing page.
//
// Reached via the link in the recovery email sent by
// sendMfaRecoveryEmail. The URL query carries the plaintext token;
// we hand it to the consume RPC, which validates + marks consumed +
// unenrolls the user's TOTP factor. The user is then redirected to
// /Account?section=security to re-enroll a new authenticator.
//
// The token IS the credential — anyone with the link in the email
// can consume it (single-use, 15-min expiry). After consume, the user
// will need to actually sign in (the consume only disables MFA; it
// doesn't grant a session). We send them to / so the existing sign-in
// flow can take over.

import { useEffect, useState } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { ShieldCheck, AlertTriangle, Loader2 } from "lucide-react";
import { consumeMfaEmailRecoveryToken } from "@/lib/mfa";

export default function MfaRecovery() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState("working"); // working | ok | expired | already_used | invalid | error
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const token = params.get("token");
    if (!token) {
      setStatus("invalid");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const result = await consumeMfaEmailRecoveryToken(token);
        if (cancelled) return;
        if (result.ok) {
          setStatus("ok");
          // Auto-redirect after a short read window so the user can see
          // the confirmation before being sent back to sign in.
          setTimeout(() => navigate("/", { replace: true }), 3000);
          return;
        }
        const known = ["expired", "already_used", "invalid"];
        setStatus(known.includes(result.error) ? result.error : "error");
        if (!known.includes(result.error)) setErrorMessage(result.error);
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setErrorMessage(err?.message || "Couldn't reach the server.");
      }
    })();
    return () => { cancelled = true; };
  }, [params, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg border border-slate-100 p-8 space-y-5">
        {status === "working" && (
          <div className="flex items-center gap-3 text-sm text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin" />
            Verifying your recovery link…
          </div>
        )}

        {status === "ok" && (
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <ShieldCheck className="w-6 h-6 text-emerald-500 mt-0.5 shrink-0" />
              <div>
                <h1 className="text-lg font-bold text-slate-900">You're back in</h1>
                <p className="text-sm text-slate-500 mt-1 leading-relaxed">
                  Two-factor authentication has been turned off on your account. Sign in with your password and re-enable it from Account → Security with a new authenticator.
                </p>
              </div>
            </div>
            <Link to="/" className="inline-flex items-center justify-center w-full bg-teal-600 hover:bg-teal-700 text-white font-semibold py-3 rounded-xl transition">
              Sign in
            </Link>
          </div>
        )}

        {(status === "expired" || status === "already_used" || status === "invalid") && (
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-amber-500 mt-0.5 shrink-0" />
              <div>
                <h1 className="text-lg font-bold text-slate-900">
                  {status === "expired" && "This recovery link has expired"}
                  {status === "already_used" && "This recovery link has already been used"}
                  {status === "invalid" && "This recovery link isn't valid"}
                </h1>
                <p className="text-sm text-slate-500 mt-1 leading-relaxed">
                  {status === "expired" && "Recovery links expire after 15 minutes for safety. Sign in and request a fresh one — we'll email you a new link right away."}
                  {status === "already_used" && "Each link works once. If you still need to recover access, head back to the sign-in page and request a new recovery email."}
                  {status === "invalid" && "Double-check the link from your email. If you copy-pasted it, you may have missed a character at the end."}
                </p>
              </div>
            </div>
            <Link to="/" className="inline-flex items-center justify-center w-full border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold py-3 rounded-xl transition">
              Back to sign-in
            </Link>
          </div>
        )}

        {status === "error" && (
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-red-500 mt-0.5 shrink-0" />
              <div>
                <h1 className="text-lg font-bold text-slate-900">Something went wrong</h1>
                <p className="text-sm text-slate-500 mt-1 leading-relaxed">
                  We couldn't verify the recovery link.
                  {errorMessage && (
                    <span className="block text-xs text-slate-400 mt-2 font-mono">{errorMessage}</span>
                  )}
                </p>
              </div>
            </div>
            <Link to="/" className="inline-flex items-center justify-center w-full border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold py-3 rounded-xl transition">
              Back to sign-in
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
