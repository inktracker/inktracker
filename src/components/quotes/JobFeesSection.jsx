import { useEffect } from "react";
import { getJobAddons } from "@/lib/pricing/extrasScopes";
import { computeJobFeeAmount } from "@/lib/pricing/extras";

// Quote-level "Job fees" toggles — the per_job add-on category, applied ONCE for
// the whole order. Rather than a parallel storage, toggling a fee writes an
// entry into the quote's additional_charges (tagged id `jobfee_<key>`), so it
// rides the ONE additional-charges pipeline that QuickBooks, every display, the
// PDF, the payment page, and quote→order conversion already handle. That
// guarantees the fee shows and bills consistently everywhere.
//
// A percent fee is stored as a flat dollar amount in additional_charges (so it
// rides the one pipeline), but it must stay equal to X% of the CURRENT subtotal.
// The effect below recomputes active percent fees whenever the subtotal changes
// (e.g. the shop edits quantities) — previously the amount was frozen at toggle
// time, so it silently under/over-charged until re-toggled. Self-hides when the
// shop has configured no per_job fees.
const jobFeeId = (key) => `jobfee_${key}`;

export default function JobFeesSection({ addonsByScope, additionalCharges, subtotal = 0, onChange }) {
  const jobAddons = getJobAddons(addonsByScope);
  const charges = Array.isArray(additionalCharges) ? additionalCharges : [];

  // Keep active percent job fees in sync with the subtotal. Deps are [subtotal]
  // only: after onChange updates additional_charges, the subtotal (a line-item
  // figure that excludes these fees) is unchanged, so the effect doesn't re-run
  // — no loop. A derived value tracking its input is correct, not a clobber.
  useEffect(() => {
    if (!jobAddons.length) return;
    let changed = false;
    const next = charges.map((c) => {
      if (typeof c?.id !== "string" || !c.id.startsWith("jobfee_")) return c;
      const addon = jobAddons.find((a) => jobFeeId(a.key) === c.id);
      if (!addon || addon.mode !== "percent") return c;
      const fresh = computeJobFeeAmount({ mode: "percent", rate: parseFloat(addon.rate) || 0 }, subtotal);
      if (fresh !== c.amount) { changed = true; return { ...c, amount: fresh }; }
      return c;
    });
    if (changed) onChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtotal]);

  if (!jobAddons.length) return null;

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
    // Taxability comes from the fee's pricing-config setting (Account →
    // Pricing → per-job fee "Tax" checkbox). The shop can still flip it
    // per-quote on the row this writes into Additional Fees.
    onChange([...charges, { id, label: addon.label, amount, taxable: addon.taxable !== false }]);
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
