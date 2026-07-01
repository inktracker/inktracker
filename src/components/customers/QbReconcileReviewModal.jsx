import { useState, useMemo } from "react";
import ModalBackdrop from "@/components/shared/ModalBackdrop";
import { describeMergeFor } from "@/lib/customers/mergeCustomerData";
import { partitionReconcilePairs } from "@/lib/customers/qbReconcileDetect";
import { Loader2, GitMerge, Check, RefreshCw } from "lucide-react";

// Surfaces post-QB-merge orphans the auto-detect picked up. Each
// actionable pair shows: which local record is the survivor, which
// will be merged into it, and exactly what data moves. Calls the
// same runCustomerMerge as the operator-driven merge flow so the
// additive-merge contract is identical. Pairs where the QB survivor
// has no local row yet display a "pull from QB first" hint instead
// of a merge button.
export default function QbReconcileReviewModal({ pairs, onMerge, onClose }) {
  const [merging, setMerging] = useState(false);
  const [doneIds, setDoneIds] = useState([]);

  const { actionable, survivorMissing } = useMemo(
    () => partitionReconcilePairs(pairs || []),
    [pairs],
  );

  async function handleReconcile(pair) {
    if (merging) return;
    setMerging(true);
    try {
      // Survivor = winner (Active in QB), inactive = loser. Additive
      // patch carries inactive's local data over to survivor; child
      // quotes/orders/invoices reassign; inactive row deletes.
      await onMerge(pair.survivor, [pair.inactive]);
      setDoneIds((prev) => [...prev, pair.inactive.id]);
    } finally {
      setMerging(false);
    }
  }

  const remaining = actionable.filter((p) => !doneIds.includes(p.inactive.id));

  return (
    <ModalBackdrop onClose={onClose}>
      <div className="bg-white rounded-2xl p-5 max-w-2xl w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-amber-600" />
            Finish QuickBooks Merges
          </h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-600 text-xl leading-none">&times;</button>
        </div>

        <p className="text-xs text-slate-500 mb-4">
          These customers were merged in QuickBooks. Click <span className="font-semibold">Finish merge</span> to consolidate their local InkTracker data into the survivor — quotes, orders, invoices, notes, and saved imprints all transfer. QuickBooks is not touched.
        </p>

        {remaining.length === 0 && actionable.length > 0 && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 mb-3 flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-600" />
            <div className="text-xs text-emerald-700 font-semibold">All actionable merges finished.</div>
          </div>
        )}

        {remaining.length > 0 && (
          <div className="space-y-2 mb-4">
            {remaining.map((p) => (
              <div key={p.inactive.id} className="border border-slate-200 rounded-lg p-3 flex items-center justify-between gap-3">
                <div className="text-xs min-w-0">
                  <div className="font-semibold text-slate-800 truncate">
                    {p.inactive.company || p.inactive.name || p.qbDisplayName || "(unnamed)"}
                  </div>
                  <div className="text-slate-500 mt-0.5">
                    Local record will merge into{" "}
                    <span className="font-semibold text-slate-700">
                      {p.survivor.company || p.survivor.name || "(survivor)"}
                    </span>
                    {" "}(active in QuickBooks).
                  </div>
                  {(() => {
                    const items = describeMergeFor(p.survivor, p.inactive);
                    if (!items?.length) return null;
                    return (
                      <ul className="text-[10px] text-slate-500 mt-1 ml-3 list-disc">
                        {items.slice(0, 4).map((line, i) => <li key={i}>{line}</li>)}
                        {items.length > 4 && <li>+ {items.length - 4} more</li>}
                      </ul>
                    );
                  })()}
                </div>
                <button
                  onClick={() => handleReconcile(p)}
                  disabled={merging}
                  className="text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5 disabled:opacity-50 shrink-0"
                >
                  {merging ? <Loader2 className="w-3 h-3 animate-spin" /> : <GitMerge className="w-3 h-3" />}
                  Finish merge
                </button>
              </div>
            ))}
          </div>
        )}

        {survivorMissing.length > 0 && (
          <div className="border-t border-slate-100 pt-3 mt-3">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-2">
              Need QB pull first
            </div>
            <p className="text-[10px] text-slate-500 mb-2">
              These were merged in QuickBooks but the survivor isn't in InkTracker yet. Run your QuickBooks customer pull to bring it in, then revisit this banner.
            </p>
            <div className="space-y-1">
              {survivorMissing.map((p) => (
                <div key={p.inactive.id} className="text-xs text-slate-600 px-2 py-1.5 bg-slate-50 rounded">
                  {p.inactive.company || p.inactive.name || p.qbDisplayName || "(unnamed)"}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end mt-4">
          <button
            onClick={onClose}
            className="text-xs font-semibold text-slate-600 hover:text-slate-800 px-4 py-2"
          >
            Close
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
