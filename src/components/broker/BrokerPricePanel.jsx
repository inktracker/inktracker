import {
  getQty,
  BIG_SIZES,
  calcLinkedLinePrice,
  buildLinkedQtyMap,
  fmtMoney,
  getMarkup,
  BROKER_MARKUP,
  STANDARD_MARKUP,
} from "../shared/pricing";

function cleanText(value) {
  return String(value || "").trim();
}

function extractTrailingCode(title) {
  const txt = cleanText(title);
  if (!txt) return "";
  const match = txt.match(/-\s*([A-Z0-9-]{2,20})$/i);
  return match ? cleanText(match[1]) : "";
}

function stripTrailingCode(title) {
  const txt = cleanText(title);
  if (!txt) return "";
  return txt.replace(/\s*-\s*[A-Z0-9-]{2,20}\s*$/i, "").trim();
}

function looksLikeCode(value) {
  const txt = cleanText(value);
  if (!txt) return false;
  return /^[A-Z0-9-]{2,20}$/i.test(txt) && /\d/.test(txt) && !txt.includes(" ");
}

function isWarehouseSku(value) {
  const txt = cleanText(value);
  if (!txt) return false;
  return /^0\d{3,}$/.test(txt);
}

function getDisplayStyleNumber(li) {
  const strongCandidates = [
    li?.supplierStyleNumber,
    li?.resolvedStyleNumber,
    li?.styleNumber,
    li?.garmentNumber,
    li?.productNumber,
  ];

  for (const candidate of strongCandidates) {
    const value = cleanText(candidate).toUpperCase();
    if (!value) continue;
    if (isWarehouseSku(value)) continue;
    if (!looksLikeCode(value)) continue;
    return value;
  }

  const productTail = extractTrailingCode(li?.productTitle).toUpperCase();
  if (productTail && !isWarehouseSku(productTail) && looksLikeCode(productTail)) {
    return productTail;
  }

  const resolvedTail = extractTrailingCode(li?.resolvedTitle).toUpperCase();
  if (resolvedTail && !isWarehouseSku(resolvedTail) && looksLikeCode(resolvedTail)) {
    return resolvedTail;
  }

  const rawStyle = cleanText(li?.style).toUpperCase();
  if (rawStyle && !isWarehouseSku(rawStyle) && looksLikeCode(rawStyle)) {
    return rawStyle;
  }

  return rawStyle || "GARMENT";
}

function getDisplayDescription(li) {
  const styleNumber = getDisplayStyleNumber(li).toLowerCase();

  const candidates = [
    stripTrailingCode(li?.productTitle),
    stripTrailingCode(li?.resolvedTitle),
    cleanText(li?.styleName),
    cleanText(li?.resolvedDescription),
    cleanText(li?.productDescription),
    cleanText(li?.product_description),
    cleanText(li?.description),
    cleanText(li?.garmentName),
    cleanText(li?.displayName),
    cleanText(li?.title),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const normalized = candidate.toLowerCase();

    if (normalized === styleNumber) continue;
    if (looksLikeCode(candidate)) continue;
    if (normalized === "shirt") continue;
    if (normalized === "garment") continue;

    return candidate;
  }

  return "";
}

