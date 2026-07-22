// The NorCal order list ("shopping list") — built by adding products from the
// Browse NorCal catalog, then submitted to NorCal in one click.
//
// "Submit to NorCal" opens a pre-filled NorCal cart (their checkout) via the
// cart permalink — no API, nothing re-typed. On the way out we show a gentle
// reminder of any NorCal supplies running low that aren't already in the order,
// so the shop can top them up before checking out (they are NOT auto-added).
//
// Props:
//   order        — [{ variantId, title, size, price, image, url, sku, qty }]
//   onSetQty     — (variantId, qty) => void
//   onRemove     — (variantId) => void
//   onClear      — () => void
//   onClose      — () => void
//   onAddLowItem — (item) => void  (add a low-stock reminder item to the order)
//   lowReminders — [{ variantId, title, size, price }] NorCal items low on stock
//                  and not already in the order
//   onOrdered    — () => void  (called after the cart is opened, to clear)

import { useState } from "react";
import { createPortal } from "react-dom";
import { X, ShoppingCart, Trash2, Plus, Minus, ArrowRight, AlertTriangle, ExternalLink } from "lucide-react";
import { norcalCartPermalink } from "@/lib/norcal";

const fmtPrice = (n) => `$${(Number(n) || 0).toFixed(2)}`;

export default function NorcalOrderModal({
  order, onSetQty, onRemove, onClear, onClose, onAddLowItem, lowReminders = [], onOrdered,
}) {
  // Two-step submit: first press surfaces the low-stock reminder (if any),
  // second press (or "continue") opens the pre-filled NorCal cart.
  const [remindered, setRemindered] = useState(false);

  const totalQty = order.reduce((s, i) => s + (Number(i.qty) || 0), 0);
  const totalCost = order.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.price) || 0), 0);
  const pendingReminders = lowReminders.filter(
    (r) => !order.some((o) => String(o.variantId) === String(r.variantId)),
  );

  function openNorcalCart() {
    const url = norcalCartPermalink(
      order.map((i) => ({ variantId: i.variantId, qty: i.qty })),
      { utm_source: "inktracker", utm_medium: "reorder" },
    );
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    onOrdered?.();
  }

  function handleSubmit() {
    // Surface the reminder once; if there's nothing to remind about, go straight through.
    if (!remindered && pendingReminders.length > 0) {
      setRemindered(true);
      return;
    }
    openNorcalCart();
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[70] bg-slate-900/70 backdrop-blur-sm flex items-start justify-center p-4 overflow-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg my-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-rose-500" />
            <div>
              <div className="text-sm font-bold text-slate-900">NorCal Order</div>
              <div className="text-xs text-slate-500">
                {order.length} {order.length === 1 ? "item" : "items"} · {fmtPrice(totalCost)}
                <span className="ml-1.5 inline-flex items-center gap-1 text-rose-600 font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500" /> NorCal connected
                </span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {order.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <ShoppingCart className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <div className="text-sm font-semibold text-slate-700">Your NorCal order is empty</div>
            <div className="text-xs text-slate-500 mt-1">
              Add products from Browse NorCal, then submit the whole list to NorCal in one click.
            </div>
          </div>
        ) : (
          <>
            {/* Line items */}
            <div className="max-h-[45vh] overflow-y-auto divide-y divide-slate-50">
              {order.map((i) => (
                <div key={i.variantId} className="flex items-center gap-3 px-5 py-3">
                  {i.image ? (
                    <img src={i.image} alt="" className="w-11 h-11 rounded-lg object-contain bg-slate-50 border border-slate-100 flex-shrink-0" />
                  ) : (
                    <div className="w-11 h-11 rounded-lg bg-slate-50 border border-slate-100 flex-shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-slate-900 truncate">
                      {i.title}{i.size ? <span className="text-slate-500 font-normal"> · {i.size}</span> : null}
                    </div>
                    <div className="text-[11px] text-slate-500">{fmtPrice(i.price)} each</div>
                  </div>
                  {/* Qty stepper */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => onSetQty(i.variantId, Math.max(1, (Number(i.qty) || 1) - 1))}
                      className="w-6 h-6 rounded border border-slate-200 text-slate-500 hover:bg-slate-50 flex items-center justify-center"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <input
                      type="number"
                      min={1}
                      value={i.qty}
                      onChange={(e) => onSetQty(i.variantId, Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-10 text-center text-sm border border-slate-200 rounded py-0.5 focus:outline-none focus:ring-1 focus:ring-rose-300"
                    />
                    <button
                      onClick={() => onSetQty(i.variantId, (Number(i.qty) || 1) + 1)}
                      className="w-6 h-6 rounded border border-slate-200 text-slate-500 hover:bg-slate-50 flex items-center justify-center"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="w-16 text-right text-sm font-bold text-slate-800 flex-shrink-0">
                    {fmtPrice((Number(i.qty) || 0) * (Number(i.price) || 0))}
                  </div>
                  <button onClick={() => onRemove(i.variantId)} className="text-slate-300 hover:text-red-500 flex-shrink-0">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            {/* Checkout reminder: NorCal supplies running low, not in the order. */}
            {remindered && pendingReminders.length > 0 && (
              <div className="mx-5 my-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <div className="flex items-center gap-1.5 text-xs font-bold text-amber-700 uppercase tracking-wide mb-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" /> Running low — add before you order?
                </div>
                <div className="space-y-1.5">
                  {pendingReminders.map((r) => (
                    <div key={r.variantId} className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-slate-700 truncate">
                        {r.title}{r.size ? <span className="text-slate-500"> · {r.size}</span> : null}
                      </span>
                      <button
                        onClick={() => onAddLowItem?.(r)}
                        className="text-xs font-semibold text-amber-700 hover:text-amber-800 border border-amber-300 rounded-lg px-2 py-1 flex-shrink-0"
                      >
                        + Add
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Footer / submit */}
            <div className="px-5 py-4 border-t border-slate-100 flex items-center gap-3">
              <button onClick={onClear} className="text-xs font-semibold text-slate-500 hover:text-red-500">
                Clear
              </button>
              <div className="ml-auto text-right">
                <div className="text-[11px] text-slate-500">{totalQty} pcs · total</div>
                <div className="text-lg font-bold text-slate-900 leading-tight">{fmtPrice(totalCost)}</div>
              </div>
              <button
                onClick={handleSubmit}
                className="inline-flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold px-4 py-2.5 rounded-xl transition"
              >
                {remindered && pendingReminders.length > 0 ? "Continue to NorCal" : "Submit to NorCal"}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 pb-4 -mt-1 text-[11px] text-slate-400 flex items-center gap-1">
              <ExternalLink className="w-3 h-3" /> Opens a pre-filled cart on norcalsps.com to place your order.
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
