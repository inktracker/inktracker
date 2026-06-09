import { useEffect, useState } from "react";
import { captureException } from "@/lib/sentry";

// Verification page. Visiting /sentry-test fires a fresh captureException
// call with a unique timestamp message and shows immediate confirmation
// in the UI. Use this to confirm end-to-end Sentry capture from a device
// that doesn't have tracking-protection / ad-blocking turned on (phones,
// fresh browser profiles, etc.).
//
// Keep this route around — it's harmless (no PII, no side effects beyond
// one Sentry event per visit) and gives Joe a re-runnable smoke test
// for the next time Sentry changes or the DSN gets rotated.

export default function SentryTest() {
  const [sentAt, setSentAt] = useState(null);
  const [unique, setUnique] = useState("");

  useEffect(() => {
    const stamp = new Date().toISOString();
    const id = Math.random().toString(36).slice(2, 8);
    const tag = `${stamp} (${id})`;
    setUnique(tag);
    try {
      captureException(new Error(`Sentry verification ping — ${tag}`));
      setSentAt(stamp);
    } catch {
      setSentAt(null);
    }
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 max-w-md w-full p-6 space-y-4">
        <h1 className="text-lg font-bold text-slate-900">Sentry verification</h1>
        <p className="text-sm text-slate-600 leading-relaxed">
          This page fires one captured exception each time it loads. Use it to confirm Sentry capture is working from a device without an ad-blocker.
        </p>
        {sentAt ? (
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 space-y-1">
            <div className="text-sm font-semibold text-emerald-800">Event sent</div>
            <div className="text-xs text-emerald-700 font-mono break-all">{unique}</div>
            <p className="text-xs text-emerald-700 mt-2">
              Open the Sentry dashboard and look for the message starting with <strong>"Sentry verification ping"</strong> — should land within 30 seconds.
            </p>
          </div>
        ) : (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
            Sentry SDK not initialized (no VITE_SENTRY_DSN at build time). Nothing was sent.
          </div>
        )}
        <p className="text-xs text-slate-400">
          Reload the page to send another event. Each visit generates a unique tag so duplicates can't collapse them into one issue.
        </p>
      </div>
    </div>
  );
}
