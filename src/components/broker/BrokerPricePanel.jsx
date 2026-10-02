import {
  getQty,
  calcLinkedLinePrice,
  buildLinkedQtyMap,
  fmtMoney,
  BROKER_MARKUP,
  STANDARD_MARKUP,
  overrideRushFee,
} from "../shared/pricing";
import { resolveGarmentHeader } from "@/lib/quotes/garmentTitle";






function getMetaLine(li) {
  const parts = [];
  if (li?.brand) parts.push(`Brand: ${li.brand}`);
  if (li?.garmentColor) parts.push(`Color: ${li.garmentColor}`);
  return parts.join(" • ");
}

export default function BrokerPricePanel({
  li,
  rushRate,
  extras,
  allLineItems = [],
  onChange,
  sizePrices,
  // Config threading (CACHE-01 + per-broker overlay): brokerConfig is
  // the merged wholesale sheet for this broker, shopConfig the shop's
  // standard sheet for the retail suggestion. Both fall back to the
  // module global when absent (legacy callers).
  brokerConfig,
  shopConfig,
}) {
  const qty = getQty(li);

  const linkedQtyMap = buildLinkedQtyMap(allLineItems || []);

  const brokerRate = calcLinkedLinePrice(
    li,
    rushRate,
    extras,
    BROKER_MARKUP,
    linkedQtyMap,
    sizePrices,
    brokerConfig
  );

  const shopRate = calcLinkedLinePrice(
    li,
    rushRate,
    extras,
    STANDARD_MARKUP,
    linkedQtyMap,
    sizePrices,
    shopConfig
  );

  if (!brokerRate || !shopRate) {
    return (
      <div className="bg-slate-900 rounded-xl p-5 text-center text-slate-400 text-sm italic">
        Enter qty and at least one print location to see broker pricing.
      </div>
    );
  }


  const brokerAvgPpp = qty > 0 ? brokerRate.lineTotal / qty : 0;
  const brokerTotal = brokerRate.lineTotal;

  const suggestedShopAvgPpp = qty > 0 ? shopRate.lineTotal / qty : 0;
  const suggestedShopTotal = shopRate.lineTotal;

  // Broker's per-piece client price override. Falls back to the suggested rate.
  const pppOverride = Number(li?.clientPpp);
  const hasOverride = Number.isFinite(pppOverride) && pppOverride > 0;
  const shopAvgPpp = hasOverride ? pppOverride : suggestedShopAvgPpp;
  // Rush rides on top of a flat override (overrideRushFee), like the shop editor.
  const shopTotal = hasOverride ? pppOverride * qty + overrideRushFee(pppOverride, qty, rushRate) : suggestedShopTotal;

  // NOT clamped: a client price below the broker's wholesale cost is a real
  // loss the broker must see (the panel styles negatives red below), not a
  // false $0. Matches the quote-level readout in BrokerQuoteEditor.
  const profitPerPiece = shopAvgPpp - brokerAvgPpp;
  const orderProfit = shopTotal - brokerTotal;

  // Shared resolver — the SAME header the saved quote, PDF and client page use,
  // so this "Display Header Preview" can't drift (this panel used to carry a
  // 6th forked copy; Joe 2026-10-01).
  const headerLine = resolveGarmentHeader(li);
  const metaLine = getMetaLine(li);

  return (
    <div className="bg-slate-900 rounded-xl overflow-hidden border border-slate-800">
      <div className="bg-slate-800 px-4 py-2.5 flex justify-between items-center border-b border-slate-700">
        <span className="text-xs font-bold text-slate-300 uppercase tracking-widest">
          Broker Pricing
        </span>
        <span className="text-xs font-bold bg-emerald-600 text-white px-2.5 py-1 rounded-full">
          {qty} pcs
        </span>
      </div>

      <div className="p-4 border-b border-slate-800">
        <div className="text-xs font-bold text-teal-300 uppercase tracking-widest mb-2">
          Display Header Preview
        </div>
        <div className="text-2xl font-bold text-white leading-tight">
          {headerLine}
        </div>
        {metaLine && (
          <div className="text-sm text-slate-500 mt-2">
            {metaLine}
          </div>
        )}
      </div>

      <div className="p-4 space-y-2">
        {(brokerRate.printBreakdown || []).map((print, idx) => {
          // Same label scheme as PricePanel.jsx — keep the two views in sync.
          const tech = print.technique || "Screen Print";
          const label = print.isFirst
            ? `${tech} — ${print.location} (${print.colors}c)`
            : `+${tech} ${(print.groupIndex || 0) + 1} — ${print.location} (${print.colors}c)`;
          return (
            <div
              key={print.id || idx}
              className="flex justify-between text-xs border-b border-slate-800 pb-2"
            >
              <div>
                <div className="text-slate-300 font-semibold">{label}</div>
                <div className="text-slate-500">
                  Tier: {print.tier}+ from {print.tierQty} pcs{print.linked ? " · linked" : ""}
                </div>
              </div>
              <div className="text-right">
                <div className="text-white font-semibold">{fmtMoney(print.lineCost)}</div>
                <div className="text-slate-500">{fmtMoney(print.rate)}/pc</div>
              </div>
            </div>
          );
        })}

        <div className="flex justify-between text-xs border-b border-slate-800 pb-2">
          <div>
            <div className="text-slate-300 font-semibold">Garments</div>
            {brokerRate.gCost > 0 ? (
              <div className="text-slate-500">{fmtMoney(brokerRate.gCost / qty)}/pc avg</div>
            ) : (
              <div className="text-slate-500">No garment cost set</div>
            )}
          </div>
          <div className="text-right">
            <div className="text-white font-semibold">{fmtMoney(brokerRate.gCost)}</div>
          </div>
        </div>

        {brokerRate.extraCost > 0 && (
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">Add-ons</span>
            <span className="text-white font-semibold">{fmtMoney(brokerRate.extraCost)}</span>
          </div>
        )}

        {brokerRate.rushFee > 0 && (
          <div className="flex justify-between text-xs">
            <span className="text-orange-400">Rush Fee</span>
            <span className="text-orange-400 font-semibold">{fmtMoney(brokerRate.rushFee)}</span>
          </div>
        )}
      </div>

      <div className="px-4 py-4 bg-slate-950 border-t border-slate-800 border-b border-slate-800">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-slate-800/80 p-3 border border-slate-700">
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-1">
              Your Cost
            </div>
            <div className="text-lg font-bold text-white">{fmtMoney(brokerTotal)}</div>
            <div className="text-xs text-slate-500">{fmtMoney(brokerAvgPpp)}/pc avg</div>
          </div>

          <div className="rounded-lg bg-emerald-950 p-3 border border-emerald-900">
            <div className="flex items-start justify-between mb-1">
              <div className="text-[11px] font-bold text-emerald-400 uppercase tracking-widest">
                Your Client Price
              </div>
              {hasOverride && onChange && (
                <button
                  onClick={() => onChange({ ...li, clientPpp: null })}
                  className="text-[10px] text-emerald-300 hover:text-white underline"
                >
                  reset
                </button>
              )}
            </div>
            <div className="text-lg font-bold text-white">{fmtMoney(shopTotal)}</div>
            <div className="flex items-center gap-1 mt-1">
              <span className="text-xs text-emerald-300">$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={hasOverride ? pppOverride : ""}
                onChange={(e) => {
                  if (!onChange) return;
                  const v = e.target.value;
                  onChange({
                    ...li,
                    clientPpp: v === "" ? null : parseFloat(v),
                  });
                }}
                placeholder={suggestedShopAvgPpp.toFixed(2)}
                className="w-20 text-xs bg-emerald-900/40 border border-emerald-800 rounded px-1.5 py-0.5 text-white focus:outline-none focus:ring-1 focus:ring-emerald-400"
              />
              <span className="text-xs text-emerald-300">/pc</span>
              {!hasOverride && (
                <span className="text-[10px] text-emerald-400/70 ml-1">
                  (suggested)
                </span>
              )}
            </div>
          </div>
        </div>

        <div className={`mt-3 rounded-lg p-3 border ${orderProfit < 0 ? "bg-red-950/70 border-red-900" : "bg-teal-950/70 border-teal-900"}`}>
          <div className={`text-[11px] font-bold uppercase tracking-widest mb-2 ${orderProfit < 0 ? "text-red-300" : "text-teal-300"}`}>
            {orderProfit < 0 ? "Below Your Cost" : "Your Profit"}
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-slate-300">{orderProfit < 0 ? "Loss" : "Profit"} per piece</span>
            <span className={`font-semibold ${profitPerPiece < 0 ? "text-red-300" : "text-white"}`}>{fmtMoney(profitPerPiece)}</span>
          </div>
          <div className="flex justify-between items-center text-sm mt-1">
            <span className="text-slate-300">{orderProfit < 0 ? "Loss" : "Profit"} on this line</span>
            <span className={`font-semibold ${orderProfit < 0 ? "text-red-300" : "text-white"}`}>{fmtMoney(orderProfit)}</span>
          </div>
        </div>
      </div>

      <div className="bg-emerald-600 px-4 py-4 flex justify-between items-center">
        <div>
          <div className="text-xs font-bold text-emerald-100 uppercase tracking-widest mb-0.5">
            Broker Total
          </div>
          <div className="text-emerald-100 text-xs">{fmtMoney(brokerAvgPpp)}/pc avg</div>
        </div>
        <div className="text-2xl font-bold text-white">{fmtMoney(brokerTotal)}</div>
      </div>
    </div>
  );
}