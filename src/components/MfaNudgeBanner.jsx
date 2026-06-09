// Dashboard nudge banner — Phase 5 of the MFA rollout.
//
// Shows a dismissible "your account isn't protected by MFA yet" banner
// at the top of the Dashboard for any logged-in user who hasn't
// enrolled a TOTP factor. Clicking the CTA routes them to
// Account → Security where the Phase 2 enrollment flow lives.
//
// Dismissal model:
//   - Closing the banner sets a localStorage timestamp.
//   - The banner stays hidden for 7 days from that dismissal, then
//     reappears (we want the prompt to come back; a permanent dismiss
//     defeats the point).
//   - Once the user enrolls, the banner is automatically gone — the
//     enrollment check beats the dismiss check.
//
// We deliberately do NOT show a loading state. If the auth check is
// in flight on first paint we just render nothing; the banner appears
// after the round-trip completes. A loading spinner on the dashboard
// for an off-by-default UX prompt is worse than a half-second delay.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Shield, X, ArrowRight } from "lucide-react";
import { supabase } from "@/api/supabaseClient";

const DISMISS_STORAGE_KEY = "inktracker_mfa_nudge_dismissed_at";
const DISMISS_REPROMPT_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function getDismissedAt() {
  try {
    if (typeof localStorage === "undefined") return 0;
    return Number(localStorage.getItem(DISMISS_STORAGE_KEY)) || 0;
  } catch {
    return 0;
  }
}

function isWithinDismissWindow() {
  const at = getDismissedAt();
  if (!at) return false;
  return Date.now() - at < DISMISS_REPROMPT_MS;
}

export default function MfaNudgeBanner() {
  // "hidden" covers both "still loading" and "dismissed / enrolled."
  // We never reveal the banner unless we've confirmed (a) no verified
  // TOTP factor exists, and (b) the user hasn't dismissed in the last
  // 7 days.
  const [show, setShow] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      // Fast bail — dismissed recently.
      if (isWithinDismissWindow()) return;
      try {
        const { data, error } = await supabase.auth.mfa.listFactors();
        if (error) return; // anonymous wizard / signed-out — don't show.
        const verified = (data?.totp || []).some((f) => f.status === "verified");
        if (!cancelled && !verified) setShow(true);
      } catch {
        // Network / config issue — hide silently rather than nag with
        // a possibly-incorrect prompt.
      }
    }
    check();
    return () => { cancelled = true; };
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_STORAGE_KEY, String(Date.now()));
    } catch { /* ignore */ }
    setShow(false);
  }

  if (!show) return null;

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
      <Shield className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-amber-900">
          Your account isn't protected by two-factor authentication
        </div>
        <p className="text-xs text-amber-800 mt-1 leading-relaxed">
          MFA shields your QuickBooks connection, customer data, and shop operations from a phished password. Takes about 60 seconds with any authenticator app.
        </p>
        <Link
          to="/Account?section=security"
          className="inline-flex items-center gap-1 mt-2 text-xs font-semibold text-amber-900 hover:text-amber-700 transition"
        >
          Enable two-factor authentication
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
      <button
        onClick={dismiss}
        className="text-amber-500 hover:text-amber-700 transition shrink-0"
        title="Remind me later"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
