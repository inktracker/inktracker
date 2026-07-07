import { getJobAddons } from "@/lib/pricing/extrasScopes";
import { snapshotExtraForQuote } from "@/lib/pricing/extras";

// Quote-level "Job fees" toggles — the per_job add-on category. Applied ONCE for
// the whole order (not per line, not per piece), so they live here rather than
// on each line. Writes a { feeKey: snapshot } map to quote.job_extras; the
// engine (sumJobExtras) totals it into the order.
//
// Self-hides when the shop has configured no per_job fees.
export default function JobFeesSection({ addonsByScope, jobExtras, onChange }) {
  const jobAddons = getJobAddons(addonsByScope);
  if (!jobAddons.length) return null;
  const je = jobExtras || {};

  return (
    <div className="mt-4">
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">
        Job fees (whole order)
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
        {jobAddons.map(({ key, label, rate, mode }) => {
          const isOn = !!je[key];
          const isPercent = mode === "percent";
          const snapshot = snapshotExtraForQuote({ mode, rate: parseFloat(rate) || 0, basis: "per_job" });
          return (
            <button
              key={key}
              type="button"
              onClick={() => onChange({ ...je, [key]: isOn ? false : snapshot })}
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
