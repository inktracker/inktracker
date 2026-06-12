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

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Download, Loader2 } from "lucide-react";
import { signArtworkUrl } from "@/lib/uploadFile";

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
  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    (async () => {
      const signed = await signArtworkUrl(art?.path || fallbackUrl);
      if (!cancelled) setUrl(signed || fallbackUrl);
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
      className="fixed inset-0 z-[80] bg-slate-900 flex flex-col"
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
        <a
          href={url || fallbackUrl}
          target="_blank"
          rel="noopener noreferrer"
          download={name}
          style={{ touchAction: "manipulation" }}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-200 hover:text-white px-2 py-1 -mr-2 rounded"
        >
          <Download className="w-5 h-5" /> <span className="hidden sm:inline">Download</span>
        </a>
      </div>
      <div className="flex-1 bg-slate-100 flex items-center justify-center overflow-auto min-h-0 p-2 sm:p-4">
        {!ready ? (
          <Loader2 className="w-8 h-8 text-slate-400 animate-spin" />
        ) : isImage ? (
          <img src={url} alt={name} className="max-w-full max-h-full object-contain" />
        ) : isPdf ? (
          // The PDF embed is locked to US-Letter aspect (8.5 × 11) so
          // mobile browsers — which otherwise stretch the rendered
          // page to whatever box they're given — never distort the
          // proof. The aspect-ratio container picks the largest size
          // that fits both dimensions of the available space; the
          // <object>/<iframe> fills that box exactly, matching the
          // page proportions so nothing scales unevenly.
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
