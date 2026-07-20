import NumericInput from "@/components/shared/NumericInput";
import { normalizeEventPackages } from "@/lib/pricing/eventPackages";

// Account → Pricing → Event / Package Pricing. Flat-rate service
// packages (live event printing, on-site gigs) that don't fit the
// color×qty decoration matrices — Reagan's "Live In-Person Printing"
// sheet is the reference shape: tiered base prices with hour minimums,
// an hourly overage rate, per-shirt add-ons, and flat fees that can be
// waivable (art fee when art is supplied).
//
// Packages generate itemized additional_charges on a quote (via the
// "+ Event package" button in the quote editor) — no new money paths.
export default function EventPackagesEditor({ config, setConfig, inputCls }) {
  const ev = normalizeEventPackages(config.eventPackages);

  const update = (patch) => {
    setConfig((prev) => ({
      ...prev,
      eventPackages: { ...normalizeEventPackages(prev.eventPackages), ...patch },
    }));
  };

  const updatePackage = (idx, patch) => {
    update({ packages: ev.packages.map((p, i) => (i === idx ? { ...p, ...patch } : p)) });
  };

  const removePackage = (idx) => {
    update({ packages: ev.packages.filter((_, i) => i !== idx) });
  };

  return (
    <div>
      <label className="flex items-center gap-2 cursor-pointer select-none mb-1">
        <input
          type="checkbox"
          checked={ev.enabled}
          onChange={(e) => update({ enabled: e.target.checked })}
          className="w-4 h-4 rounded border-slate-300 text-teal-600"
        />
        <h4 className="text-xs font-bold text-slate-600 uppercase tracking-widest">Event / Package Pricing</h4>
      </label>
      <p className="text-[10px] text-slate-500 mb-2">
        Flat-rate packages for live events and on-site printing — tiered base prices with hour
        minimums, an hourly rate beyond the minimum, per-shirt add-ons, and flat fees. Quoting a
        package drops itemized charges onto the quote, editable like any other fee.
      </p>

      {ev.enabled && (
        <div className="border border-slate-200 rounded-xl p-3 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-slate-600 uppercase tracking-widest">Additional Hours</span>
            <div className="relative w-24">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-slate-500 pointer-events-none">$</span>
              <NumericInput
                value={ev.hourlyRate}
                onChange={(n) => update({ hourlyRate: Math.max(0, Number(n) || 0) })}
                min={0}
                max={10000}
                label="Event hourly overage rate"
                className={`${inputCls} pl-5`}
              />
            </div>
            <span className="text-[10px] text-slate-500">per hour beyond a package&apos;s minimum</span>
          </div>

          {ev.packages.map((p, idx) => (
            <div key={p.id} className="border border-slate-100 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={p.label}
                  onChange={(e) => updatePackage(idx, { label: e.target.value })}
                  placeholder='Package name (e.g. "Tier 2: 50 tees included")'
                  className="flex-1 text-xs font-semibold border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-300"
                />
                <button
                  onClick={() => removePackage(idx)}
                  className="text-slate-300 hover:text-red-500 transition text-sm"
                  title="Remove package"
                >&times;</button>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-slate-500">Base</span>
                  <div className="relative w-24">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-slate-500 pointer-events-none">$</span>
                    <NumericInput
                      value={p.basePrice}
                      onChange={(n) => updatePackage(idx, { basePrice: Math.max(0, Number(n) || 0) })}
                      min={0}
                      max={100000}
                      label={`${p.label || "package"} base price`}
                      className={`${inputCls} pl-5`}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-slate-500">Minimum</span>
                  <div className="relative w-20">
                    <NumericInput
                      value={p.minHours}
                      onChange={(n) => updatePackage(idx, { minHours: Math.max(0, Number(n) || 0) })}
                      min={0}
                      max={100}
                      label={`${p.label || "package"} minimum hours`}
                      className={inputCls}
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-500 pointer-events-none">hrs</span>
                  </div>
                </div>
                <input
                  type="text"
                  value={p.notes}
                  onChange={(e) => updatePackage(idx, { notes: e.target.value })}
                  placeholder="Notes shown when picking (e.g. what's included)"
                  className="flex-1 min-w-[160px] text-[11px] border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-300"
                />
              </div>

              {/* Flat fees */}
              <div className="space-y-1">
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Flat fees</div>
                {p.fees.map((f, fIdx) => (
                  <div key={f.id} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={f.label}
                      onChange={(e) => updatePackage(idx, { fees: p.fees.map((x, i) => (i === fIdx ? { ...x, label: e.target.value } : x)) })}
                      placeholder="Fee name (e.g. Screen fee)"
                      className="flex-1 text-[11px] border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-teal-300"
                    />
                    <div className="relative w-20">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-500 pointer-events-none">$</span>
                      <NumericInput
                        value={f.amount}
                        onChange={(n) => updatePackage(idx, { fees: p.fees.map((x, i) => (i === fIdx ? { ...x, amount: Math.max(0, Number(n) || 0) } : x)) })}
                        min={0}
                        max={10000}
                        label={`${f.label || "fee"} amount`}
                        className={`${inputCls} pl-5`}
                      />
                    </div>
                    <label className="flex items-center gap-1 text-[10px] text-slate-500 cursor-pointer whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={f.waivable}
                        onChange={(e) => updatePackage(idx, { fees: p.fees.map((x, i) => (i === fIdx ? { ...x, waivable: e.target.checked } : x)) })}
                        className="w-3.5 h-3.5 rounded border-slate-300 text-teal-600"
                      />
                      waivable
                    </label>
                    <button
                      onClick={() => updatePackage(idx, { fees: p.fees.filter((_, i) => i !== fIdx) })}
                      className="text-slate-300 hover:text-red-500 text-sm"
                      title="Remove fee"
                    >&times;</button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => updatePackage(idx, { fees: [...p.fees, { id: `fee_${Date.now()}`, label: "", amount: 0, waivable: false }] })}
                  className="text-[10px] font-semibold text-teal-600 hover:text-teal-700"
                >+ Add fee</button>
              </div>

              {/* Per-unit add-ons */}
              <div className="space-y-1">
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Per-unit add-ons</div>
                {p.addOns.map((a, aIdx) => (
                  <div key={a.id} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={a.label}
                      onChange={(e) => updatePackage(idx, { addOns: p.addOns.map((x, i) => (i === aIdx ? { ...x, label: e.target.value } : x)) })}
                      placeholder="Add-on (e.g. Extra Gildans)"
                      className="flex-1 text-[11px] border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-teal-300"
                    />
                    <div className="relative w-20">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-500 pointer-events-none">$</span>
                      <NumericInput
                        value={a.rate}
                        onChange={(n) => updatePackage(idx, { addOns: p.addOns.map((x, i) => (i === aIdx ? { ...x, rate: Math.max(0, Number(n) || 0) } : x)) })}
                        min={0}
                        max={10000}
                        label={`${a.label || "add-on"} rate`}
                        className={`${inputCls} pl-5`}
                      />
                    </div>
                    <span className="text-[10px] text-slate-500">per</span>
                    <input
                      type="text"
                      value={a.unit}
                      onChange={(e) => updatePackage(idx, { addOns: p.addOns.map((x, i) => (i === aIdx ? { ...x, unit: e.target.value } : x)) })}
                      className="w-16 text-[11px] border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-teal-300"
                    />
                    <button
                      onClick={() => updatePackage(idx, { addOns: p.addOns.filter((_, i) => i !== aIdx) })}
                      className="text-slate-300 hover:text-red-500 text-sm"
                      title="Remove add-on"
                    >&times;</button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => updatePackage(idx, { addOns: [...p.addOns, { id: `addon_${Date.now()}`, label: "", rate: 0, unit: "shirt" }] })}
                  className="text-[10px] font-semibold text-teal-600 hover:text-teal-700"
                >+ Add add-on</button>
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={() => update({
              packages: [...ev.packages, {
                id: `pkg_${Date.now()}`,
                label: "",
                basePrice: 0,
                minHours: 4,
                notes: "",
                fees: [],
                addOns: [],
              }],
            })}
            className="text-xs font-semibold text-teal-600 hover:text-teal-700"
          >+ Add package</button>
        </div>
      )}
    </div>
  );
}
