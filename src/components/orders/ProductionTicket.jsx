// Printable production ticket — the paper traveler that runs with a job
// on the floor of a 4-20 person shop. Everything the press operator
// needs, NOTHING money: order/job/customer, due + press + operator,
// garments with size grids, imprints with ink/thread calls (via the
// shared imprintLabels helpers — stitch-tier gotcha lives there),
// artwork previews, job notes, a step checklist, and sign-off lines.
//
// Render model: a fixed overlay (screen) with a Print button; @media
// print CSS in index.css hides the app and shows ONLY .production-ticket.
// Artwork thumbs are signed (private bucket, 320px transforms) before
// the Print button reads ready — a half-loaded image prints as a hole.

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Printer, X } from "lucide-react";
import { SIZES, getQty, getDisplayName } from "../shared/pricing";
import { imprintCountText } from "@/lib/quotes/imprintLabels";
import { customGarmentHeader } from "@/lib/quotes/garmentTitle";
import { getImprintArtwork } from "./orderDetail/orderDetailHelpers";
import { signArtworkUrl } from "@/lib/uploadFile";
import { normalizeAssignedPress } from "@/lib/presses/normalizePresses";
import { fmtDate } from "../shared/pricing";

const FLOOR_STEPS = ["Art Approval", "Order Goods", "Pre-Press", "Printing", "Completed"];

