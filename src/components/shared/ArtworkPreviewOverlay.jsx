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
import { ArrowLeft, Download } from "lucide-react";
import { signArtworkUrl } from "@/lib/uploadFile";

export default function ArtworkPreviewOverlay({ art, onClose, backLabel = "Back" }) {
  const fallbackUrl = art?.url || art?.file_url || "";
  const name = art?.name || "Artwork";

  // Prefer a freshly-signed URL when we can resolve a storage path.
  // Falls back to whatever URL was stored on the artwork record
  // (legacy public URLs continue to work; bucket is still public
  // today, so behavior doesn't change until the bucket flips private).
  const [url, setUrl] = useState(fallbackUrl);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const signed = await signArtworkUrl(art?.path || fallbackUrl);
      if (!cancelled && signed) setUrl(signed);
    })();
    return () => { cancelled = true; };
  }, [art?.path, fallbackUrl]);

  const ext = String(name).split(".").pop()?.toLowerCase() ||
              (url.split("?")[0].split(".").pop() || "").toLowerCase();
  const isImage = /^(png|jpe?g|gif|webp|svg|bmp)$/i.test(ext);
  const isPdf   = ext === "pdf" || /\.pdf(\?|$)/i.test(url);

  // PDF viewer hints — fit the whole page in view + hide the thumbnail
  // sidebar, but KEEP the toolbar so the user has native zoom in/out
  // controls. `view=Fit` fits both dimensions; `zoom=page-fit` is the
  // Chrome equivalent that older builds respect.
  const pdfSrc = isPdf
    ? `${url}${url.includes("#") ? "&" : "#"}view=Fit&zoom=page-fit&navpanes=0`
    : url;

  // Portal at document.body so the overlay escapes any ancestor
  // containing-block weirdness (e.g. an outer modal with backdrop-blur
  // creates a new containing block that confines `fixed inset-0`).
  return createPortal(
    <div
      className="fixed inset-0 z-[80] bg-slate-900 flex flex-col"
      style={{ top: 0, left: 0, right: 0, bottom: 0 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-slate-800 text-white border-b border-slate-700 shrink-0">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-200 hover:text-white"
        >
          <ArrowLeft className="w-4 h-4" /> {backLabel}
        </button>
        <div className="text-xs font-semibold truncate flex-1 text-center px-2">{name}</div>
        <a
          href={url}
          download={name}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-200 hover:text-white"
        >
          <Download className="w-4 h-4" /> Download
        </a>
      </div>
      <div className="flex-1 bg-slate-100 flex items-center justify-center overflow-auto min-h-0 p-2 sm:p-4">
        {isImage ? (
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
