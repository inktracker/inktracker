import { useState } from "react";
import { poReceivingSummary } from "@/lib/purchaseOrders";
import { fmtDate } from "@/components/shared/pricing";
import { PackageCheck, Check, Loader2, AlertTriangle } from "lucide-react";

// Receiving on a SUBMITTED purchase order — two separate checks:
//   1. "Received" (PO-level): the shipment showed up. One toggle.
//   2. "Checked in" (per line): someone counted the garments in. Enter the
//      actual quantity, so an under-shipment surfaces as a shortage (and, for a
//      single-order PO, flows into Reorder Shortfall).

function LineRow({ item, index, busy, readOnly, onCheckIn }) {
  const ordered = Number(item.quantity) || 0;
  const isChecked = item.checkedIn != null;
  const received = Number(item.checkedIn) || 0;
  const short = isChecked && received < ordered;
  const [count, setCount] = useState(String(ordered));

  return (
    <div className="flex items-center gap-3 px-3 py-2 text-sm">
      <div className="flex-1 min-w-0">
        <span className="font-medium text-slate-800">{item.styleCode || item.sku}</span>
        <span className="text-slate-400"> · {item.color || "—"} · {item.size}</span>
      </div>
      <div className="text-xs text-slate-500 w-16 text-right shrink-0">ord {ordered}</div>
      {isChecked ? (
        <div className={`w-28 text-right text-xs font-semibold shrink-0 ${short ? "text-amber-700" : "text-emerald-700"}`}>
          {short ? <span className="inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> got {received} · short {ordered - received}</span> : <span className="inline-flex items-center gap-1"><Check className="w-3.5 h-3.5" /> checked in {received}</span>}
        </div>
      ) : (
        <div className="flex items-center gap-1.5 shrink-0">
          <input
            type="number"
            min={0}
            value={count}
            onChange={(e) => setCount(e.target.value)}
            disabled={busy || readOnly}
            className="w-16 text-sm text-center border border-slate-200 rounded px-1 py-1"
            aria-label={`Counted quantity for ${item.styleCode} ${item.size}`}
          />
          <button
            type="button"
            onClick={() => onCheckIn(index, Number(count))}
            disabled={busy || readOnly}
            className="flex items-center gap-1 text-xs font-semibold text-teal-700 border border-teal-200 rounded px-2 py-1 hover:bg-teal-50 disabled:opacity-60"
          >
            <Check className="w-3.5 h-3.5" /> Check in
          </button>
        </div>
      )}
    </div>
  );
}

export default function POReceivingPanel({ po, readOnly = false, busy = false, onToggleReceived, onCheckInItem }) {
  const s = poReceivingSummary(po);
  const items = Array.isArray(po?.items) ? po.items : [];

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-100">
        <div className="text-sm font-bold text-slate-700 flex items-center gap-2">
          <PackageCheck className="w-4 h-4 text-teal-600" /> Receiving
        </div>
        {po.received_at ? (
          <button
            type="button"
            onClick={() => onToggleReceived(false)}
            disabled={busy || readOnly}
            className="text-xs font-semibold text-emerald-700 inline-flex items-center gap-1.5 disabled:opacity-60"
            title="Undo received"
          >
            <Check className="w-4 h-4" /> Received {fmtDate(po.received_at)} · undo
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onToggleReceived(true)}
            disabled={busy || readOnly}
            className="flex items-center gap-1.5 bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-60"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PackageCheck className="w-3.5 h-3.5" />}
            Mark received
          </button>
        )}
      </div>

      <div className="px-4 py-2 text-[11px] text-slate-500 border-b border-slate-100 flex items-center justify-between">
        <span>Check in {s.checkedInCount}/{s.totalItems} lines</span>
        {s.shortages.length > 0 && (
          <span className="text-amber-700 font-semibold">{s.shortages.reduce((a, b) => a + b.short, 0)} pc short — will feed Reorder Shortfall</span>
        )}
      </div>

      <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
        {items.length === 0 ? (
          <div className="px-4 py-3 text-sm text-slate-400">No items on this PO.</div>
        ) : (
          items.map((it, i) => (
            // Key by sku+warehouse+index: mergeItem allows the same SKU on two
            // warehouses (AS Colour routing), so sku alone collides and bleeds
            // the counted-qty input state between rows.
            <LineRow key={`${it.sku || ""}-${it.warehouse ?? ""}-${i}`} item={it} index={i} busy={busy} readOnly={readOnly} onCheckIn={onCheckInItem} />
          ))
        )}
      </div>
    </div>
  );
}
