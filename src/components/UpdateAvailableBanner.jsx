// Non-blocking banner that appears when a stale-chunk error is detected.
// Mounts itself once, listens for the chunk handler signal, and offers reload.

import { useEffect, useState } from "react";
import { installChunkErrorHandler } from "@/lib/chunkErrorHandler";

export default function UpdateAvailableBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    installChunkErrorHandler(() => setShow(true));
  }, []);

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
          className="px-3 py-1.5 text-xs font-bold bg-indigo-500 hover:bg-indigo-400 text-white rounded-lg transition"
        >
          Refresh
        </button>
        <button
          onClick={() => setShow(false)}
          className="px-3 py-1 text-xs text-slate-400 hover:text-slate-200 transition"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
