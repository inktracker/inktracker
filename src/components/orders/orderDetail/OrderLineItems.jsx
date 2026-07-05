import { ShoppingCart } from "lucide-react";
import {
  calcLinkedLinePrice,
  buildLinkedQtyMap,
  getLineExtras,
  fmtMoney,
  getQty,
  getShortfallQty,
  getCompletedQty,
  SIZES,
  BROKER_MARKUP,
  getShopPricingConfig,
} from "../../shared/pricing";
import { imprintCountText } from "@/lib/quotes/imprintLabels";
import { totalOrderShortfall } from "@/lib/orders/shortfallReorder";
import { getImprintArtwork } from "./orderDetailHelpers";

// Line-items display for the Order Detail modal: per-line pricing table,
// per-imprint design breakdown, order totals, notes, and the reorder-
// shortfall banner. Pure decomposition — moved verbatim from
// OrderDetailModal.jsx. All computed values (pricing, discount factor,
// shortfall) are threaded in as props so the math stays identical.
export default function OrderLineItems({
  order,
  liveOrder,
  isBrokerOrder,
  totals,
  isFlat,
  discVal,
  lineDiscountFactor,
  setPreviewArt,
  handleReorderShortfall,
  reorderCreating,
}) {
  return (
    <>
      {(liveOrder.line_items || []).map((li) => {
        const qty = getQty(li);
        const shortfallQty = getShortfallQty(li);
        const completedQty = getCompletedQty(li);
        const markup = isBrokerOrder ? BROKER_MARKUP : undefined;
        const linkedQtyMap = buildLinkedQtyMap(liveOrder.line_items || []);
        // Use saved pricing from "calculate once"; fall back to live calc for legacy
        const hasSaved = Number.isFinite(li._ppp) && li._ppp > 0 && Number.isFinite(li._lineTotal);
        const clientPppOverride = Number(li?.clientPpp);
        const useClientPpp = !hasSaved && markup === undefined && Number.isFinite(clientPppOverride) && clientPppOverride > 0 && qty > 0;
        const r = hasSaved
          ? { lineTotal: li._lineTotal, ppp: li._ppp, regularPpp: li._ppp, oversizePpp: li._ppp }
          : useClientPpp
            ? { lineTotal: clientPppOverride * qty, ppp: clientPppOverride, regularPpp: clientPppOverride, oversizePpp: clientPppOverride, overridden: true }
            : calcLinkedLinePrice(li, order.rush_rate, getLineExtras(li, order), markup, linkedQtyMap);
        const activeSizes = SIZES.filter(
          (sz) => (parseInt((li.sizes || {})[sz]) || 0) > 0
        );
        return (
          <div key={li.id} className="border border-slate-200 dark:border-slate-700 border-l-4 border-l-teal-600 rounded-xl overflow-hidden shadow-sm">
            <div className="bg-slate-100 dark:bg-slate-800 px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
              <div>
                <span className="font-bold text-slate-900 dark:text-slate-100 text-base">
                  {li.style || "Garment"}
                </span>
                {li.garmentColor && (
                  <span className="ml-2 text-xs text-slate-500">· {li.garmentColor}</span>
                )}
                <span className="ml-2 text-xs text-slate-500">
                  Wholesale: {fmtMoney(li.garmentCost)}
                </span>
              </div>
              {r && (
                <span className="font-bold text-slate-700 text-sm">
                  {fmtMoney(r.lineTotal)}
                </span>
              )}
            </div>

            {activeSizes.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                      <td className="px-4 py-2 text-xs text-slate-500 font-semibold">
                        Size
                      </td>
                      {activeSizes.map((sz) => (
                        <td
                          key={sz}
                          className="px-3 py-2 text-center text-xs font-semibold text-slate-600"
                        >
                          {sz}
                        </td>
                      ))}
                      <td className="px-4 py-2 text-center text-xs font-semibold text-slate-600">
                        Total
                      </td>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="px-4 py-2 text-xs text-slate-500">Qty</td>
                      {activeSizes.map((sz) => (
                        <td
                          key={sz}
                          className="px-3 py-2 text-center font-semibold text-slate-800 dark:text-slate-200"
                        >
                          {(li.sizes || {})[sz] || 0}
                        </td>
                      ))}
                      <td className="px-4 py-2 text-center font-bold text-slate-800 dark:text-slate-200">
                        {qty}
                      </td>
                    </tr>
                    {r && (
                      <tr>
                        <td className="px-4 py-2 text-xs text-slate-500">Price/ea</td>
                        {activeSizes.map((sz) => (
                          <td
                            key={sz}
                            className="px-3 py-2 text-center text-xs text-slate-500"
                          >
                            {fmtMoney(r.ppp)}
                          </td>
                        ))}
                        <td className="px-4 py-2 text-center text-xs font-bold text-slate-700">
                          {fmtMoney(r.lineTotal)}
                        </td>
                      </tr>
                    )}
                    {/* Shortfall entry moved to Floor Mode (Printing
                        step) — misprints are logged by the shop floor
                        worker, not by whoever opens the order detail.
                        The read-only "Completed" total row below still
                        renders here when shortfall > 0 so the pricing
                        table reflects the adjusted net qty. */}
                    {shortfallQty > 0 && (
                      <tr className="bg-emerald-50/40 border-t border-emerald-100">
                        <td className="px-4 py-2 text-xs text-emerald-700 font-semibold">
                          Completed
                        </td>
                        {activeSizes.map((sz) => {
                          const sizeQty = (li.sizes || {})[sz] || 0;
                          const sizeShort = (li._shortfall || {})[sz] || 0;
                          return (
                            <td key={sz} className="px-3 py-2 text-center text-xs font-semibold text-emerald-800">
                              {Math.max(0, sizeQty - sizeShort)}
                            </td>
                          );
                        })}
                        <td className="px-4 py-2 text-center text-xs font-bold text-emerald-800">
                          {completedQty} of {qty}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            <div className="border-t border-slate-200 dark:border-slate-700 p-4 space-y-3">
              {(li.imprints || []).map((imp) => {
                const art = getImprintArtwork(imp);

                return (
                  <div key={imp.id} className="space-y-2.5">
                    {imp.title && <div className="text-xs font-bold text-slate-800 dark:text-slate-200">{imp.title}</div>}
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-2 border border-slate-100 dark:border-slate-700">
                      <span className="font-bold text-slate-800 dark:text-slate-200">{imp.location}</span>
                      <span className="text-slate-500">
                        {imprintCountText(imp, getShopPricingConfig()?.embroidery?.stitchTiers)} · {imp.technique}
                      </span>
                      {imp.pantones && (
                        <span className="text-teal-600 font-medium">{imp.pantones}</span>
                      )}
                      {imp.details && (
                        <span className="text-slate-500 italic">{imp.details}</span>
                      )}
                    </div>
                    {(imp.width || imp.height) && (
                      <div className="flex gap-2 text-xs text-slate-500">
                        {imp.width && <span>Width: {imp.width}</span>}
                        {imp.height && <span>Height: {imp.height}</span>}
                      </div>
                    )}

                    {art && (
                      <div className="bg-teal-50 border border-teal-100 rounded-xl px-4 py-3">
                        <div className="text-[11px] font-bold uppercase tracking-widest text-teal-400 mb-2">
                          Attached Artwork
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">
                              {art.name}
                            </div>
                            {art.note && (
                              <div className="text-xs text-slate-500 truncate mt-0.5">
                                {art.note}
                              </div>
                            )}
                            {art.colors && (
                              <div className="text-xs text-teal-600 font-semibold mt-1">
                                Artwork colors: {art.colors}
                              </div>
                            )}
                          </div>

                          {art.url ? (
                            <button
                              type="button"
                              onClick={() => setPreviewArt(art)}
                              className="shrink-0 text-xs font-semibold text-teal-600 border border-teal-200 px-3 py-1.5 rounded-lg hover:bg-teal-50 transition"
                            >
                              Open
                            </button>
                          ) : null}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {r && (
                <div className="bg-teal-50 border border-teal-100 rounded-lg px-3 py-2 space-y-1">
                  <div className="flex justify-between text-xs text-slate-600">
                    <span>Line Subtotal</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {fmtMoney(r.lineTotal)}
                    </span>
                  </div>
                  {parseFloat(order.discount) > 0 && (() => {
                    const lineSub = r.lineTotal;
                    const lineAfterDisc = lineSub * lineDiscountFactor;
                    return (
                      <div className="flex justify-between text-xs text-emerald-600">
                        <span>After Discount</span>
                        <span className="font-semibold">
                          {fmtMoney(lineAfterDisc)}
                        </span>
                      </div>
                    );
                  })()}
                  <div className="flex justify-between text-xs text-slate-600 border-t border-teal-200 pt-1">
                    <span>Final Cost (incl. tax)</span>
                    <span className="font-bold text-teal-700">
                      {fmtMoney(
                        r.lineTotal * lineDiscountFactor *
                          (1 + parseFloat(order.tax_rate) / 100)
                      )}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {totals && (
        <div className="bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2">
          <div className="flex justify-between text-sm text-slate-500">
            <span>Subtotal</span>
            <span>{fmtMoney(totals.sub)}</span>
          </div>
          {parseFloat(order.discount) > 0 && (
            <div className="flex justify-between text-sm text-emerald-600">
              <span>
                Discount {isFlat ? `(${fmtMoney(discVal)})` : `(${order.discount}%)`}
                {order.discount_description ? ` — ${order.discount_description}` : ""}
              </span>
              <span>−{fmtMoney(totals.sub - totals.afterDisc)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm text-slate-500">
            <span>Tax ({order.tax_rate}%)</span>
            <span>{fmtMoney(totals.tax)}</span>
          </div>
          <div className="flex justify-between font-bold text-slate-900 dark:text-slate-100 border-t border-slate-200 dark:border-slate-700 pt-2">
            <span>Total</span>
            <span className="text-xl">{fmtMoney(totals.total)}</span>
          </div>
        </div>
      )}

      {order.notes && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
          <span className="font-semibold">Notes: </span>
          {order.notes}
        </div>
      )}

      {/* Reorder Shortfall — appears only when any line item
          has _shortfall > 0. One click creates a draft PO
          with the missing pieces; shop reviews + sends from
          Purchase Orders. See lib/orders/shortfallReorder.js. */}
      {(() => {
        const totalShort = totalOrderShortfall(liveOrder);
        if (totalShort === 0) return null;
        return (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-amber-800">
              <div className="font-semibold">
                Shortfall: {totalShort} piece{totalShort === 1 ? "" : "s"}
              </div>
              <div className="text-xs text-amber-700 mt-0.5">
                Reorder to make the customer whole — creates a draft PO with these sizes.
              </div>
            </div>
            <button
              onClick={handleReorderShortfall}
              disabled={reorderCreating}
              className="inline-flex items-center gap-1.5 text-sm font-semibold bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-xl transition disabled:opacity-60"
            >
              <ShoppingCart className="w-4 h-4" />
              {reorderCreating ? "Creating…" : `Reorder Shortfall (${totalShort} pcs)`}
            </button>
          </div>
        );
      })()}
    </>
  );
}
