import { useState, useEffect } from "react";
import { base44 } from "@/api/supabaseClient";
import { fmtDate } from "../shared/pricing";
import { Download, FolderOpen } from "lucide-react";

// Shows files from two sources:
// 1. BrokerFile entity — permanently saved records for completed/invoiced orders
// 2. Active orders that still have a pdf_url — visible until invoiced
export default function BrokerFilesTab({ brokerEmail, orders }) {
  const [persistedFiles, setPersistedFiles] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!brokerEmail) return;
    base44.entities.BrokerFile.filter({ broker_id: brokerEmail }, "-created_date", 200)
      .then(files => setPersistedFiles(files))
      .finally(() => setLoading(false));
  }, [brokerEmail]);

  // Active order files (not yet invoiced) — avoid duplicating already-persisted ones
  const persistedOrderIds = new Set(persistedFiles.map(f => f.order_id));
  const activeOrderFiles = (orders || []).filter(o => o.pdf_url && !persistedOrderIds.has(o.order_id));

  const totalCount = persistedFiles.length + activeOrderFiles.length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Files</h1>
        <p className="text-slate-500 text-sm mt-0.5">PDFs attached to your orders — including completed and invoiced orders.</p>
      </div>

      {loading ? (
        <div className="text-center py-16 text-slate-300 text-sm">Loading…</div>
      ) : totalCount === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl py-20 text-center">
          <FolderOpen className="w-12 h-12 text-slate-200 mx-auto mb-3" />
          <p className="text-slate-400 text-sm font-medium">No files yet. Files appear here once the shop attaches a PDF to your orders.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden divide-y divide-slate-100">

          {/* Persisted files (completed/invoiced orders) */}
          {persistedFiles.map(f => (
            <div key={f.id} className="flex items-center justify-between px-5 py-4 gap-4">
              <div className="min-w-0">
                <div className="font-semibold text-slate-800 text-sm">{f.customer_name || "—"}</div>
                <div className="text-xs text-slate-400 mt-0.5">
                  {f.order_id}
                  {f.date && <span className="ml-2">· {fmtDate(f.date)}</span>}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700">
                  Completed
                </span>
                <a
                  href={f.file_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 border border-indigo-200 px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition"
                >
                  <Download className="w-3.5 h-3.5" /> View PDF
                </a>
              </div>
            </div>
          ))}

          {/* Active orders with PDFs (not yet invoiced) */}
          {activeOrderFiles.map(order => (
            <div key={order.id} className="flex items-center justify-between px-5 py-4 gap-4">
              <div className="min-w-0">
                <div className="font-semibold text-slate-800 text-sm">{order.customer_name || "—"}</div>
                <div className="text-xs text-slate-400 mt-0.5">
                  {order.order_id}
                  {order.date && <span className="ml-2">· {fmtDate(order.date)}</span>}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${order.status === "Completed" ? "bg-emerald-100 text-emerald-700" : "bg-indigo-100 text-indigo-700"}`}>
                  {order.status}
                </span>
                <a
                  href={order.pdf_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 border border-indigo-200 px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition"
                >
                  <Download className="w-3.5 h-3.5" /> View PDF
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}