import { X, Download } from "lucide-react";
import { fmtDate, fmtMoney, getQty, BIG_SIZES, SIZES, calcGroupPrice, BROKER_MARKUP } from "../shared/pricing";
import { exportOrderToPDF } from "../shared/pdfExport";

export default function BrokerOrderPDFModal({ order, onClose }) {
  const brokerDiscVal = parseFloat(order.discount || 0);
  const brokerDiscType = order.discount_type || 'percent';
  const brokerIsFlat = brokerDiscType === 'flat' || (brokerDiscVal > 100 && brokerDiscType !== 'percent');
  const totals = {
    sub: order.subtotal || 0,
    afterDisc: brokerIsFlat
      ? Math.max(0, (order.subtotal || 0) - brokerDiscVal)
      : (order.subtotal || 0) * (1 - brokerDiscVal / 100),
    tax: order.tax || 0,
    total: order.total || 0,
  };

  const isBrokerOrder = Boolean(order?.broker_id || order?.broker_email || order?.brokerId);
  const displayClient = isBrokerOrder
    ? (order?.broker_name || order?.broker_company || order?.customer_name || "—")
    : (order?.customer_name || "—");
  const displayJobTitle = isBrokerOrder
    ? (order?.job_title || order?.broker_client_name || "")
    : "";

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-start justify-center p-4 overflow-auto"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-4" onMouseDown={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-slate-200">
          <div>
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1">{order.order_id}</div>
            <h2 className="text-lg font-bold text-slate-900">{displayClient}</h2>
            <div className="flex gap-3 text-xs text-slate-400 mt-0.5">
              {order.date && <span>{fmtDate(order.date)}</span>}
              {order.due_date && <span>· Due: {fmtDate(order.due_date)}</span>}
              {displayJobTitle && <span>· Job: {displayJobTitle}</span>}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${order.status === "Completed" ? "bg-emerald-100 text-emerald-700" : "bg-indigo-100 text-indigo-700"}`}>
              {order.status}
            </span>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">

          {/* Line items */}
          {(order.line_items || []).map((li, i) => {
            const qty = getQty(li);
            const twoXL = BIG_SIZES.reduce((s, sz) => s + (parseInt((li.sizes || {})[sz]) || 0), 0);
            const r = calcGroupPrice(
              li.garmentCost,
              qty,
              li.imprints,
              order.rush_rate,
              order.extras,
              isBrokerOrder ? BROKER_MARKUP : undefined
            );
            const activeSizes = SIZES.filter(sz => (parseInt((li.sizes || {})[sz]) || 0) > 0);

            return (
              <div key={li.id || i} className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="bg-slate-50 px-4 py-3 flex justify-between items-center">
                  <div>
                    <span className="font-bold text-slate-800 text-sm">{li.style || "Garment"}</span>
                    {li.garmentColor && <span className="ml-2 text-xs text-slate-500">· {li.garmentColor}</span>}
                  </div>
                  {r && <span className="font-bold text-indigo-700 text-sm">{fmtMoney(r.sub + twoXL * 2)}</span>}
                </div>

                {activeSizes.length > 0 && (
                  <div className="overflow-x-auto border-b border-slate-100">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50/50">
                          <td className="px-4 py-2 text-xs font-semibold text-slate-400">Size</td>
                          {activeSizes.map(sz => <td key={sz} className="px-3 py-2 text-center text-xs font-semibold text-slate-600">{sz}</td>)}
                          <td className="px-4 py-2 text-center text-xs font-semibold text-slate-600">Total</td>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td className="px-4 py-2 text-xs text-slate-500">Qty</td>
                          {activeSizes.map(sz => <td key={sz} className="px-3 py-2 text-center font-semibold text-slate-800">{(li.sizes || {})[sz] || 0}</td>)}
                          <td className="px-4 py-2 text-center font-bold text-slate-800">{qty}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="p-4 space-y-2">
                  {(li.imprints || []).filter(imp => imp.colors > 0).map((imp, j) => (
                    <div key={j} className="text-xs flex flex-wrap gap-x-2 gap-y-1">
                      <span className="font-bold text-indigo-700">{imp.location}</span>
                      <span className="text-slate-400">·</span>
                      <span className="text-slate-600">{imp.colors} color{imp.colors !== 1 ? "s" : ""}</span>
                      <span className="text-slate-400">·</span>
                      <span className="text-slate-600">{imp.technique}</span>
                      {imp.pantones && <><span className="text-slate-400">·</span><span className="text-purple-600 font-medium">{imp.pantones}</span></>}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {/* Notes */}
          {order.notes && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
              <span className="font-semibold">Notes: </span>{order.notes}
            </div>
          )}

          {/* Totals */}
          {order.total !== undefined && (
            <div className="border-t border-slate-200 pt-4 space-y-2">
              <div className="flex justify-between text-sm text-slate-500"><span>Subtotal</span><span>{fmtMoney(totals.sub)}</span></div>
              {parseFloat(order.discount) > 0 && (
                <div className="flex justify-between text-sm text-emerald-600">
                  <span>Discount {brokerIsFlat ? `(${fmtMoney(brokerDiscVal)})` : `(${order.discount}%)`}</span>
                  <span>−{fmtMoney(totals.sub - totals.afterDisc)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm text-slate-500"><span>Tax ({order.tax_rate}%)</span><span>{fmtMoney(totals.tax)}</span></div>
              <div className="flex justify-between items-baseline border-t border-slate-200 pt-2">
                <span className="text-base font-bold text-slate-900">Total</span>
                <span className="text-2xl font-black text-indigo-700">{fmtMoney(totals.total)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl">
          <button
            onClick={() => exportOrderToPDF(order, "", "")}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition"
          >
            <Download className="w-4 h-4" /> Download PDF
          </button>
          <button onClick={onClose} className="ml-auto px-4 py-2 text-sm font-semibold text-slate-400 rounded-xl hover:bg-slate-100 transition">Close</button>
        </div>
      </div>
    </div>
  );
}