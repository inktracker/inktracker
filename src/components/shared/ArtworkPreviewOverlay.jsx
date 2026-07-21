// Full-screen artwork viewer rendered via portal. Keeps the user in
// the app instead of bouncing to a new browser tab — they hit Back and
// they're right back wherever they came from. PDFs and images render
// natively; anything else falls back to a download.
//
// Used by OrderDetailModal, ShopFloor, and (eventually) any other
// surface that lists artwork.
//
// Props:
//   art      — { name, url|file_url, path? }. `path` is preferred so
//              the URL can be re-signed against the artwork bucket.
//   onClose  — invoked when the user dismisses (Back button).
//   backLabel— optional override for the Back button text. Defaults
//              to "Back" — callers like OrderDetailModal pass
//              "Back to order".

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Download, Loader2, FileText } from "lucide-react";
import { signArtworkUrl } from "@/lib/uploadFile";
import { probeUrl } from "@/lib/artwork/urlReachable";
import { useModalA11y } from "@/lib/useModalA11y";

export default function ArtworkPreviewOverlay({ art, onClose, backLabel = "Back" }) {
  const fallbackUrl = art?.url || art?.file_url || "";
  const name = art?.name || "Artwork";

  // Resolve the final URL BEFORE rendering the embed. Previously we
  // mounted with the fallback URL and then swapped to a freshly-signed
  // one when the async sign resolved — that swap tore down and reloaded
  // the PDF <object>, producing a visible "glitch a lot before loading"
  // flicker. Now we hold a loading state until the URL is settled and
  // mount the embed exactly once.
  const [url, setUrl] = useState(null);
  // A dead URL handed to <object>/<iframe> renders the storage API's raw JSON
  // error body full-screen — a customer saw exactly that on their proof
  // (#681). Every candidate URL is probed before mounting the embed; failures
  // land here and render a friendly message instead.
  const [failed, setFailed] = useState(false);
  const panelRef = useRef(null);
  const { onKeyDown } = useModalA11y(panelRef, { onClose });

  // Mobile browsers (iOS Safari, Android Chrome) don't inline-render PDFs in
  // <object>/<iframe> — they paint a blank box AND the embed captures taps over
  // the header. On narrow screens, show a tap-to-open CTA instead of the embed.
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia("(max-width: 640px)");
    const update = () => setIsNarrow(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setFailed(false);
    (async () => {
      const signed = await signArtworkUrl(art?.path || fallbackUrl);
      const candidate = signed || fallbackUrl;
      const ok = await probeUrl(candidate);
      if (cancelled) return;
      if (ok) setUrl(candidate);
      else setFailed(true);
    })();
    return () => { cancelled = true; };
  }, [art?.path, fallbackUrl]);

  const ready = !!url;

  const ext = String(name).split(".").pop()?.toLowerCase() ||
              ((url || fallbackUrl).split("?")[0].split(".").pop() || "").toLowerCase();
  const isImage = /^(png|jpe?g|gif|webp|svg|bmp)$/i.test(ext);
  const isPdf   = ext === "pdf" || /\.pdf(\?|$)/i.test(url || fallbackUrl);

  // PDF viewer hints — fit the whole page in view + hide the thumbnail
  // sidebar, but KEEP the toolbar so the user has native zoom in/out
  // controls. `view=Fit` fits both dimensions; `zoom=page-fit` is the
  // Chrome equivalent that older builds respect.
  const pdfSrc = isPdf && url
    ? `${url}${url.includes("#") ? "&" : "#"}view=Fit&zoom=page-fit&navpanes=0`
    : url;

  // Portal at document.body so the overlay escapes any ancestor
  // containing-block weirdness (e.g. an outer modal with backdrop-blur
  // creates a new containing block that confines `fixed inset-0`).
  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="Artwork preview"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-[80] bg-slate-900 flex flex-col focus:outline-none"
      style={{ top: 0, left: 0, right: 0, bottom: 0 }}
    >
      {/* z-10 + relative pins the header above the embed's stacking
          context — iOS Safari can otherwise let the PDF viewer swallow
          taps near its edges. Bigger padding + touch-action:manipulation
          makes the back/download targets reliably hit on mobile. */}
      <div className="relative z-10 flex items-center justify-between gap-3 px-3 py-3 bg-slate-800 text-white border-b border-slate-700 shrink-0">
        <button
          type="button"
          onClick={onClose}
          style={{ touchAction: "manipulation" }}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-200 hover:text-white px-2 py-1 -ml-2 rounded"
        >
          <ArrowLeft className="w-5 h-5" /> {backLabel}
        </button>
        <div className="text-xs font-semibold truncate flex-1 text-center px-2">{name}</div>
        {/* iOS Safari ignores <a download> for cross-origin URLs (our
            Supabase Storage host counts as cross-origin), so the link
            previously did nothing on mobile. target=_blank opens the
            file in the device's native viewer where the user can save
            via the share sheet — works everywhere. */}
        {/* Only offer Download once the URL is verified reachable — a dead
            href would open the storage API's raw error JSON in a new tab. */}
        {ready ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            download={name}
            style={{ touchAction: "manipulation" }}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-200 hover:text-white px-2 py-1 -mr-2 rounded"
          >
            <Download className="w-5 h-5" /> <span className="hidden sm:inline">Download</span>
          </a>
        ) : (
          <span className="px-2 py-1 -mr-2" aria-hidden="true" />
        )}
      </div>
      <div className="flex-1 bg-slate-100 flex items-center justify-center overflow-auto min-h-0 p-2 sm:p-4">
        {failed ? (
          <div className="flex flex-col items-center gap-3 text-center px-6">
            <FileText className="w-12 h-12 text-slate-400" />
            <div className="text-sm font-semibold text-slate-700">
              This file couldn&rsquo;t be loaded right now.
            </div>
            <div className="text-sm text-slate-500 max-w-sm">
              Please refresh the page and try again. If it keeps happening,
              reach out and we&rsquo;ll send the file over directly.
            </div>
          </div>
        ) : !ready ? (
          <Loader2 className="w-8 h-8 text-slate-500 animate-spin" />
        ) : isImage ? (
          <img src={url} alt={name} className="max-w-full max-h-full object-contain" />
        ) : isPdf && isNarrow ? (
          // Mobile: inline PDF embeds render blank and steal taps. Show a
          // tap-to-open CTA that opens the proof in the device's native viewer.
          <div className="flex flex-col items-center gap-4 text-center px-6">
            <FileText className="w-14 h-14 text-slate-400" />
            <div className="text-sm text-slate-600 max-w-xs">
              PDF previews aren&rsquo;t supported in-app on phones. Tap below to open
              the proof in your device&rsquo;s viewer.
            </div>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ touchAction: "manipulation" }}
              className="inline-flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white font-bold px-6 py-3 rounded-xl"
            >
              <Download className="w-5 h-5" /> Open proof PDF
            </a>
          </div>
        ) : isPdf ? (
          // Desktop: the PDF embed is locked to US-Letter aspect (8.5 × 11) so
          // the rendered page never distorts. The aspect-ratio container picks
          // the largest size that fits both dimensions; the <object>/<iframe>
          // fills that box exactly.
          <div
            className="bg-white shadow-sm"
            style={{
              aspectRatio: "8.5 / 11",
              maxWidth: "100%",
              maxHeight: "100%",
              width: "min(100%, calc((100vh - 6rem) * 8.5 / 11))",
            }}
          >
            <object data={pdfSrc} type="application/pdf" className="w-full h-full bg-white">
              <iframe src={pdfSrc} title={name} className="w-full h-full border-0 bg-white" />
            </object>
          </div>
        ) : (
          <iframe
            src={url}
            title={name}
            className="w-full h-full border-0 bg-white"
          />
        )}
      </div>
    </div>,
    document.body,
  );
}
