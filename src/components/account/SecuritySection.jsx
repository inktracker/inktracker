// Account → Security section.
//
// Phase 2 of the MFA rollout. Renders the TOTP enrollment flow on top
// of Supabase Auth's native MFA API plus our recovery-code RPCs (see
// `src/lib/mfa.js`). What this ships:
//
//   - "Enable two-factor authentication" entry point when no factor
//     exists.
//   - QR-code + manual-secret pane the user scans with an authenticator
//     app.
//   - 6-digit verify step (calls `supabase.auth.mfa.verify`).
//   - On verify success: generate 10 recovery codes via the RPC,
//     display them ONCE with download + copy, require an explicit
//     "I've saved these" confirmation before closing the panel.
//   - Force-signout of other active sessions immediately after
//     enrollment (so a stolen pre-MFA session token can't bypass).
//   - Steady-state "enrolled" view: shows recovery codes remaining,
//     regenerate button, and a Disable button.
//
// What is NOT in Phase 2 (intentionally):
//   - Sign-in challenge flow. After this PR ships, a user can enroll
//     in MFA — but logging out and back in won't yet prompt for the
//     6-digit code. That's Phase 3. Until then, MFA is enrollment-
//     ready but not enforcement-active.
//
// Errors fall back to user-readable messages. Network / RPC failures
// surface inline; the user never gets stuck.

import { useEffect, useState } from "react";
import { Shield, ShieldCheck, AlertTriangle, Copy, Check, Download, Loader2 } from "lucide-react";
import { supabase } from "@/api/supabaseClient";
import {
  generateRecoveryCodes,
  logMfaEvent,
  countUnusedRecoveryCodes,
} from "@/lib/mfa";

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
          const cnt = await countUnusedRecoveryCodes();
          if (cnt.ok) setRemainingCodes(cnt.count);
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

  async function regenerateCodes() {
    if (!window.confirm(
      "Regenerate recovery codes? Your current codes will stop working immediately. You'll need to save the new ones."
    )) return;
    setBusy(true);
    setError("");
    try {
      const gen = await generateRecoveryCodes();
      if (!gen.ok) throw new Error(gen.error);
      setRecoveryCodes(gen.codes);
      setConfirmedSaved(false);
      setStep("codes");
    } catch (e) {
      setError(e?.message || "Couldn't regenerate codes");
    } finally {
      setBusy(false);
    }
  }

  async function disableMfa() {
    if (!window.confirm(
      "Disable two-factor authentication? Your account will be protected by password alone after this."
    )) return;
    setBusy(true);
    setError("");
    try {
      const { error: unenrollErr } = await supabase.auth.mfa.unenroll({ factorId });
      if (unenrollErr) throw unenrollErr;
      await logMfaEvent("disabled");
      resetEnrollState();
      setRemainingCodes(0);
      setStep("idle");
    } catch (e) {
      setError(e?.message || "Couldn't disable MFA");
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
        <div className="space-y-4">
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
          <div className="flex flex-wrap gap-2">
            <button
              onClick={regenerateCodes}
              disabled={busy}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 transition disabled:opacity-50"
            >
              Regenerate recovery codes
            </button>
            <button
              onClick={disableMfa}
              disabled={busy}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-red-200 hover:bg-red-50 text-red-600 transition disabled:opacity-50"
            >
              Disable two-factor
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
