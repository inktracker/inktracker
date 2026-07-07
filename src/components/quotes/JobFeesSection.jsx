import { getJobAddons } from "@/lib/pricing/extrasScopes";
import { computeJobFeeAmount } from "@/lib/pricing/extras";

// Quote-level "Job fees" toggles — the per_job add-on category, applied ONCE for
// the whole order. Rather than a parallel storage, toggling a fee writes an
// entry into the quote's additional_charges (tagged id `jobfee_<key>`), so it
// rides the ONE additional-charges pipeline that QuickBooks, every display, the
// PDF, the payment page, and quote→order conversion already handle. That
// guarantees the fee shows and bills consistently everywhere.
//
// A percent fee's dollar amount is snapshotted from the current subtotal when
// toggled on (re-toggle to refresh) — matching how additional_charges are flat
// stored amounts. Self-hides when the shop has configured no per_job fees.
const jobFeeId = (key) => `jobfee_${key}`;

export default function JobFeesSection({ addonsByScope, additionalCharges, subtotal = 0, onChange }) {
  const jobAddons = getJobAddons(addonsByScope);
  if (!jobAddons.length) return null;
  const charges = Array.isArray(additionalCharges) ? additionalCharges : [];

  const toggle = (addon) => {
    const id = jobFeeId(addon.key);
    const isOn = charges.some((c) => c?.id === id);
    if (isOn) {
      onChange(charges.filter((c) => c?.id !== id));
      return;
    }
    const amount = computeJobFeeAmount(
      { mode: addon.mode, rate: parseFloat(addon.rate) || 0 },
      subtotal
    );
    onChange([...charges, { id, label: addon.label, amount, taxable: true }]);
  };

  return (
    <div className="mt-4">
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">
        Job fees (whole order)
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
        {jobAddons.map((addon) => {
          const { key, label, rate, mode } = addon;
          const isOn = charges.some((c) => c?.id === jobFeeId(key));
          const isPercent = mode === "percent";
          return (
            <button
              key={key}
              type="button"
              onClick={() => toggle(addon)}
              className={`rounded-lg border px-2 py-1.5 text-left transition ${
                isOn ? "border-teal-600 bg-teal-50" : "border-slate-200 hover:border-slate-300 bg-white"
              }`}
            >
              <div className={`text-[11px] font-semibold leading-tight ${isOn ? "text-teal-700" : "text-slate-700"}`}>
                {label}
              </div>
              <div className="text-[10px] text-slate-500 leading-tight">
                {isPercent
                  ? `+${(parseFloat(rate) || 0).toFixed(parseFloat(rate) % 1 === 0 ? 0 : 2)}% of subtotal`
                  : `+$${(parseFloat(rate) || 0).toFixed(2)} / order`}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
