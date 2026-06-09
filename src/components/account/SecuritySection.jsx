// Account → Security section.
//
// Renders the user's MFA controls. Walks four states (loading, idle,
// enrolling, codes, enrolled) and exposes the destructive actions
// behind a step-up code confirm so a hijacked AAL2 session can't
// silently disable MFA on its way to the QB tokens.
//
// Phase 2 shipped the enrollment flow + steady-state controls.
// Phase 4 (this iteration) layers in:
//   - Step-up code prompt before Disable + Regenerate
//   - Trusted devices list (per-device + bulk revoke)
//   - Compact recent-activity feed from mfa_audit_log
//
// All RPCs live in `src/lib/mfa.js`. Errors surface inline; the user
// never gets stuck. Best-effort audit calls don't block the UI.

import { useEffect, useState } from "react";
import { Shield, ShieldCheck, AlertTriangle, Copy, Check, Download, Loader2, Monitor, Trash2, Activity } from "lucide-react";
import { supabase } from "@/api/supabaseClient";
import {
  generateRecoveryCodes,
  logMfaEvent,
  countUnusedRecoveryCodes,
  listTrustedDevices,
  revokeTrustedDevice,
  revokeAllTrustedDevices,
  listMfaAuditEvents,
} from "@/lib/mfa";

