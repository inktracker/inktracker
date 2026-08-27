// The reorder cart — built by adding products from any Browse-supplier catalog
// (NorCal, Ryonet, …), then submitted to each vendor in one click. Items carry
// their own supplier, so a mixed order opens one pre-filled cart per vendor.
//
// "Submit" opens each vendor's pre-filled Shopify cart via a cart permalink —
// no API, nothing re-typed. On the way out we show a gentle reminder of any
// linked supplies running low that aren't already in the order (NOT auto-added).
//
// Props:
//   order        — [{ variantId, title, size, price, image, url, sku, qty,
//                     supplierKey, supplierLabel, storeUrl }]
//   onSetQty     — (variantId, qty) => void
//   onRemove     — (variantId) => void
//   onClear      — () => void
//   onClose      — () => void
//   onAddLowItem — (item) => void  (add a low-stock reminder item to the order)
//   lowReminders — [{ variantId, title, size, price, supplierLabel }] linked
//                  supplies low on stock and not already in the order
//   onOrdered    — () => void  (called once the order is fully resolved, to clear)
//   linkedVariantIds — Set<string> variant ids tracked by an inventory item
//   onAddToStock — (lines) => void  add the SELECTED ordered lines to on-hand
//                  stock. Lines: [{ variantId, qty, title, size }].

import { useState } from "react";
import { createPortal } from "react-dom";
import { X, ShoppingCart, Trash2, Plus, Minus, ArrowRight, AlertTriangle, ExternalLink, Check } from "lucide-react";
import { supplierCartPermalink } from "@/lib/suppliers";
import { openExternal } from "@/lib/mobile/native";

const fmtPrice = (n) => `$${(Number(n) || 0).toFixed(2)}`;

