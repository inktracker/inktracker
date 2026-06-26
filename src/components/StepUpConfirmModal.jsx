import { useState, useEffect } from "react";
import { ShieldCheck, X, AlertTriangle } from "lucide-react";
import {
  isMfaEmailEnabled,
  requestMfaSignInCode,
  verifyMfaSignInCode,
  logMfaEvent,
} from "@/lib/mfa";

// Step-up auth modal for dangerous actions inside an active session.
// Unlike the sign-in MFA gate (which a trusted device can skip), step-up
// always demands a fresh 6-digit code if the user has MFA enabled —
// action-bound, not session-bound. That's the whole point: if your
// session token is stolen, an attacker still can't disconnect QB or
// delete data without inbox access.
//
// If the user does not have MFA enabled, the gate is transparent —
// onConfirm fires immediately. We don't force MFA on people who haven't
// opted in; the protection scales with the user's chosen security level.
//
// Usage:
//   <StepUpConfirmModal
//     open={showStepUp}
//     actionLabel="Disconnect QuickBooks"
//     description="This will revoke our access to your QuickBooks account."
//     onConfirm={() => doTheThing()}
//     onCancel={() => setShowStepUp(false)}
//   />

const MAX_ATTEMPTS = 5;

export default function StepUpConfirmModal({
  open,
  actionLabel,
  description,
  onConfirm,
  onCancel,
}) {
  const [phase, setPhase] = useState("checking"); // checking | sending | code | verifying | done
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [retryAfter, setRetryAfter] = useState(0);
  const [failedAttempts, setFailedAttempts] = useState(0);

  // Decide whether the user even needs to enter a code. If MFA isn't on,
  // fire onConfirm immediately — no protection to add. Runs once per
  // modal open.
  useEffect(() => {
    if (!open) {
      setPhase("checking");
      setCode("");
      setError("");
      setInfo("");
      setRetryAfter(0);
      setFailedAttempts(0);
      return;
    }
    let cancelled = false;
    (async () => {
      const r = await isMfaEmailEnabled();
      if (cancelled) return;
      if (!r.ok || !r.enabled) {
        // Transparent pass-through — no MFA on this account.
        onConfirm();
        return;
      }
      setPhase("sending");
      const send = await requestMfaSignInCode();
      if (cancelled) return;
      if (send.ok) {
        setInfo("We sent a 6-digit code to your email.");
        setRetryAfter(60);
        setPhase("code");
      } else if (send.error === "rate_limited") {
        setInfo("A recent code is still valid — check your inbox.");
        setRetryAfter(send.retryAfterSeconds || 60);
        setPhase("code");
      } else {
        setError("Couldn't send a code. Try Resend.");
        setPhase("code");
      }
    })();
    return () => { cancelled = true; };
  }, [open, onConfirm]);

  // Resend countdown.
  useEffect(() => {
    if (retryAfter <= 0) return undefined;
    const t = setTimeout(() => setRetryAfter((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [retryAfter]);

  if (!open) return null;

  // While we're checking whether MFA is on we want a brief loading
  // shell. Most users will see this for under a second.
  if (phase === "checking" || phase === "sending") {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
          <p className="text-sm text-slate-600">Checking security…</p>
        </div>
      </div>
    );
  }

  const handleVerify = async (e) => {
    e?.preventDefault?.();
    const trimmed = code.trim().replace(/\D/g, "");
    if (trimmed.length !== 6) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    setPhase("verifying");
    setError("");
    try {
      const v = await verifyMfaSignInCode(trimmed);
      if (!v.ok) {
        const next = failedAttempts + 1;
        setFailedAttempts(next);
        setCode("");
        try {
          await logMfaEvent("stepup_failed", {
            metadata: { action: actionLabel, attempt: next, reason: v.error },
          });
        } catch { /* best-effort */ }
        if (next >= MAX_ATTEMPTS) {
          setError("Too many failed attempts. Cancel and try again later.");
          setPhase("code");
          return;
        }
        if (v.error === "expired") {
          setError("That code expired. Click Resend to get a new one.");
        } else {
          setError(`Invalid code — ${MAX_ATTEMPTS - next} attempt${MAX_ATTEMPTS - next === 1 ? "" : "s"} left.`);
        }
        setPhase("code");
        return;
      }
      try {
        await logMfaEvent("stepup_passed", { metadata: { action: actionLabel } });
      } catch { /* best-effort */ }
      setPhase("done");
      onConfirm();
    } catch (err) {
      setError(err?.message || "Verification failed. Try again.");
      setPhase("code");
    }
  };

  const handleResend = async () => {
    setError("");
    setInfo("");
    const r = await requestMfaSignInCode();
    if (r.ok) {
      setInfo("New code sent.");
      setRetryAfter(60);
      return;
    }
    if (r.error === "rate_limited") {
      setRetryAfter(r.retryAfterSeconds || 60);
      setInfo("A recent code is still valid — check your inbox.");
      return;
    }
    setError(r.error || "Couldn't send a new code.");
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-teal-600" />
            <h2 className="text-base font-bold text-slate-900">Confirm: {actionLabel}</h2>
          </div>
          <button onClick={onCancel} aria-label="Close" className="text-slate-500 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {description && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800 flex gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{description}</span>
            </div>
          )}

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
                disabled={phase === "verifying"}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={onCancel}
                className="text-sm font-semibold text-slate-500 hover:text-slate-700"
              >
                Cancel
              </button>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={retryAfter > 0 || phase === "verifying"}
                  className="text-xs font-semibold text-teal-600 hover:text-teal-700 disabled:opacity-60"
                >
                  {retryAfter > 0 ? `Resend in ${retryAfter}s` : "Resend"}
                </button>
                <button
                  type="submit"
                  disabled={code.length !== 6 || phase === "verifying"}
                  className="inline-flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white font-semibold py-2 px-4 rounded-lg transition disabled:opacity-60"
                >
                  {phase === "verifying" ? "Verifying…" : "Confirm"}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