export default function ProductionTicket({ order, customer, shopName, stitchTiers, onClose }) {
  const [artThumbs, setArtThumbs] = useState({}); // key -> signed url
  const [artReady, setArtReady] = useState(false);

  const lines = order?.line_items || [];
  const artworks = [];
  lines.forEach((li, liIdx) => {
    (li.imprints || []).forEach((imp, impIdx) => {
      const art = getImprintArtwork(imp);
      if (art && (art.url || imp.artwork_url)) {
        artworks.push({ key: `${liIdx}-${impIdx}`, art, title: imp.title || imp.location || "Imprint" });
      }
    });
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        artworks.map(async (a) => [a.key, await signArtworkUrl(a.art.url, undefined, { width: 320 })]),
      );
      if (!cancelled) {
        setArtThumbs(Object.fromEntries(entries.filter(([, u]) => u)));
        setArtReady(true);
      }
    })();
    // Nothing to sign → ready immediately.
    if (artworks.length === 0) setArtReady(true);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id]);

  if (!order) return null;

  const customerLabel = (customer ? getDisplayName(customer) : order.customer_name) || "—";
  const press = normalizeAssignedPress(order.assigned_press);

  const body = (
    <div className="production-ticket fixed inset-0 z-[100] bg-slate-900/60 overflow-y-auto">
      {/* Screen chrome — hidden in print */}
      <div className="ticket-chrome sticky top-0 z-10 bg-slate-900 text-white px-5 py-3 flex items-center justify-between">
        <div className="text-sm font-bold">Production Ticket — {order.order_id}</div>
        <div className="flex gap-2">
          <button
            onClick={() => window.print()}
            disabled={!artReady}
            className="flex items-center gap-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-sm font-bold px-4 py-2 rounded-lg transition"
          >
            <Printer className="w-4 h-4" /> {artReady ? "Print" : "Loading artwork…"}
          </button>
          <button onClick={onClose} className="p-2 hover:bg-slate-700 rounded-lg transition" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* The printable sheet */}
      <div className="ticket-sheet bg-white text-slate-900 max-w-3xl mx-auto my-6 p-8 rounded-xl shadow-2xl print:shadow-none">
        {/* Header */}
        <div className="flex items-start justify-between border-b-2 border-slate-900 pb-3 mb-4">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500">{shopName || "Production"}</div>
            <div className="text-2xl font-black tracking-tight">{order.order_id}</div>
            {order.job_title && <div className="text-sm font-semibold text-slate-700">{order.job_title}</div>}
            <div className="text-sm text-slate-600">{customerLabel}</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Due</div>
            <div className="text-xl font-black">{order.due_date ? fmtDate(order.due_date) : "—"}</div>
            {order.scheduled_date && <div className="text-xs text-slate-600">Runs {fmtDate(order.scheduled_date)}</div>}
            {press && <div className="text-xs font-semibold text-slate-700">{press}</div>}
            {order.assigned_operator && <div className="text-xs text-slate-600">Op: {order.assigned_operator}</div>}
          </div>
        </div>

        {/* Garments */}
        {lines.map((li, i) => {
          const sizes = li.sizes || {};
          const activeSizes = SIZES.filter((sz) => (parseInt(sizes[sz]) || 0) > 0);
          return (
            <div key={li.id || i} className="mb-5 break-inside-avoid">
              <div className="font-bold text-base">
                {customGarmentHeader(li, li.style) || [li.brand, li.style].filter(Boolean).join(" ") || "Garment"}
                {li.garmentColor && <span className="font-semibold text-slate-600"> — {li.garmentColor}</span>}
              </div>
              {activeSizes.length > 0 && (
                <table className="w-full text-sm border border-slate-300 mt-1.5">
                  <thead>
                    <tr className="bg-slate-100">
                      {activeSizes.map((sz) => <th key={sz} className="border border-slate-300 px-2 py-1 font-bold">{sz}</th>)}
                      <th className="border border-slate-300 px-2 py-1 font-bold bg-slate-200">TOTAL</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      {activeSizes.map((sz) => <td key={sz} className="border border-slate-300 px-2 py-1.5 text-center font-semibold">{sizes[sz]}</td>)}
                      <td className="border border-slate-300 px-2 py-1.5 text-center font-black bg-slate-50">{getQty(li)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
              {/* Imprints — ink/thread calls via the shared labels helper */}
              {(li.imprints || []).length > 0 && (
                <div className="mt-2 space-y-1">
                  {(li.imprints || []).map((imp, j) => (
                    <div key={imp.id || j} className="flex flex-wrap items-baseline gap-x-2 text-sm border-l-4 border-slate-900 pl-2">
                      <span className="font-bold">{imp.title || imp.location || `Imprint ${j + 1}`}</span>
                      <span className="text-slate-600">{imp.location}</span>
                      <span className="text-slate-600">· {imp.technique || "—"}</span>
                      <span className="text-slate-600">· {imprintCountText(imp, stitchTiers)}</span>
                      {imp.pantones && <span className="font-semibold">· {imp.pantones}</span>}
                      {(imp.width || imp.height) && (
                        <span className="text-slate-600">· {[imp.width, imp.height].filter(Boolean).join(" × ")}</span>
                      )}
                      {imp.details && <span className="text-slate-500 italic">· {imp.details}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Artwork previews */}
        {artworks.length > 0 && (
          <div className="mb-5 break-inside-avoid">
            <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-2">Artwork</div>
            <div className="grid grid-cols-3 gap-3">
              {artworks.map((a) => (
                <div key={a.key} className="border border-slate-300 rounded p-2 text-center">
                  {artThumbs[a.key] ? (
                    <img src={artThumbs[a.key]} alt={a.art.name} className="max-h-28 mx-auto object-contain" />
                  ) : (
                    <div className="h-28 flex items-center justify-center text-xs text-slate-400">{a.art.name}</div>
                  )}
                  <div className="text-[10px] text-slate-600 mt-1 truncate">{a.title}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        {order.notes && (
          <div className="mb-5 border-2 border-amber-400 bg-amber-50 rounded p-3 text-sm break-inside-avoid">
            <span className="font-bold">NOTES: </span>{order.notes}
          </div>
        )}

        {/* Step checklist + sign-off */}
        <div className="border-t-2 border-slate-900 pt-3 break-inside-avoid">
          <div className="flex flex-wrap gap-4 mb-4">
            {FLOOR_STEPS.map((s) => (
              <label key={s} className="flex items-center gap-1.5 text-sm font-semibold">
                <span className="inline-block w-4 h-4 border-2 border-slate-900 rounded-sm" /> {s}
              </label>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-6 text-sm">
            <div>
              <div className="border-b border-slate-400 h-8" />
              <div className="text-[10px] uppercase tracking-widest text-slate-500 mt-1">Printed by / Date</div>
            </div>
            <div>
              <div className="border-b border-slate-400 h-8" />
              <div className="text-[10px] uppercase tracking-widest text-slate-500 mt-1">QC checked by / Date</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(body, document.body);
}