export default function NorcalOrderModal({
  order, onSetQty, onRemove, onClear, onClose, onAddLowItem, lowReminders = [], onOrdered,
  linkedVariantIds, onAddToStock,
}) {
  // Two-step submit: first press surfaces the low-stock reminder (if any),
  // second press (or "continue") opens the pre-filled vendor cart(s).
  const [remindered, setRemindered] = useState(false);
  // Multi-vendor orders reveal one open-button per vendor: a browser blocks a
  // second popup fired from the same click, so each cart must open from its own.
  const [opening, setOpening] = useState(false);
  const [opened, setOpened] = useState(() => new Set());
  // Post-submit step: "add the ordered quantities to stock?" Per-line
  // checkboxes because a vendor cart isn't a purchase — anything that was
  // out of stock at checkout must be uncheckable, or we mint phantom
  // inventory. null = not in this step; Set = current selection.
  const [stockSelection, setStockSelection] = useState(null);

  const totalQty = order.reduce((s, i) => s + (Number(i.qty) || 0), 0);
  const totalCost = order.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.price) || 0), 0);
  const vendors = [...new Set(order.map((i) => i.supplierLabel).filter(Boolean))];
  const pendingReminders = lowReminders.filter(
    (r) => !order.some((o) => String(o.variantId) === String(r.variantId)),
  );

  // One pre-filled cart per vendor store, preserving order sequence.
  const storeGroups = [];
  {
    const gm = new Map();
    for (const i of order) {
      const store = i.storeUrl || "";
      if (!store) continue;
      if (!gm.has(store)) {
        const g = { storeUrl: store, label: i.supplierLabel || "vendor", lines: [] };
        gm.set(store, g);
        storeGroups.push(g);
      }
      gm.get(store).lines.push({ variantId: i.variantId, qty: i.qty });
    }
  }

  function openStore(group) {
    if (opened.has(group.storeUrl)) return; // guard double-clicks — one tab per vendor
    // Fired from a real click, so this single window.open is never blocked.
    const url = supplierCartPermalink(group.storeUrl, group.lines, {
      utm_source: "inktracker", utm_medium: "reorder",
    });
    if (!url) return; // nothing orderable — don't mark opened or clear the list
    // openExternal = new tab on web, system browser inside the native iOS app.
    openExternal(url);
    const next = new Set(opened);
    next.add(group.storeUrl);
    setOpened(next);
    // Once EVERY vendor's cart is open, move to the add-to-stock step
    // (pre-checking only the lines an inventory item actually tracks).
    if (storeGroups.every((g) => next.has(g.storeUrl))) {
      const tracked = order
        .filter((i) => linkedVariantIds?.has(String(i.variantId)))
        .map((i) => String(i.variantId));
      setStockSelection(new Set(tracked));
    }
  }

  function handleSubmit() {
    if (!remindered && pendingReminders.length > 0) {
      setRemindered(true);
      return;
    }
    if (storeGroups.length <= 1) {
      // Single vendor: this click opens its cart directly.
      if (storeGroups[0]) openStore(storeGroups[0]);
      else onOrdered?.();
      return;
    }
    // Multiple vendors: reveal a button per vendor (see `opening` above).
    setOpening(true);
  }

  const submitLabel = remindered && pendingReminders.length > 0
    ? "Continue"
    : vendors.length > 1
      ? `Submit to ${vendors.length} vendors`
      : `Submit to ${vendors[0] || "vendor"}`;

  function finishOrder(addSelected) {
    if (addSelected && stockSelection?.size) {
      onAddToStock?.(order.filter((i) => stockSelection.has(String(i.variantId))));
    }
    setStockSelection(null);
    onOrdered?.();
    onClose?.();
  }

  if (stockSelection) {
    // ── Add-to-stock step ────────────────────────────────────────────
    // Closing here (X / backdrop) counts as Skip: the vendor carts are
    // already open, so the ORDER is done either way — only the stock
    // bookkeeping is being declined.
    return createPortal(
      <div
        className="fixed inset-0 z-[70] bg-slate-900/70 backdrop-blur-sm flex items-start justify-center p-4 overflow-auto"
        onClick={() => finishOrder(false)}
      >
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg my-4" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <div>
              <div className="text-sm font-bold text-slate-900">Add to stock?</div>
              <div className="text-xs text-slate-500 mt-0.5">
                Uncheck anything that didn&apos;t actually get ordered — out of stock, removed at checkout, saved for later.
              </div>
            </div>
            <button onClick={() => finishOrder(false)} className="p-2 text-slate-400 hover:text-slate-600 transition" aria-label="Skip">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="px-5 py-3 space-y-1.5 max-h-[50vh] overflow-auto">
            {order.map((i) => {
              const vid = String(i.variantId);
              const tracked = linkedVariantIds?.has(vid);
              const checked = stockSelection.has(vid);
              return (
                <label
                  key={vid}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 border ${tracked ? "border-slate-200 cursor-pointer hover:bg-slate-50" : "border-slate-100 bg-slate-50 opacity-60"}`}
                >
                  <input
                    type="checkbox"
                    className="accent-teal-600"
                    checked={tracked && checked}
                    disabled={!tracked}
                    onChange={() => {
                      setStockSelection((prev) => {
                        const next = new Set(prev);
                        if (next.has(vid)) next.delete(vid); else next.add(vid);
                        return next;
                      });
                    }}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-slate-800 truncate">{i.title}{i.size ? ` — ${i.size}` : ""}</span>
                    {!tracked && (
                      <span className="block text-[11px] text-slate-400">Not tracked in inventory — nothing to add to</span>
                    )}
                  </span>
                  <span className="text-sm font-semibold text-slate-700 whitespace-nowrap">+{Number(i.qty) || 0}</span>
                </label>
              );
            })}
          </div>

          <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-100">
            <button
              onClick={() => finishOrder(false)}
              className="text-sm font-semibold text-slate-600 px-4 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 transition"
            >
              Skip
            </button>
            <button
              onClick={() => finishOrder(true)}
              disabled={!stockSelection.size}
              className="text-sm font-bold text-white bg-teal-600 hover:bg-teal-700 px-5 py-2 rounded-xl transition disabled:opacity-50"
            >
              Add {[...stockSelection].reduce((s, vid) => {
                const line = order.find((i) => String(i.variantId) === vid);
                return s + (Number(line?.qty) || 0);
              }, 0)} pcs to stock
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );
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
              <div className="text-sm font-bold text-slate-900">Reorder Cart</div>
              <div className="text-xs text-slate-500">
                {order.length} {order.length === 1 ? "item" : "items"} · {fmtPrice(totalCost)}
                {vendors.length > 0 && <span className="ml-1.5 text-rose-600 font-semibold">· {vendors.join(" + ")}</span>}
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
            <div className="text-sm font-semibold text-slate-700">Your reorder cart is empty</div>
            <div className="text-xs text-slate-500 mt-1">
              Add products from a Browse-vendor catalog, then submit the list to each vendor in one click.
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
                    <div className="text-[11px] text-slate-500">
                      {fmtPrice(i.price)} each
                      {i.supplierLabel ? <span className="text-rose-500 font-semibold"> · {i.supplierLabel}</span> : null}
                    </div>
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

            {/* Checkout reminder: linked supplies running low, not in the order. */}
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
                        {r.supplierLabel ? <span className="text-rose-500 text-xs font-semibold"> · {r.supplierLabel}</span> : null}
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
            {opening ? (
              // Multi-vendor: one open-button per vendor. Each opens from its own
              // click so no vendor's cart gets swallowed by the popup blocker.
              <div className="px-5 py-4 border-t border-slate-100">
                <div className="text-xs font-semibold text-slate-600 mb-2.5">
                  Your order spans {storeGroups.length} vendors — open each cart to place it:
                </div>
                <div className="space-y-2">
                  {storeGroups.map((g) => {
                    const done = opened.has(g.storeUrl);
                    const pcs = g.lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
                    return (
                      <button
                        key={g.storeUrl}
                        onClick={() => openStore(g)}
                        disabled={done}
                        className={`w-full flex items-center justify-between gap-2 text-sm font-bold px-4 py-2.5 rounded-xl transition ${
                          done
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-default"
                            : "bg-rose-600 hover:bg-rose-700 text-white"
                        }`}
                      >
                        <span className="flex items-center gap-1.5">
                          {done ? <Check className="w-4 h-4" /> : <ExternalLink className="w-4 h-4" />}
                          {done ? `${g.label} cart opened` : `Open ${g.label} cart`}
                        </span>
                        <span className={`text-xs ${done ? "text-emerald-600" : "text-rose-100"}`}>{pcs} pcs</span>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2.5 text-[11px] text-slate-400">
                  Each opens in a new tab. This list clears once every vendor's cart is open.
                </div>
              </div>
            ) : (
              <>
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
                    {submitLabel}
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
                <div className="px-5 pb-4 -mt-1 text-[11px] text-slate-400 flex items-center gap-1">
                  <ExternalLink className="w-3 h-3" />
                  {vendors.length > 1
                    ? "Opens a pre-filled cart at each vendor to place your order — and clears this list here."
                    : "Opens a pre-filled cart on the vendor's site to place your order — and clears this list here."}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
