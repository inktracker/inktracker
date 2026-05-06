import {
  getQty,
  calcLinkedLinePrice,
  buildLinkedQtyMap,
  fmtMoney,
  getMarkup,
  BROKER_MARKUP,
} from "../shared/pricing";

export default function PricePanel({ li, rushRate, extras, allLineItems = [], markup, onChange }) {
  const qty = getQty(li);
  const linkedQtyMap = buildLinkedQtyMap(allLineItems);
  const r = calcLinkedLinePrice(li, rushRate, extras, markup, linkedQtyMap);

  if (!r) {
    return (
      <div className="bg-slate-900 rounded-xl p-5 text-center text-slate-400 text-sm italic">
        Enter qty and at least one print location to see pricing.
      </div>
    );
  }

  const rushFee = r.rushFee || 0;

  const pppOverride = Number(li?.clientPpp);
  const hasOverride = Number.isFinite(pppOverride) && pppOverride > 0;

  const suggestedPpp = r.ppp;
  const avgPpp = hasOverride ? pppOverride : suggestedPpp;
  const displayTotal = hasOverride ? (pppOverride * qty + r.oversizeCost + rushFee) : r.lineTotal;

  return (
    <div className="bg-slate-900 rounded-xl overflow-hidden border border-slate-800">
      <div className="bg-slate-800 px-4 py-2.5 flex justify-between items-center border-b border-slate-700">
        <span className="text-xs font-bold text-slate-300 uppercase tracking-widest">
          Live Pricing
        </span>
        <span className="text-xs font-bold bg-indigo-600 text-white px-2.5 py-1 rounded-full">
          {qty} pcs
        </span>
      </div>

      <div className="p-4 space-y-2">
        {(r.printBreakdown || []).map((print, idx) => (
          <div key={print.id || idx} className="flex justify-between text-xs border-b border-slate-800 pb-2">
            <div>
              <div className="text-slate-300 font-semibold">
                {print.isFirst ? "1st Print" : `+Print ${idx + 1}`} — {print.location} ({print.colors}c)
              </div>
              <div className="text-slate-500">
                Tier: {print.tier}+ from {print.tierQty} pcs{print.linked ? " · linked" : ""}
              </div>
            </div>
            <div className="text-right">
              <div className="text-white font-semibold">{fmtMoney(print.lineCost)}</div>
              <div className="text-slate-500">{fmtMoney(print.rate)}/pc</div>
            </div>
          </div>
        ))}

        <div className="flex justify-between text-xs border-b border-slate-800 pb-2">
          <div>
            <div className="text-slate-300 font-semibold">Garments</div>
            {r.gCost > 0 ? (
              <div className="text-slate-500">{fmtMoney(r.gCost / r.qty)}/pc avg</div>
            ) : (
              <div className="text-slate-500">No garment cost set</div>
            )}
          </div>
          <div className="text-right">
            <div className="text-white font-semibold">{fmtMoney(r.gCost)}</div>
          </div>
        </div>

        {r.extraCost > 0 && (
          <div className="flex justify-between text-xs">
            <span className="text-slate-400">Add-ons</span>
            <span className="text-white font-semibold">{fmtMoney(r.extraCost)}</span>
          </div>
        )}

        {r.oversizeCost > 0 && (
          <div className="flex justify-between text-xs">
            <span className="text-amber-400">2XL+ Surcharge</span>
            <span className="text-amber-400 font-semibold">{fmtMoney(r.oversizeCost)}</span>
          </div>
        )}

        {rushFee > 0 && (
          <div className="flex justify-between text-xs border-t border-slate-800 pt-2">
            <span className="text-orange-400">Rush Fee ({Math.round((parseFloat(rushRate) || 0) * 100)}%)</span>
            <span className="text-orange-400 font-semibold">{fmtMoney(rushFee)}</span>
          </div>
        )}
      </div>

      {onChange && (
        <div className="px-4 py-3 bg-slate-950 border-t border-slate-800">
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">
              Override price per piece
            </div>
            {hasOverride && (
              <button
                onClick={() => onChange({ ...li, clientPpp: null })}
                className="text-[10px] text-slate-400 hover:text-white underline"
              >
                reset
              </button>
            )}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-slate-400 text-xs">$</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={hasOverride ? pppOverride : ""}
              onChange={(e) => {
                const v = e.target.value;
                onChange({ ...li, clientPpp: v === "" ? null : parseFloat(v) });
              }}
              placeholder={(qty > 0 ? suggestedPpp : 0).toFixed(2)}
              className="w-24 text-xs bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 text-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
            <span className="text-xs text-slate-400">/pc</span>
            {!hasOverride && (
              <span className="text-[10px] text-slate-500 ml-1">(suggested)</span>
            )}
          </div>
        </div>
      )}

      <div className="bg-indigo-600 px-4 py-4 flex justify-between items-center">
        <div>
          <div className="text-xs font-bold text-indigo-100 uppercase tracking-widest mb-0.5">
            Line Total
          </div>
          <div className="text-indigo-100 text-xs">{fmtMoney(avgPpp)}/pc avg</div>
        </div>
        <div className="text-2xl font-bold text-white">{fmtMoney(displayTotal)}</div>
      </div>
    </div>
  );
}
