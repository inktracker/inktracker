import { normalizeShipTo, isShipToComplete, isShipToEmpty } from "@/lib/tax/address";

// Generic structured address (street / city / state / zip). Shared by the
// customer form (Billing + Shipping) and the quote editor. `taxHint` shows the
// sales-tax sourcing hints (shipping only); `onSameAsBilling` renders the
// "Same as billing" copy button.
export default function AddressFields({ value, onChange, label, sublabel, taxHint = false, onSameAsBilling }) {
  const v = normalizeShipTo(value || {});
  const set = (k, val) => onChange(normalizeShipTo({ ...v, [k]: val }));
  const complete = isShipToComplete(v);
  const empty = isShipToEmpty(v);

  const inputCls =
    "w-full text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-300";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide">
          {label}
          {sublabel && <span className="normal-case font-medium text-slate-400"> — {sublabel}</span>}
        </label>
        {onSameAsBilling && (
          <button
            type="button"
            onClick={onSameAsBilling}
            className="text-[11px] font-semibold text-teal-600 hover:text-teal-700 underline"
          >
            Same as billing
          </button>
        )}
      </div>

      <input
        type="text"
        value={v.street}
        onChange={(e) => set("street", e.target.value)}
        placeholder="Street"
        className={inputCls}
      />
      <div className="grid grid-cols-6 gap-2">
        <input
          type="text"
          value={v.city}
          onChange={(e) => set("city", e.target.value)}
          placeholder="City"
          className={`${inputCls} col-span-3`}
        />
        <input
          type="text"
          value={v.state}
          onChange={(e) => set("state", e.target.value.toUpperCase().slice(0, 2))}
          placeholder="ST"
          maxLength={2}
          className={`${inputCls} col-span-1 uppercase`}
        />
        <input
          type="text"
          value={v.zip}
          onChange={(e) => set("zip", e.target.value)}
          placeholder="ZIP"
          className={`${inputCls} col-span-2`}
        />
      </div>

      {taxHint && !empty && !complete && (
        <p className="text-[11px] text-amber-600">
          Add the <b>state</b> and <b>ZIP</b> so QuickBooks calculates tax for the delivery
          location. Without them it falls back to your shop's home rate.
        </p>
      )}
      {taxHint && complete && (
        <p className="text-[11px] text-emerald-600">
          ✓ Sales tax will be calculated for {v.city ? `${v.city}, ` : ""}{v.state} {v.zip}.
        </p>
      )}
    </div>
  );
}