// Map raw audit log event strings to short human-readable labels for
// the Recent Activity feed. Falls back to the event slug for any new
// event we add to the CHECK constraint but forget to label here — at
// least the operator sees something rather than nothing.
const AUDIT_EVENT_LABELS = {
  enrolled:                  "Two-factor enabled",
  disabled:                  "Two-factor disabled",
  codes_generated:           "Recovery codes generated",
  challenge_succeeded:       "Sign-in code verified",
  challenge_failed:          "Sign-in code failed",
  recovery_used:             "Recovery code used",
  recovery_failed:           "Recovery code failed",
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
  const [step, setStep] = useState("loading"); // loading | idle | enrolling | codes | enrolled
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Enrollment state
  const [factorId, setFactorId] = useState(null);
  const [challengeId, setChallengeId] = useState(null);
  const [qrCode, setQrCode] = useState(null);
  const [secret, setSecret] = useState(null);
  const [code, setCode] = useState("");

  // Recovery codes state
  const [recoveryCodes, setRecoveryCodes] = useState(null);
  const [confirmedSaved, setConfirmedSaved] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [copiedCodes, setCopiedCodes] = useState(false);

  // Enrolled state
  const [remainingCodes, setRemainingCodes] = useState(0);

  // Phase 4 — step-up code confirm for destructive actions. Active when
  // the user has clicked Disable or Regenerate; `stepUpAction` names
  // which one is being confirmed, `stepUpCode` is the 6-digit code
  // input. We mint a fresh challenge for every step-up so a successful
  // verify proves the user is in front of the keyboard RIGHT NOW.
  const [stepUpAction, setStepUpAction] = useState(null); // null | "disable" | "regenerate"
  const [stepUpChallengeId, setStepUpChallengeId] = useState(null);
  const [stepUpCode, setStepUpCode] = useState("");

  // Phase 4 — trusted devices list (Phase 3b data layer).
  const [trustedDevices, setTrustedDevices] = useState([]);
  const [devicesLoading, setDevicesLoading] = useState(false);

  // Phase 4 — compact recent activity feed from mfa_audit_log.
  const [recentEvents, setRecentEvents] = useState([]);

  // Refresh the enrolled-state side data (recovery codes, trusted
  // devices, audit feed). Called on enter to enrolled + after any
  // destructive action so the panels stay consistent.
  async function refreshEnrolledData() {
    setDevicesLoading(true);
    const [cnt, devs, events] = await Promise.all([
      countUnusedRecoveryCodes(),
      listTrustedDevices(),
      listMfaAuditEvents(8),
    ]);
    if (cnt.ok) setRemainingCodes(cnt.count);
    if (devs.ok) setTrustedDevices(devs.devices);
    if (events.ok) setRecentEvents(events.events);
    setDevicesLoading(false);
  }

  // Initial load — figure out whether the user already has a verified
  // TOTP factor. listFactors returns both pending and verified ones;
  // we only consider the verified set as "enrolled."
  useEffect(() => {
    async function load() {
      try {
        const { data, error } = await supabase.auth.mfa.listFactors();
        if (error) throw error;
        const verified = (data?.totp || []).find((f) => f.status === "verified");
        if (verified) {
          setFactorId(verified.id);
          await refreshEnrolledData();
          setStep("enrolled");
        } else {
          // Clean up any abandoned pending factors from a previous attempt.
          // Without this, a second enrollment attempt would fail because
          // Supabase Auth limits the number of unverified factors per user.
          const pending = (data?.totp || []).find((f) => f.status === "unverified");
          if (pending) {
            await supabase.auth.mfa.unenroll({ factorId: pending.id });
          }
          setStep("idle");
        }
      } catch (e) {
        setError(e?.message || "Couldn't load MFA status");
        setStep("idle");
      }
    }
    load();
  }, []);

  async function startEnrollment() {
    setBusy(true);
    setError("");
    try {
      const { data: enrollData, error: enrollErr } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `InkTracker (${new Date().toISOString().slice(0, 10)})`,
      });
      if (enrollErr) throw enrollErr;
      setFactorId(enrollData.id);
      setQrCode(enrollData.totp?.qr_code || null);
      setSecret(enrollData.totp?.secret || null);

      const { data: chData, error: chErr } = await supabase.auth.mfa.challenge({
        factorId: enrollData.id,
      });
      if (chErr) throw chErr;
      setChallengeId(chData.id);
      setStep("enrolling");
    } catch (e) {
      setError(e?.message || "Couldn't start enrollment");
    } finally {
      setBusy(false);
    }
  }

  async function cancelEnrollment() {
    if (!factorId) {
      resetEnrollState();
      setStep("idle");
      return;
    }
    setBusy(true);
    try {
      await supabase.auth.mfa.unenroll({ factorId });
    } finally {
      resetEnrollState();
      setStep("idle");
      setBusy(false);
    }
  }

  function resetEnrollState() {
    setFactorId(null);
    setChallengeId(null);
    setQrCode(null);
    setSecret(null);
    setCode("");
    setError("");
  }

  async function verifyCode(e) {
    e?.preventDefault?.();
    const trimmed = code.trim().replace(/\s+/g, "");
    if (trimmed.length !== 6 || !/^\d{6}$/.test(trimmed)) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { error: verifyErr } = await supabase.auth.mfa.verify({
        factorId,
        challengeId,
        code: trimmed,
      });
      if (verifyErr) throw verifyErr;

      // Generate the recovery codes BEFORE invalidating other sessions.
      // If session invalidation accidentally signs us out (it shouldn't
      // — `scope: 'others'` keeps the current one), the user would
      // never see the codes.
      const gen = await generateRecoveryCodes();
      if (!gen.ok) throw new Error(gen.error || "Couldn't generate recovery codes");
      setRecoveryCodes(gen.codes);

      // Audit + force re-login on other devices. Best-effort: a
      // logging or signOut failure shouldn't block enrollment success.
      await logMfaEvent("enrolled", { metadata: { factor_id: factorId } });
      try {
        await supabase.auth.signOut({ scope: "others" });
        await logMfaEvent("session_invalidated");
      } catch { /* ignore */ }

      setStep("codes");
    } catch (e) {
      setError(e?.message || "Invalid code — try again.");
    } finally {
      setBusy(false);
    }
  }

  function finishEnrollment() {
    setStep("enrolled");
    resetEnrollState();
    setRecoveryCodes(null);
    setConfirmedSaved(false);
    countUnusedRecoveryCodes().then((r) => {
      if (r.ok) setRemainingCodes(r.count);
    });
  }

  function downloadCodes() {
    if (!recoveryCodes?.length) return;
    const blob = new Blob(
      [`InkTracker recovery codes (generated ${new Date().toISOString()})\n\n${recoveryCodes.join("\n")}\n`],
      { type: "text/plain" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "inktracker-recovery-codes.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function copyToClipboard(text, kind) {
    try {
      await navigator.clipboard.writeText(text);
      if (kind === "secret") {
        setCopiedSecret(true);
        setTimeout(() => setCopiedSecret(false), 2000);
      }
      if (kind === "codes") {
        setCopiedCodes(true);
        setTimeout(() => setCopiedCodes(false), 2000);
      }
    } catch {
      setError("Clipboard copy failed — write the value down manually.");
    }
  }

  // Open the step-up panel for a destructive action. Mints a fresh
  // challenge against the current factor; the user must enter a valid
  // 6-digit code before the action runs. Mirrors GitHub / Stripe — an
  // AAL2 session alone isn't enough to disable security settings.
  async function startStepUp(action) {
    setError("");
    setStepUpCode("");
    setBusy(true);
    try {
      const { data, error: chErr } = await supabase.auth.mfa.challenge({ factorId });
      if (chErr) throw chErr;
      setStepUpChallengeId(data.id);
      setStepUpAction(action);
    } catch (e) {
      setError(e?.message || "Couldn't start verification");
    } finally {
      setBusy(false);
    }
  }

  function cancelStepUp() {
    setStepUpAction(null);
    setStepUpChallengeId(null);
    setStepUpCode("");
    setError("");
  }

  async function runStepUpAction(e) {
    e?.preventDefault?.();
    const trimmed = stepUpCode.trim().replace(/\s+/g, "");
    if (!/^\d{6}$/.test(trimmed)) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      // Verify the fresh code. Success is the "I'm here right now" proof
      // we need before running anything destructive.
      const { error: verifyErr } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: stepUpChallengeId,
        code: trimmed,
      });
      if (verifyErr) throw verifyErr;

      if (stepUpAction === "disable") {
        const { error: unenrollErr } = await supabase.auth.mfa.unenroll({ factorId });
        if (unenrollErr) throw unenrollErr;
        try { await logMfaEvent("disabled"); } catch { /* ignore */ }
        resetEnrollState();
        setRemainingCodes(0);
        setTrustedDevices([]);
        setRecentEvents([]);
        cancelStepUp();
        setStep("idle");
      } else if (stepUpAction === "regenerate") {
        const gen = await generateRecoveryCodes();
        if (!gen.ok) throw new Error(gen.error);
        setRecoveryCodes(gen.codes);
        setConfirmedSaved(false);
        cancelStepUp();
        setStep("codes");
      }
    } catch (e) {
      setError(e?.message || "Invalid code — try again.");
      setStepUpCode("");
    } finally {
      setBusy(false);
    }
  }

  // Trusted-device controls (Phase 4 — data layer from Phase 3b).

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

  // ─── Render ──────────────────────────────────────────────────────

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

      {step === "idle" && (
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <Shield className="w-5 h-5 text-slate-400 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-slate-700">Two-factor authentication is off</div>
              <p className="text-xs text-slate-400 mt-1">
                MFA protects your QuickBooks connection, customer data, and shop operations from a phished password. Use any authenticator app — Google Authenticator, Authy, 1Password, etc.
              </p>
            </div>
          </div>
          <button
            onClick={startEnrollment}
            disabled={busy}
            className="text-xs font-semibold px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-50 transition"
          >
            {busy ? "Loading…" : "Enable two-factor authentication"}
          </button>
        </div>
      )}

      {step === "enrolling" && (
        <div className="space-y-4">
          <div className="text-sm font-semibold text-slate-700">
            Scan this QR code with your authenticator app
          </div>
          {qrCode && (
            <div className="flex items-start gap-4">
              {/* Supabase returns the QR as a data URI (SVG inlined). */}
              <img src={qrCode} alt="MFA QR code" className="w-44 h-44 border border-slate-200 rounded-lg bg-white p-2" />
              <div className="flex-1 space-y-2">
                <div className="text-xs text-slate-400">Or enter this key manually:</div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs bg-slate-100 px-2 py-1.5 rounded font-mono break-all">{secret}</code>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(secret, "secret")}
                    className="text-xs text-slate-500 hover:text-teal-600 transition flex items-center gap-1"
                    title="Copy key"
                  >
                    {copiedSecret ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedSecret ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
            </div>
          )}
          <form onSubmit={verifyCode} className="space-y-2">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block">
              Enter the 6-digit code from your app
            </label>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="123456"
              className="w-40 text-base font-mono border border-slate-200 rounded-lg px-3 py-2 tracking-widest focus:outline-none focus:ring-2 focus:ring-teal-300"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={busy || code.length !== 6}
                className="text-xs font-semibold px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-50 transition"
              >
                {busy ? "Verifying…" : "Verify and continue"}
              </button>
              <button
                type="button"
                onClick={cancelEnrollment}
                disabled={busy}
                className="text-xs font-semibold px-4 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 transition"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {step === "codes" && recoveryCodes && (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-emerald-500 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-slate-700">
                Save your recovery codes
              </div>
              <p className="text-xs text-slate-400 mt-1">
                If you lose access to your authenticator app, these single-use codes are how you sign back in. Save them somewhere safe — a password manager, a printed copy in a drawer, or both. <strong>This is the only time we'll show them.</strong>
              </p>
            </div>
          </div>
          <div className="border border-slate-200 rounded-lg bg-slate-50 p-3 grid grid-cols-2 gap-x-6 gap-y-1.5 font-mono text-sm">
            {recoveryCodes.map((c) => (
              <div key={c} className="text-slate-700">{c}</div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={downloadCodes}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 transition flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              Download .txt
            </button>
            <button
              onClick={() => copyToClipboard(recoveryCodes.join("\n"), "codes")}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 transition flex items-center gap-1.5"
            >
              {copiedCodes ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedCodes ? "Copied" : "Copy all"}
            </button>
          </div>
          <label className="flex items-start gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={confirmedSaved}
              onChange={(e) => setConfirmedSaved(e.target.checked)}
              className="mt-0.5"
            />
            <span>I've saved my recovery codes somewhere safe.</span>
          </label>
          <button
            onClick={finishEnrollment}
            disabled={!confirmedSaved}
            className="text-xs font-semibold px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-50 transition"
          >
            Finish setup
          </button>
        </div>
      )}

      {step === "enrolled" && (
        <div className="space-y-6">
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-emerald-500 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-slate-700">
                Two-factor authentication is on
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Your account is protected. You have{" "}
                <strong>{remainingCodes}</strong>{" "}
                recovery code{remainingCodes === 1 ? "" : "s"} remaining.
                {remainingCodes <= 2 && remainingCodes > 0 && (
                  <span className="text-amber-600"> Consider regenerating soon.</span>
                )}
                {remainingCodes === 0 && (
                  <span className="text-red-600"> Regenerate now — you have no recovery codes left.</span>
                )}
              </p>
            </div>
          </div>

          {/* Step-up confirm panel — shown when the user clicks Disable
              or Regenerate. They have to enter a fresh 6-digit code,
              even though they're already at AAL2. Industry-standard
              "sudo mode" pattern. */}
          {stepUpAction ? (
            <form
              onSubmit={runStepUpAction}
              className="border border-amber-200 bg-amber-50 rounded-lg p-3 space-y-3"
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                <div className="text-xs text-amber-800">
                  {stepUpAction === "disable" ? (
                    <>
                      <strong>Confirm: turn off two-factor authentication.</strong> Your account will be protected by password alone after this.
                    </>
                  ) : (
                    <>
                      <strong>Confirm: regenerate recovery codes.</strong> Your current codes will stop working immediately — you'll need to save the new ones.
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={stepUpCode}
                  onChange={(e) => setStepUpCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="123456"
                  className="w-32 text-sm font-mono tracking-widest border border-amber-300 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-300"
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={busy || stepUpCode.length !== 6}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-md text-white transition disabled:opacity-50 ${
                    stepUpAction === "disable"
                      ? "bg-red-600 hover:bg-red-700"
                      : "bg-amber-600 hover:bg-amber-700"
                  }`}
                >
                  {busy ? "Verifying…" : stepUpAction === "disable" ? "Confirm disable" : "Confirm regenerate"}
                </button>
                <button
                  type="button"
                  onClick={cancelStepUp}
                  disabled={busy}
                  className="text-xs font-semibold px-3 py-1.5 rounded-md border border-slate-200 hover:bg-slate-50 text-slate-600 transition disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => startStepUp("regenerate")}
                disabled={busy}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 transition disabled:opacity-50"
              >
                Regenerate recovery codes
              </button>
              <button
                onClick={() => startStepUp("disable")}
                disabled={busy}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-red-200 hover:bg-red-50 text-red-600 transition disabled:opacity-50"
              >
                Disable two-factor
              </button>
            </div>
          )}

          {/* Trusted devices — Phase 4 surfaces the table populated by
              Phase 3b. Always shows the section; an empty list reads
              as "no remembered browsers" instead of hiding the UI. */}
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
                No remembered devices. When you check "Remember this device for 30 days" at sign-in, the browser shows up here.
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

          {/* Recent activity — compact view into mfa_audit_log. Gives
              the shop owner a fast sanity check on whether anything
              weird has happened. */}
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
