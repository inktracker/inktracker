// Account → Security section.
//
// Email-based MFA: a single toggle. Enabling sends a test code to the
// user's email; entering the code correctly flips
// profiles.mfa_email_enabled to true. From that point on, sign-ins
// from non-trusted browsers require a fresh code from the email.
//
// Disabling is a one-click confirm — the user is already authenticated
// in this session.
//
// Trusted-device list and recent-activity feed are kept (still useful
// regardless of the MFA flavor).

import { useEffect, useState } from "react";
import { Shield, ShieldCheck, AlertTriangle, Loader2, Monitor, Trash2, Activity, ArrowRight } from "lucide-react";
import {
  isMfaEmailEnabled,
  enableMfaEmail,
  disableMfaEmail,
  requestMfaSignInCode,
  verifyMfaSignInCode,
  logMfaEvent,
  listMfaAuditEvents,
  listTrustedDevices,
  revokeTrustedDevice,
  revokeAllTrustedDevices,
} from "@/lib/mfa";

// Map raw audit-log event strings to short labels for Recent Activity.
const AUDIT_EVENT_LABELS = {
  mfa_enabled:               "Two-factor enabled",
  mfa_disabled:              "Two-factor disabled",
  signin_code_requested:     "Sign-in code emailed",
  signin_code_verified:      "Sign-in code verified",
  signin_code_failed:        "Sign-in code failed",
  signin_code_expired:       "Sign-in code expired",
  lockout:                   "Locked out (too many attempts)",
  session_invalidated:       "Other sessions signed out",
  trusted_device_registered: "Device remembered",
  trusted_device_used:       "Trusted device sign-in",
  trusted_device_revoked:    "Trusted device revoked",
};
function formatAuditEvent(event) {
  return AUDIT_EVENT_LABELS[event] || event;
}