function getHeaderLine(li) {
  const styleNumber = getDisplayStyleNumber(li);
  const description = getDisplayDescription(li);
  return description ? `${styleNumber} - ${description}` : styleNumber;
}

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
}) {
  const qty = getQty(li);
  const twoXL = BIG_SIZES.reduce(
    (sum, sz) => sum + (parseInt((li?.sizes || {})[sz], 10) || 0),
    0
  );

  const linkedQtyMap = buildLinkedQtyMap(allLineItems || []);

  const brokerRate = calcLinkedLinePrice(
    li,
    rushRate,
    extras,
    BROKER_MARKUP,
    linkedQtyMap
  );

  const shopRate = calcLinkedLinePrice(
    li,
    rushRate,
    extras,
    STANDARD_MARKUP,
    linkedQtyMap
  );

  if (!brokerRate || !shopRate) {
    return (
      <div className="bg-slate-900 rounded-xl p-5 text-center text-slate-400 text-sm italic">
        Enter qty and at least one print location to see broker pricing.
      </div>
    );
  }

  const twoXLCharge = twoXL * 2;

  const brokerAvgPpp = brokerRate.ppp + (qty > 0 ? twoXLCharge / qty : 0);
  const brokerTotal = brokerRate.sub + twoXLCharge;

  const suggestedShopAvgPpp = shopRate.ppp + (qty > 0 ? twoXLCharge / qty : 0);
  const suggestedShopTotal = shopRate.sub + twoXLCharge;

  // Broker's per-piece client price override. Falls back to the suggested rate.
  const pppOverride = Number(li?.clientPpp);
  const hasOverride = Number.isFinite(pppOverride) && pppOverride > 0;
  const shopAvgPpp = hasOverride ? pppOverride : suggestedShopAvgPpp;
  const shopTotal = hasOverride ? pppOverride * qty : suggestedShopTotal;

  const profitPerPiece = Math.max(0, shopAvgPpp - brokerAvgPpp);
  const orderProfit = Math.max(0, shopTotal - brokerTotal);

  const headerLine = getHeaderLine(li);
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
        <div className="text-xs font-bold text-indigo-300 uppercase tracking-widest mb-2">
          Display Header Preview
        </div>
        <div className="text-2xl font-bold text-white leading-tight">
          {headerLine}
        </div>
        {metaLine && (
          <div className="text-sm text-slate-400 mt-2">
            {metaLine}
          </div>
        )}
      </div>

      <div className="p-4 space-y-2">
        {(brokerRate.printBreakdown || []).map((print, idx) => (
          <div
            key={print.id || idx}
            className="flex justify-between text-xs border-b border-slate-800 pb-2"
          >
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

        {/* Garments line: shows base cost + broker markup % so the breakdown
            is transparent (broker markup is a partial share of the admin markup). */}
        {(() => {
          const baseCost = parseFloat(li?.garmentCost) || 0;
          const markupRatio = baseCost > 0 ? getMarkup(baseCost, true) : 1;
          const markedUpPerPc = baseCost * markupRatio;
          const markupPct = Math.round((markupRatio - 1) * 100);
          return (
            <div className="flex justify-between text-xs border-b border-slate-800 pb-2">
              <div>
                <div className="text-slate-300 font-semibold">Garments</div>
                {baseCost > 0 ? (
                  <div className="text-slate-500">
                    {fmtMoney(baseCost)} cost {markupPct > 0 ? `+ ${markupPct}% markup` : ""}
                  </div>
                ) : (
                  <div className="text-slate-500">No garment cost set</div>
                )}
              </div>
              <div className="text-right">
                <div className="text-white font-semibold">{fmtMoney(brokerRate.gCost)}</div>
                {baseCost > 0 && (
                  <div className="text-slate-500">{fmtMoney(markedUpPerPc)}/pc</div>
                )}
              </div>
            </div>
          );
        })()}

        {brokerRate.extraCost > 0 && (
          <div className="flex justify-between text-xs">
            <span className="text-slate-400">Add-ons</span>
            <span className="text-white font-semibold">{fmtMoney(brokerRate.extraCost)}</span>
          </div>
        )}

        {twoXLCharge > 0 && (
          <div className="flex justify-between text-xs">
            <span className="text-amber-400">2XL+ Surcharge</span>
            <span className="text-amber-400 font-semibold">{fmtMoney(twoXLCharge)}</span>
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
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1">
              Your Cost
            </div>
            <div className="text-lg font-bold text-white">{fmtMoney(brokerTotal)}</div>
            <div className="text-xs text-slate-400">{fmtMoney(brokerAvgPpp)}/pc avg</div>
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

        <div className="mt-3 rounded-lg bg-indigo-950/70 p-3 border border-indigo-900">
          <div className="text-[11px] font-bold text-indigo-300 uppercase tracking-widest mb-2">
            Your Profit At Shop Rate
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-slate-300">Profit per piece</span>
            <span className="text-white font-semibold">{fmtMoney(profitPerPiece)}</span>
          </div>
          <div className="flex justify-between items-center text-sm mt-1">
            <span className="text-slate-300">Profit on this order</span>
            <span className="text-white font-semibold">{fmtMoney(orderProfit)}</span>
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