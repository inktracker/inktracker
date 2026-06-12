// Attachment viewer + (optional) uploader for quotes and orders. Renders
// a thumbnail grid of everything collectAttachments() finds and opens
// the full-screen ArtworkPreviewOverlay on click. When the parent
// passes onUpload/onRemove, it also exposes an "Add files" tile and a
// remove button per attachment — used so the shop can attach mockups /
// reference proofs while building a quote or reviewing a job on press.
//
// Props:
//   record    — a quote or order ({ selected_artwork, line_items })
//   title     — section heading (default "Attachments & Mockups")
//   backLabel — Back button text for the overlay
//   onUpload  — (event) => void  async; receives the file <input> change
//               event (e.target.files). When present, the Add tile shows.
//   onRemove  — (art) => void  async; when present, each tile shows ×.
//   uploading — bool; disables the Add tile + shows a spinner
//   uploadError — string; shown under the grid

import { useRef, useState } from "react";
import { Paperclip, FileText, ImageIcon, Plus, X, Loader2 } from "lucide-react";
import { collectAttachments } from "@/lib/artwork/collectAttachments";
import ArtworkPreviewOverlay from "./ArtworkPreviewOverlay";

function fileExt(name = "", url = "") {
  return (String(name).split(".").pop() || url.split("?")[0].split(".").pop() || "").toLowerCase();
}
function isImageName(name = "", url = "") {
  return /^(png|jpe?g|gif|webp|svg|bmp)$/i.test(fileExt(name, url));
}
function isPdfName(name = "", url = "") {
  return fileExt(name, url) === "pdf" || /\.pdf(\?|$)/i.test(url);
}

export default function AttachmentGallery({
  record,
  title = "Attachments & Mockups",
  backLabel = "Back",
  onUpload,
  onRemove,
  uploading = false,
  uploadError = "",
  accept = "image/*,.pdf",
}) {
  const [preview, setPreview] = useState(null);
  const fileRef = useRef(null);
  const items = collectAttachments(record);
  const canUpload = typeof onUpload === "function";

  // Nothing to show AND no way to add → render nothing.
  if (items.length === 0 && !canUpload) return null;

  // Only record-level attachments (source !== imprint) are removable —
  // imprint artwork is owned by the line item, not this gallery.
  const removableIds = new Set((record?.selected_artwork || []).map((a) => a.id || a.url || a.file_url || a.name));

  return (
    <div className="space-y-2">
      {title && (
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-400">
          <Paperclip className="w-3.5 h-3.5" />
          {title}
          {items.length > 0 && (
            <span className="text-slate-300 font-semibold normal-case tracking-normal">({items.length})</span>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {items.map((art) => {
          const img = isImageName(art.name, art.url);
          const pdf = !img && isPdfName(art.name, art.url);
          const removable = onRemove && removableIds.has(art.id);
          return (
            <div
              key={art.id}
              className="group relative bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden hover:border-teal-300 hover:shadow-sm transition"
            >
              {removable && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onRemove(art); }}
                  title="Remove attachment"
                  className="absolute top-1 right-1 z-10 w-6 h-6 rounded-full bg-slate-900/70 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition hover:bg-rose-500"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              <button type="button" onClick={() => setPreview(art)} className="block w-full text-left">
                <div className="relative aspect-[4/3] bg-slate-50 dark:bg-slate-800 flex items-center justify-center overflow-hidden">
                  {img && (art.url || art.path) ? (
                    <img src={art.url} alt={art.name} loading="lazy" className="w-full h-full object-contain group-hover:scale-[1.02] transition-transform" />
                  ) : pdf && (art.url || art.path) ? (
                    // First-page PDF preview. pointer-events-none so the
                    // click falls through to the button (opens the full
                    // viewer); the embed is just a thumbnail. Falls back
                    // to the icon visually if the browser can't render it.
                    <>
                      <object
                        data={`${art.url}#toolbar=0&navpanes=0&scrollbar=0&view=FitH&page=1`}
                        type="application/pdf"
                        className="w-full h-full pointer-events-none"
                        aria-label={art.name}
                      >
                        <FileText className="w-8 h-8 text-slate-300" />
                      </object>
                      <span className="absolute bottom-1 right-1 text-[9px] font-bold uppercase tracking-wider bg-slate-900/70 text-white px-1.5 py-0.5 rounded">PDF</span>
                    </>
                  ) : (
                    <FileText className="w-8 h-8 text-slate-300" />
                  )}
                </div>
                <div className="px-2.5 py-2 space-y-0.5">
                  <div className="flex items-center gap-1 text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">
                    {img ? <ImageIcon className="w-3 h-3 text-slate-400 shrink-0" /> : <FileText className="w-3 h-3 text-slate-400 shrink-0" />}
                    <span className="truncate">{art.name}</span>
                  </div>
                  {art.placements?.length > 0 && <div className="text-[10px] text-slate-400 truncate">{art.placements.join(", ")}</div>}
                  {art.colors && <div className="text-[10px] text-slate-400">{art.colors} {Number(art.colors) === 1 ? "color" : "colors"}</div>}
                </div>
              </button>
            </div>
          );
        })}

        {canUpload && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="aspect-[4/3] sm:aspect-auto sm:min-h-[7rem] flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700 text-slate-400 hover:border-teal-300 hover:text-teal-500 transition disabled:opacity-50"
          >
            {uploading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Plus className="w-6 h-6" />}
            <span className="text-xs font-semibold">{uploading ? "Uploading…" : "Add files"}</span>
            <input ref={fileRef} type="file" multiple accept={accept} className="hidden" onChange={onUpload} />
          </button>
        )}
      </div>

      {uploadError && <div className="text-xs text-rose-500">{uploadError}</div>}

      {preview && <ArtworkPreviewOverlay art={preview} onClose={() => setPreview(null)} backLabel={backLabel} />}
    </div>
  );
}
