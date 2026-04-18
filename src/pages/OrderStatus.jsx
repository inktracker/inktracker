import { useState, useEffect } from "react";
import { base44 } from "@/api/supabaseClient";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { fmtDate, getQty, O_STATUSES } from "../components/shared/pricing";

export default function OrderStatus() {
  const [order, setOrder] = useState(null);
  const [shop, setShop] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const params = new URLSearchParams(window.location.search);
  const orderId = params.get("id");

  useEffect(() => {
    if (!orderId) { setError("No order ID provided."); setLoading(false); return; }

    base44.functions.invoke("createCheckoutSession", {
      action: "getOrder",
      orderId,
    }).then((res) => {
      if (res?.data?.error) { setError(res.data.error); return; }
      if (!res?.data?.order) { setError("Order not found."); return; }
      setOrder(res.data.order);
      setShop(res.data.shop || null);
    }).catch(() => setError("Failed to load order."))
      .finally(() => setLoading(false));
  }, [orderId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-10 max-w-md w-full text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-900 mb-2">Order Not Found</h2>
          <p className="text-slate-500 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  const currentIdx = O_STATUSES.indexOf(order.status);
  const isComplete = order.status === "Completed";
  const totalQty = (order.line_items || []).reduce((sum, li) => sum + getQty(li), 0);

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* Header */}
        <div className="bg-slate-900 rounded-2xl px-4 sm:px-8 py-6 flex items-center gap-4">
          {shop?.logo_url ? (
            <img src={shop.logo_url} alt="Logo" className="w-12 h-12 object-contain rounded-lg" />
          ) : (
            <div className="w-12 h-12 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-black text-xl">
              {(shop?.shop_name || "S")[0]}
            </div>
          )}
          <div>
            <div className="text-white font-bold text-lg">{shop?.shop_name || "Shop"}</div>
            <div className="text-slate-400 text-sm">Order Status — {order.order_id}</div>
          </div>
        </div>

        {/* Order summary */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-4 sm:px-8 py-6">
          <div className="flex flex-wrap justify-between gap-3">
            <div>
              <div className="text-xl font-black text-slate-900">{order.customer_name}</div>
              {order.job_title && <div className="text-slate-500 text-sm mt-0.5">{order.job_title}</div>}
              {totalQty > 0 && (
                <div className="text-sm text-slate-400 mt-1">{totalQty} pieces</div>
              )}
            </div>
            <div className="text-right text-sm space-y-1">
              {order.date && (
                <div>
                  <span className="text-slate-400">Order Date: </span>
                  <span className="font-semibold text-slate-700">{fmtDate(order.date)}</span>
                </div>
              )}
              {order.due_date && (
                <div>
                  <span className="text-slate-400">In-Hands: </span>
                  <span className="font-semibold text-indigo-700">{fmtDate(order.due_date)}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Status progress */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-4 sm:px-8 py-6">
          <h3 className="text-base font-bold text-slate-900 mb-6">Production Progress</h3>

          {isComplete ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <CheckCircle2 className="w-14 h-14 text-emerald-500" />
              <div className="font-bold text-xl text-slate-900">Order Complete!</div>
              <div className="text-sm text-slate-500">
                Your order is ready. Contact {shop?.shop_name || "the shop"} to arrange pickup or delivery.
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {O_STATUSES.map((step, idx) => {
                const done = idx < currentIdx;
                const active = idx === currentIdx;
                return (
                  <div key={step} className="flex items-center gap-3">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold transition-colors ${
                      done
                        ? "bg-emerald-500 text-white"
                        : active
                        ? "bg-indigo-600 text-white ring-4 ring-indigo-100"
                        : "bg-slate-100 text-slate-400"
                    }`}>
                      {done ? <CheckCircle2 className="w-4 h-4" /> : idx + 1}
                    </div>
                    <div className={`text-sm font-medium ${
                      active ? "text-indigo-700 font-bold" : done ? "text-slate-500" : "text-slate-400"
                    }`}>
                      {step}
                      {active && (
                        <span className="ml-2 text-xs bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full">
                          Current
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Progress bar */}
          {!isComplete && currentIdx >= 0 && (
            <div className="mt-6">
              <div className="flex justify-between text-xs text-slate-400 mb-1.5">
                <span>Progress</span>
                <span>{Math.round((currentIdx / (O_STATUSES.length - 1)) * 100)}%</span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                  style={{ width: `${(currentIdx / (O_STATUSES.length - 1)) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Line items summary */}
        {(order.line_items || []).length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-4 sm:px-8 py-6">
            <h3 className="text-base font-bold text-slate-900 mb-4 pb-3 border-b border-slate-100">
              Items
            </h3>
            <div className="space-y-3">
              {order.line_items.map((li, idx) => {
                const qty = getQty(li);
                const style = li.productName || li.style || "Garment";
                const color = li.garmentColor;
                const brand = li.brand;
                return (
                  <div key={li.id || idx} className="flex justify-between text-sm py-1">
                    <div>
                      <span className="font-semibold text-slate-800">{style}</span>
                      {brand && <span className="text-slate-400"> · {brand}</span>}
                      {color && <span className="text-slate-400"> · {color}</span>}
                    </div>
                    <span className="text-slate-600 font-medium">{qty} pcs</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Contact */}
        {(shop?.phone || shop?.email) && (
          <div className="bg-slate-100 rounded-2xl px-6 py-4 text-sm text-slate-600 text-center">
            Questions? Contact {shop?.shop_name || "the shop"}
            {shop?.phone && <> at <a href={`tel:${shop.phone}`} className="text-indigo-600 font-semibold">{shop.phone}</a></>}
            {shop?.phone && shop?.email && " or "}
            {shop?.email && <a href={`mailto:${shop.email}`} className="text-indigo-600 font-semibold">{shop.email}</a>}
          </div>
        )}

      </div>
    </div>
  );
}
