import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

// Bottom-of-screen consent strip with Accept / Decline.
//
// What InkTracker actually uses today (per /privacy § 7):
//   - Essential cookies: Supabase auth session, Stripe checkout. These
//     are required for the app to work and are exempt from consent
//     under GDPR/CCPA — Decline does NOT prevent them.
//   - No analytics, marketing, or third-party tracking.
//
// What the Decline button actually does TODAY:
//   - Persists the user's choice so we don't re-prompt.
//   - Sets a localStorage flag (cookieConsent === "rejected") that any
//     FUTURE non-essential cookie loader (analytics, A/B test, etc.)
//     must check via `hasNonEssentialConsent()` before firing.
//
// The honest framing on the banner explains this — "essential cookies
// only" + "your preference is saved for any future analytics." We don't
// pretend there's a choice today that there isn't, but we wire the
// infrastructure so adding analytics later doesn't require a re-prompt
// of users who already declined.
//
// Versioned storage key (`v1`) so a future material change to what
// cookies we use can re-prompt by bumping the suffix.

const STORAGE_KEY = "inktracker.cookieConsent.v1";

/**
 * Public helper for future analytics/marketing cookie loaders. They MUST
 * call this before firing any non-essential cookie. Returns:
 *   - true  → user accepted (load non-essential cookies)
 *   - false → user declined OR hasn't chosen yet (don't load)
 * No exposed value for "pending" — being conservative on pending is
 * the right default for cookie law compliance.
 */
export function hasNonEssentialConsent() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "accepted";
  } catch {
    return false;
  }
}

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);

  // Render-after-mount to dodge any SSR-style hydration mismatch (Vite
  // SPA today, but cheap hedge). Also catches localStorage access
  // failures (private browsing / consent extensions) so the app
  // doesn't crash.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      // Re-prompt anyone who isn't in the new explicit "accepted"/"rejected"
      // state. The previous version of this component stored an ISO
      // timestamp on dismiss (single "Got it" button, no real choice) —
      // those users get one fresh prompt with the real Accept/Decline.
      if (stored !== "accepted" && stored !== "rejected") setVisible(true);
    } catch {
      // localStorage blocked. Showing the banner adds zero value when
      // we can't persist the choice — it'd reappear forever.
    }
  }, []);

  function persistChoice(choice) {
    try {
      window.localStorage.setItem(STORAGE_KEY, choice);
    } catch {}
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Cookie notice"
      className="fixed bottom-0 left-0 right-0 z-[70] p-3 sm:p-4 pointer-events-none"
    >
      <div className="max-w-3xl mx-auto bg-slate-900 text-white rounded-2xl shadow-2xl border border-slate-800 px-4 py-3 sm:px-5 sm:py-4 flex flex-col sm:flex-row sm:items-center gap-3 pointer-events-auto">
        <div className="flex-1 min-w-0 text-xs sm:text-sm leading-relaxed">
          <p className="font-semibold mb-0.5">We use cookies</p>
          <p className="text-slate-300">
            Essential cookies keep you signed in and process payments. We
            don't use analytics or marketing trackers today — your choice
            below is saved in case we add any later.{" "}
            <Link
              to="/privacy"
              className="underline underline-offset-2 hover:text-teal-300"
            >
              Privacy policy
            </Link>
            .
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => persistChoice("rejected")}
            className="text-xs sm:text-sm font-semibold text-slate-200 border border-slate-600 hover:bg-slate-800 px-4 py-2 rounded-xl transition"
          >
            Decline
          </button>
          <button
            onClick={() => persistChoice("accepted")}
            className="text-xs sm:text-sm font-semibold bg-teal-600 hover:bg-teal-500 text-white px-4 py-2 rounded-xl transition"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
