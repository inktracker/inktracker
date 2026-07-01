// Post-submit confirmation screen for the public OrderWizard — extracted
// verbatim from OrderWizard.jsx as part of a pure structural decomposition
// (zero behavior change). Presentational only.
import Icon from "@/components/shared/Icon";
import { fmtMoney } from "@/components/shared/pricing";

export default function WizardSuccessScreen({
  submittedGarments,
  validGarments,
  imprints,
  rush,
  liveTotals,
  total,
  bc,
  onReset,
}) {
  const showGarments = submittedGarments.length > 0 ? submittedGarments : validGarments;
  return (
    <div className="max-w-2xl mx-auto text-center py-16 space-y-6">
      <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
        <Icon name="check" className="w-8 h-8 text-emerald-600" />
      </div>
      <h2 className="text-3xl font-bold text-slate-900">Order Request Submitted</h2>
      <p className="text-slate-500 text-lg">We've received your request and will be in touch within 1 business day with a final quote and next steps.</p>
      <div className="bg-slate-50 rounded-2xl border border-slate-200 p-6 text-left space-y-3 text-sm">
        {showGarments.map((gg, idx) => {
          const gQty = Object.values(gg.sizes).reduce((a, v) => a + (parseInt(v) || 0), 0);
          return (
            <div key={gg.id} className={idx > 0 ? "border-t border-slate-200 pt-3" : ""}>
              <div className="flex justify-between"><span className="text-slate-500">Garment{showGarments.length > 1 ? ` ${idx + 1}` : ""}</span><span className="font-semibold">{gg.style.name || `${gg.style.brand || ""} ${gg.style.styleNumber || ""}`.trim() || "Item"} · {gg.color}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Quantity</span><span className="font-semibold">{gQty} pcs</span></div>
            </div>
          );
        })}
        <div className="flex justify-between"><span className="text-slate-500">Print</span><span className="font-semibold">{imprints.map(i => `${i.location} (${i.colors}c)`).join(", ")}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">Turnaround</span><span className="font-semibold">{rush ? "Rush — 7 days" : "Standard — 14 days"}</span></div>
        <div className="border-t border-slate-200 pt-2 flex justify-between font-bold text-base"><span>Estimated Total</span><span className="text-[var(--brand)]">{fmtMoney(liveTotals?.total || total)}</span></div>
      </div>
      <button onClick={onReset} style={{ backgroundColor: bc }} className="hover:opacity-90 text-white font-semibold px-6 py-3 rounded-xl transition">
        Start Another Order
      </button>
    </div>
  );
}