export default function SecuritySection() {
  // loading | off | enabling | on | disabling
  //   off      → "Enable" button + status copy
  //   enabling → "Check your email, enter the code we sent" + 6-digit input
  //   on       → status copy + Disable button + trusted devices + activity
  //   disabling → confirm-only state, brief, then back to off
  const [step, setStep] = useState("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [code, setCode] = useState("");
  const [retryAfter, setRetryAfter] = useState(0);

  const [trustedDevices, setTrustedDevices] = useState([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [recentEvents, setRecentEvents] = useState([]);

  async function refreshEnabledData() {
    setDevicesLoading(true);
    const [devs, events] = await Promise.all([
      listTrustedDevices(),
      listMfaAuditEvents(8),
    ]);
    if (devs.ok) setTrustedDevices(devs.devices);
    if (events.ok) setRecentEvents(events.events);
    setDevicesLoading(false);
  }

  useEffect(() => {
    (async () => {
      const r = await isMfaEmailEnabled();
      if (r.ok && r.enabled) {
        await refreshEnabledData();
        setStep("on");
      } else {
        setStep("off");
      }
    })();
  }, []);

  // Countdown tick for the retry-after timer.
  useEffect(() => {
    if (retryAfter <= 0) return;
    const t = setTimeout(() => setRetryAfter((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [retryAfter]);

  async function startEnableFlow() {
    setError("");
    setCode("");
    setBusy(true);
    try {
      const r = await requestMfaSignInCode();
      if (r.ok) {
        setStep("enabling");
      } else if (r.error === "rate_limited") {
        setRetryAfter(r.retryAfterSeconds || 60);
        setStep("enabling");
      } else {
        setError(r.error || "Couldn't send the verification code.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function resendDuringEnable() {
    setError("");
    setBusy(true);
    try {
      const r = await requestMfaSignInCode();
      if (r.ok) {
        setRetryAfter(60);
      } else if (r.error === "rate_limited") {
        setRetryAfter(r.retryAfterSeconds || 60);
      } else {
        setError(r.error || "Couldn't send a new code.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnable(e) {
    e?.preventDefault?.();
    const trimmed = code.trim().replace(/\D/g, "");
    if (trimmed.length !== 6) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const v = await verifyMfaSignInCode(trimmed);
      if (!v.ok) {
        if (v.error === "expired") {
          setError("That code expired. Resend a fresh one.");
        } else {
          setError("That code didn't match — try again or resend.");
        }
        setCode("");
        return;
      }
      const en = await enableMfaEmail();
      if (!en.ok) {
        setError(en.error || "Couldn't turn on MFA after verifying. Try again.");
        return;
      }
      await refreshEnabledData();
      setCode("");
      setStep("on");
    } finally {
      setBusy(false);
    }
  }

  function cancelEnable() {
    setStep("off");
    setCode("");
    setError("");
    setRetryAfter(0);
  }

  async function startDisable() {
    if (!window.confirm(
      "Turn off two-factor authentication? Your account will be protected by password alone after this."
    )) return;
    setBusy(true);
    setError("");
    try {
      const r = await disableMfaEmail();
      if (!r.ok) {
        setError(r.error || "Couldn't disable MFA.");
        return;
      }
      setStep("off");
      setTrustedDevices([]);
      setRecentEvents([]);
    } finally {
      setBusy(false);
    }
  }

  async function handleRevokeDevice(id) {
    setBusy(true);
    setError("");
    try {
      const r = await revokeTrustedDevice(id);
      if (!r.ok) throw new Error(r.error);
      setTrustedDevices((prev) => prev.filter((d) => d.id !== id));
    } catch (e) {
      setError(e?.message || "Couldn't revoke device");
    } finally {
      setBusy(false);
    }
  }

  async function handleRevokeAllDevices() {
    if (!window.confirm(
      "Revoke every trusted device? Every browser you've previously remembered (including this one) will have to verify with a code on the next sign-in."
    )) return;
    setBusy(true);
    setError("");
    try {
      const r = await revokeAllTrustedDevices();
      if (!r.ok) throw new Error(r.error);
      setTrustedDevices([]);
    } catch (e) {
      setError(e?.message || "Couldn't revoke devices");
    } finally {
      setBusy(false);
    }
  }

  // ─── Render ─────────────────────────────────────────────────────

  if (step === "loading") {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-400">
        <Loader2 className="w-4 h-4 animate-spin" />
        Checking MFA status…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="flex items-start gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {step === "off" && (
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <Shield className="w-5 h-5 text-slate-400 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-slate-700">Two-factor authentication is off</div>
              <p className="text-xs text-slate-400 mt-1">
                When on, signing in from a new browser will email you a 6-digit code that you'll enter to finish signing in. Catches phished passwords — attacker needs your email too.
              </p>
            </div>
          </div>
          <button
            onClick={startEnableFlow}
            disabled={busy}
            className="text-xs font-semibold px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-50 transition"
          >
            {busy ? "Sending code…" : "Enable two-factor authentication"}
          </button>
        </div>
      )}

      {step === "enabling" && (
        <form onSubmit={confirmEnable} className="space-y-4 border border-amber-200 bg-amber-50 rounded-lg p-4">
          <div className="flex items-start gap-2 text-sm text-amber-900">
            <ShieldCheck className="w-5 h-5 mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold">Check your email for a 6-digit code</div>
              <p className="text-xs mt-1 leading-relaxed">
                We sent a code to your account email. Enter it below to confirm — we want to make sure you can receive sign-in codes before we turn this on.
              </p>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-amber-900 mb-1">
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
              className="w-40 px-3 py-2 border border-amber-300 rounded-md text-base font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-amber-300"
              autoFocus
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={busy || code.length !== 6}
              className="text-xs font-semibold px-4 py-2 rounded-md bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50 transition"
            >
              {busy ? "Verifying…" : "Confirm and enable"}
            </button>
            <button
              type="button"
              onClick={resendDuringEnable}
              disabled={busy || retryAfter > 0}
              className="text-xs font-semibold px-3 py-2 rounded-md border border-amber-300 hover:bg-amber-100 text-amber-800 disabled:opacity-50 transition"
            >
              {retryAfter > 0 ? `Resend code (${retryAfter}s)` : "Resend code"}
            </button>
            <button
              type="button"
              onClick={cancelEnable}
              disabled={busy}
              className="text-xs font-semibold px-3 py-2 rounded-md border border-slate-200 hover:bg-slate-50 text-slate-600 disabled:opacity-50 transition"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {step === "on" && (
        <div className="space-y-6">
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-emerald-500 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-slate-700">Two-factor authentication is on</div>
              <p className="text-xs text-slate-400 mt-1">
                Sign-ins from new browsers ask you for a 6-digit code we email you. Trusted browsers below skip the code for 30 days.
              </p>
            </div>
          </div>

          <div>
            <button
              onClick={startDisable}
              disabled={busy}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-red-200 hover:bg-red-50 text-red-600 transition disabled:opacity-50"
            >
              Disable two-factor
            </button>
          </div>

          {/* Trusted devices — Phase 3b. */}
          <div className="border-t border-slate-200 pt-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Monitor className="w-4 h-4 text-slate-400" />
                <div className="text-sm font-semibold text-slate-700">Remembered devices</div>
              </div>
              {trustedDevices.length > 0 && (
                <button
                  onClick={handleRevokeAllDevices}
                  disabled={busy}
                  className="text-xs font-semibold text-red-600 hover:text-red-700 transition disabled:opacity-50"
                >
                  Revoke all
                </button>
              )}
            </div>
            {devicesLoading ? (
              <div className="text-xs text-slate-400 flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" /> Loading…
              </div>
            ) : trustedDevices.length === 0 ? (
              <p className="text-xs text-slate-400">
                No remembered devices. Check "Remember this browser for 30 days" at sign-in to skip the code on this browser next time.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {trustedDevices.map((d) => (
                  <li
                    key={d.id}
                    className="flex items-center justify-between gap-3 text-xs border border-slate-200 rounded-lg px-3 py-2"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-slate-700 truncate">
                        {d.device_label || "Unknown device"}
                      </div>
                      <div className="text-slate-400 mt-0.5">
                        {d.last_used_at
                          ? `Last used ${new Date(d.last_used_at).toLocaleDateString()}`
                          : "Never used"}
                        {" · "}Expires {new Date(d.expires_at).toLocaleDateString()}
                      </div>
                    </div>
                    <button
                      onClick={() => handleRevokeDevice(d.id)}
                      disabled={busy}
                      className="text-slate-400 hover:text-red-600 transition disabled:opacity-50"
                      title="Revoke this device"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {recentEvents.length > 0 && (
            <div className="border-t border-slate-200 pt-5 space-y-2">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-slate-400" />
                <div className="text-sm font-semibold text-slate-700">Recent activity</div>
              </div>
              <ul className="text-xs text-slate-500 space-y-1">
                {recentEvents.map((ev, idx) => (
                  <li key={idx} className="flex items-center justify-between gap-3">
                    <span className="font-mono">{formatAuditEvent(ev.event)}</span>
                    <span className="text-slate-400">
                      {new Date(ev.created_at).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
