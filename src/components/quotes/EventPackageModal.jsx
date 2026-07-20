import { useState } from "react";
import ModalBackdrop from "../shared/ModalBackdrop";
import { fmtMoney, uid } from "../shared/pricing";
import { buildEventCharges } from "@/lib/pricing/eventPackages";

// Quote editor → "+ Event package": pick a configured event/package
// tier (Account → Pricing → Event / Package Pricing), set hours and
// add-on quantities, waive waivable fees, and insert the itemized
// charges onto the quote's Additional Fees. The inserted rows are
// plain additional_charges — editable/removable like hand-typed fees,
// and they flow to totals, PDF, payment page, and QB unchanged.
export default function EventPackageModal({ eventConfig, onInsert, onClose }) {
  const packages = eventConfig?.packages || [];
  const [selectedId, setSelectedId] = useState(packages[0]?.id || "");
  const pkg = packages.find((p) => p.id === selectedId) || packages[0] || null;
  const [hours, setHours] = useState(pkg?.minHours ?? 0);
  const [addOnQtys, setAddOnQtys] = useState({});
  const [waived, setWaived] = useState({});

  if (!pkg) return null;

  function selectPackage(id) {
    setSelectedId(id);
    const next = packages.find((p) => p.id === id);
    // Reset per-package inputs — hours snap to the new minimum.
    setHours(next?.minHours ?? 0);
    setAddOnQtys({});
    setWaived({});
  }

  const previewRows = buildEventCharges(pkg, {
    hours,
    hourlyRate: eventConfig.hourlyRate,
    addOnQtys,
    waivedFeeIds: Object.keys(waived).filter((k) => waived[k]),
  });
  const previewTotal = previewRows.reduce((s, r) => s + r.amount, 0);

  function handleInsert() {
    onInsert(previewRows.map((r) => ({ ...r, id: `ac-evt-${uid()}` })));
    onClose();
  }

  const inputCls = "text-xs text-center border border-slate-200 rounded px-1 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-300";

  return (
    <ModalBackdrop onClose={onClose} z="z-[200]">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-900">Add Event Package</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-600 text-lg leading-none">✕</button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Package picker */}
          <div className="space-y-2">
            {packages.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => selectPackage(p.id)}
                className={`w-full text-left border-2 rounded-xl px-3 py-2.5 transition ${
                  p.id === selectedId ? "border-teal-600 bg-teal-50" : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className={`text-sm font-bold ${p.id === selectedId ? "text-teal-700" : "text-slate-700"}`}>{p.label}</span>
                  <span className="text-sm font-bold text-slate-800 whitespace-nowrap">{fmtMoney(p.basePrice)} · {p.minHours} hr min</span>
                </div>
                {p.notes && <div className="text-[11px] text-slate-500 mt-0.5">{p.notes}</div>}
              </button>
            ))}
          </div>

          {/* Hours */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-600">Booked hours</span>
            <input
              type="number"
              min={0}
              step={0.5}
              value={hours}
              onChange={(e) => setHours(Math.max(0, Number(e.target.value) || 0))}
              className={`${inputCls} w-20`}
            />
            <span className="text-[10px] text-slate-500">
              {eventConfig.hourlyRate > 0
                ? `${fmtMoney(eventConfig.hourlyRate)}/hr beyond the ${pkg.minHours} hr minimum`
                : `minimum ${pkg.minHours} hrs`}
            </span>
          </div>

          {/* Add-ons */}
          {pkg.addOns.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Add-ons</div>
              {pkg.addOns.map((a) => (
                <div key={a.id} className="flex items-center gap-2">
                  <span className="flex-1 text-xs text-slate-700">{a.label} — {fmtMoney(a.rate)}/{a.unit}</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={addOnQtys[a.id] ?? ""}
                    placeholder="0"
                    onChange={(e) => setAddOnQtys((prev) => ({ ...prev, [a.id]: Math.max(0, Math.round(Number(e.target.value) || 0)) }))}
                    className={`${inputCls} w-20`}
                    aria-label={`${a.label} quantity`}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Fees */}
          {pkg.fees.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Fees</div>
              {pkg.fees.map((f) => (
                <div key={f.id} className="flex items-center gap-2">
                  <span className="flex-1 text-xs text-slate-700">{f.label} — {fmtMoney(f.amount)}</span>
                  {f.waivable && (
                    <label className="flex items-center gap-1 text-[11px] text-slate-500 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={!!waived[f.id]}
                        onChange={(e) => setWaived((prev) => ({ ...prev, [f.id]: e.target.checked }))}
                        className="w-3.5 h-3.5 rounded border-slate-300 text-teal-600"
                      />
                      waive
                    </label>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Preview */}
          <div className="bg-slate-50 rounded-xl border border-slate-200 px-3 py-2.5 space-y-1">
            {previewRows.map((r) => (
              <div key={r.id} className="flex justify-between text-xs">
                <span className="text-slate-600">{r.label}</span>
                <span className="font-semibold text-slate-800">{fmtMoney(r.amount)}</span>
              </div>
            ))}
            <div className="flex justify-between text-sm border-t border-slate-200 pt-1.5 mt-1">
              <span className="font-semibold text-slate-700">Package total</span>
              <span className="font-bold text-slate-900">{fmtMoney(previewTotal)}</span>
            </div>
            <p className="text-[10px] text-slate-500 pt-0.5">
              Inserted as itemized Additional Fees — edit or remove any line after.
            </p>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-slate-100 flex justify-end gap-3">
          <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700 font-semibold">Cancel</button>
          <button
            onClick={handleInsert}
            className="bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-4 py-2 rounded-xl transition"
          >
            Add {fmtMoney(previewTotal)} to Quote
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
