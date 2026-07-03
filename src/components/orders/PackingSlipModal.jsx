import { useState } from "react";
import { Eye } from "lucide-react";
import ModalBackdrop from "@/components/shared/ModalBackdrop";
import { exportPackingSlipToPDF, previewPdf } from "@/components/shared/pdfExport";
import { initialSlipQuantities } from "@/lib/orders/packingSlip";
import { notify } from "@/lib/notify";

// Confirm-quantities step before generating a packing slip PDF.
//
// Each line item's sizes render as editable cells pre-filled with the FINAL
// count — ordered qty minus any recorded misprints (`li._shortfall`) — with
// the intended (ordered) qty shown beside each cell so the packer can see
// at a glance where the shipment differs from the order. Preview builds the
// PDF (no pricing anywhere) and opens it in a new tab, where the browser's
// native viewer handles print/download — same convention as the Order and
// Invoice previews.
//
// Quantities are per-render state only: the slip reflects what physically
// ships TODAY. Nothing here writes back to the order — misprint records and
// billing stay untouched (Quote Snapshot Invariant).

export default function PackingSlipModal({ order, customer, shopName, logoUrl, onClose }) {
  const [quantities, setQuantities] = useState(() => initialSlipQuantities(order));
  const [building, setBuilding] = useState(false);

  function setQty(liIdx, size, value) {
    // Allow clearing the field while typing; clamp to a non-negative int.
    const n = value === "" ? "" : Math.max(0, parseInt(value, 10) || 0);
    setQuantities((prev) => ({
      ...prev,
      [liIdx]: { ...prev[liIdx], [size]: n },
    }));
  }

  // Coerce in-progress "" fields to 0 for math + the PDF.
  function cleanQuantities() {
    const out = {};
    for (const [idx, sizes] of Object.entries(quantities)) {
      out[idx] = {};
      for (const [s, v] of Object.entries(sizes)) out[idx][s] = parseInt(v, 10) || 0;
    }
    return out;
  }

  async function handlePreview() {
    setBuilding(true);
    try {
      await previewPdf(
        exportPackingSlipToPDF(order, shopName, logoUrl, "blob", customer?.company, cleanQuantities())
      );
    } catch (err) {
      notify.error("Couldn't build the packing slip", err);
    } finally {
      setBuilding(false);
    }
  }

  const lineItems = order.line_items || [];
  const clean = cleanQuantities();
  const grandFinal = Object.values(clean).reduce(
    (sum, sizes) => sum + Object.values(sizes).reduce((a, b) => a + b, 0), 0);
  const grandIntended = lineItems.reduce(
    (sum, li) => sum + Object.values(li.sizes || {}).reduce((a, b) => a + (parseInt(b, 10) || 0), 0), 0);

  return (
    <ModalBackdrop onClose={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="px-6 pt-5 pb-3 border-b border-slate-200 dark:border-slate-700">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">Packing Slip — Confirm Quantities</h3>
          <p className="text-xs text-slate-500 mt-1">
            Counts start at ordered minus recorded misprints. Adjust any cell to match what's
            actually in the box — the ordered quantity is shown next to each. Prices never
            appear on the slip.
          </p>
        </div>

        <div className="px-6 py-4 space-y-4">
          {lineItems.map((li, idx) => {
            const sizes = Object.keys(li.sizes || {});
            if (sizes.length === 0) return null;
            const lineFinal = Object.values(clean[idx] || {}).reduce((a, b) => a + b, 0);
            const lineIntended = Object.values(li.sizes || {}).reduce((a, b) => a + (parseInt(b, 10) || 0), 0);
            const hasShortfall = Object.values(li._shortfall || {}).some((v) => (parseInt(v, 10) || 0) > 0);
            return (
              <div key={li.id || idx} className="border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                <div className="flex items-baseline justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <span className="text-sm font-bold text-slate-900 dark:text-white">
                      {[li.style, li.garmentColor || li.color].filter(Boolean).join(" — ") || "Item"}
                    </span>
                    {(li.productName || li.description) && (
                      <span className="ml-2 text-xs text-slate-500 truncate">{li.productName || li.description}</span>
                    )}
                  </div>
                  <span className={`text-xs font-semibold whitespace-nowrap ${lineFinal !== lineIntended ? "text-amber-600" : "text-slate-500"}`}>
                    {lineFinal} of {lineIntended}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {sizes.map((s) => {
                    const ordered = parseInt(li.sizes[s], 10) || 0;
                    const val = quantities[idx]?.[s];
                    const differs = (parseInt(val, 10) || 0) !== ordered;
                    return (
                      <label key={s} className="flex flex-col items-center gap-1">
                        <span className="text-[10px] font-bold text-slate-500 uppercase">{s}</span>
                        <span className="flex items-center gap-1">
                          <input
                            type="number"
                            min="0"
                            value={val}
                            onChange={(e) => setQty(idx, s, e.target.value)}
                            className={`w-14 text-sm text-center border rounded-lg px-1 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-300 ${
                              differs ? "border-amber-300 bg-amber-50 dark:bg-amber-900/20" : "border-slate-200 dark:border-slate-700 dark:bg-slate-800"
                            }`}
                          />
                          <span className="text-[11px] text-slate-400 whitespace-nowrap">/ {ordered}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                {hasShortfall && (
                  <p className="text-[11px] text-amber-600 mt-2">
                    Recorded misprints already deducted from these counts.
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-b-2xl flex items-center gap-3">
          <span className={`text-sm font-bold ${grandFinal !== grandIntended ? "text-amber-600" : "text-slate-700 dark:text-slate-200"}`}>
            {grandFinal} of {grandIntended} units
          </span>
          <button
            onClick={onClose}
            className="ml-auto px-4 py-2 text-sm font-semibold text-slate-500 rounded-xl hover:bg-slate-100 transition"
          >
            Cancel
          </button>
          <button
            onClick={handlePreview}
            disabled={building}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white rounded-xl transition disabled:opacity-50"
          >
            <Eye className="w-4 h-4" />
            {building ? "Building…" : "Preview Slip"}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
