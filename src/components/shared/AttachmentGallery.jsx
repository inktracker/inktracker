// Read-only attachment viewer for quotes and orders. Renders a thumbnail
// grid of every file collected by collectAttachments() and opens the
// full-screen ArtworkPreviewOverlay on click. Used on surfaces that
// previously had no way to see attached art/mockups: the shop quote
// modal and both broker drawers. (OrderDetailModal keeps its richer
// section with upload + approval state; this is view-only.)
//
// Props:
//   record   — a quote or order ({ selected_artwork, line_items })
//   title    — section heading (default "Attachments & Mockups")
//   backLabel— Back button text for the overlay (e.g. "Back to quote")

import { useState } from "react";
import { Paperclip, FileText, ImageIcon } from "lucide-react";
import { collectAttachments } from "@/lib/artwork/collectAttachments";
import ArtworkPreviewOverlay from "./ArtworkPreviewOverlay";

function isImageName(name = "", url = "") {
  const ext = (String(name).split(".").pop() || url.split("?")[0].split(".").pop() || "").toLowerCase();
  return /^(png|jpe?g|gif|webp|svg|bmp)$/i.test(ext);
}

export default function AttachmentGallery({ record, title = "Attachments & Mockups", backLabel = "Back" }) {
  const [preview, setPreview] = useState(null);
  const items = collectAttachments(record);

  if (items.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-400">
        <Paperclip className="w-3.5 h-3.5" />
        {title}
        <span className="text-slate-300 font-semibold normal-case tracking-normal">({items.length})</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {items.map((art) => {
          const img = isImageName(art.name, art.url);
          return (
            <button
              key={art.id}
              type="button"
              onClick={() => setPreview(art)}
              className="group text-left bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden hover:border-teal-300 hover:shadow-sm transition"
            >
              <div className="aspect-[4/3] bg-slate-50 dark:bg-slate-800 flex items-center justify-center overflow-hidden">
                {img && (art.url || art.path) ? (
                  <img
                    src={art.url}
                    alt={art.name}
                    loading="lazy"
                    className="w-full h-full object-contain group-hover:scale-[1.02] transition-transform"
                  />
                ) : (
                  <FileText className="w-8 h-8 text-slate-300" />
                )}
              </div>
              <div className="px-2.5 py-2 space-y-0.5">
                <div className="flex items-center gap-1 text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">
                  {img ? <ImageIcon className="w-3 h-3 text-slate-400 shrink-0" /> : <FileText className="w-3 h-3 text-slate-400 shrink-0" />}
                  <span className="truncate">{art.name}</span>
                </div>
                {art.placements?.length > 0 && (
                  <div className="text-[10px] text-slate-400 truncate">{art.placements.join(", ")}</div>
                )}
                {art.colors && (
                  <div className="text-[10px] text-slate-400">{art.colors} {Number(art.colors) === 1 ? "color" : "colors"}</div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {preview && (
        <ArtworkPreviewOverlay art={preview} onClose={() => setPreview(null)} backLabel={backLabel} />
      )}
    </div>
  );
}
