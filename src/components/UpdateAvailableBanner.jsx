// Non-blocking banner that appears when a stale-chunk error is detected.
// Mounts itself once, listens for the chunk handler signal, and offers reload.

import { useEffect, useState } from "react";
import { installChunkErrorHandler } from "@/lib/chunkErrorHandler";

// Sticky-dismiss key. Once the user clicks Dismiss in a session, every
// subsequent stale-chunk error in the same tab is suppressed. They
// already saw the prompt and chose to ignore it — re-prompting on each
// new failed dynamic import feels like nagging. They can still refresh
// manually any time. The flag clears on tab close (sessionStorage).
const DISMISS_KEY = "updateBanner:dismissed";

export default function UpdateAvailableBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    installChunkErrorHandler(() => {
      try {
        if (sessionStorage.getItem(DISMISS_KEY) === "1") return;
      } catch { /* private mode / disabled storage — fall through to show */ }
      setShow(true);
    });
  }, []);

  function dismiss() {
    try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch {}
    setShow(false);
  }

  if (!show) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[400] max-w-sm bg-slate-900 text-white rounded-2xl shadow-2xl border border-slate-700 p-4 flex items-start gap-3"
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold">A new version is available</div>
        <div className="text-xs text-slate-300 mt-0.5">
          Refresh to load the latest update — your work is saved.
        </div>
      </div>
      <div className="flex flex-col gap-1 shrink-0">
        <button
          onClick={() => window.location.reload()}
          className="px-3 py-1.5 text-xs font-bold bg-teal-500 hover:bg-teal-400 text-white rounded-lg transition"
        >
          Refresh
        </button>
        <button
          onClick={dismiss}
          className="px-3 py-1 text-xs text-slate-500 hover:text-slate-200 transition"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
