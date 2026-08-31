import { X, Download } from "lucide-react";
import { fmtDate, fmtMoney, getQty, activeSizeNames, calcLinkedLinePrice, buildLinkedQtyMap, BROKER_MARKUP, getOrderDisplayClient, getShopPricingConfig } from "../shared/pricing";
import { imprintCountText } from "@/lib/quotes/imprintLabels";
import { exportOrderToPDF } from "../shared/pdfExport";
import ModalBackdrop from "../shared/ModalBackdrop";

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
  const linkedQtyMap = buildLinkedQtyMap(order.line_items || []);
  // Canonical resolver: broker orders → the broker (customer_name carries the
  // broker display name), direct orders → company-first. Fixes direct-order
  // PDFs that showed the contact name instead of the company.
  const displayClient = getOrderDisplayClient(order);
  const displayJobTitle = isBrokerOrder
    ? (order?.job_title || order?.broker_client_name || "")
    : "";

  return (
    <ModalBackdrop onClose={onClose} z="z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-slate-200">
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1">{order.order_id}</div>
            <h2 className="text-lg font-bold text-slate-900">{displayClient}</h2>
            <div className="flex gap-3 text-xs text-slate-500 mt-0.5">
              {order.date && <span>{fmtDate(order.date)}</span>}
              {order.due_date && <span>· Due: {fmtDate(order.due_date)}</span>}
              {displayJobTitle && <span>· Job: {displayJobTitle}</span>}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${order.status === "Completed" ? "bg-emerald-100 text-emerald-700" : "bg-teal-100 text-teal-700"}`}>
              {order.status}
            </span>
            <button onClick={onClose} aria-label="Close" className="text-slate-500 hover:text-slate-600"><X className="w-5 h-5" /></button>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">

          {/* Line items */}
          {(order.line_items || []).map((li, i) => {
            const qty = getQty(li);
            // Saved stamps win (Quote Snapshot Invariant): line items carry
            // _lineTotal/_rushFee from the editor that priced them — for a
            // broker order that includes any per-broker pricing overrides.
            // A live recompute here runs against the module-global (shop)
            // config and would drift from the header totals (order.total is
            // itself a stamp). Live calc only for legacy unstamped rows.
            const stamped = Number.isFinite(Number(li._lineTotal))
              ? { lineTotal: (Number(li._lineTotal) || 0) + (Number(li._rushFee) || 0) }
              : null;
            const r = stamped || calcLinkedLinePrice(
              li,
              order.rush_rate,
              order.extras,
              isBrokerOrder ? BROKER_MARKUP : undefined,
              linkedQtyMap
            );
            const activeSizes = activeSizeNames(li.sizes);

            return (
              <div key={li.id || i} className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="bg-slate-50 px-4 py-3 flex justify-between items-center">
                  <div>
                    <span className="font-bold text-slate-800 text-sm">{li.style || "Garment"}</span>
                    {li.garmentColor && <span className="ml-2 text-xs text-slate-500">· {li.garmentColor}</span>}
                  </div>
                  {r && <span className="font-bold text-teal-700 text-sm">{fmtMoney(r.lineTotal)}</span>}
                </div>

                {activeSizes.length > 0 && (
                  <div className="overflow-x-auto border-b border-slate-100">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50/50">
                          <td className="px-4 py-2 text-xs font-semibold text-slate-500">Size</td>
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
                      <span className="font-bold text-teal-700">{imp.location}</span>
                      <span className="text-slate-500">·</span>
                      <span className="text-slate-600">{imprintCountText(imp, getShopPricingConfig()?.embroidery?.stitchTiers)}</span>
                      <span className="text-slate-500">·</span>
                      <span className="text-slate-600">{imp.technique}</span>
                      {imp.pantones && <><span className="text-slate-500">·</span><span className="text-teal-600 font-medium">{imp.pantones}</span></>}
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
                <span className="text-2xl font-black text-teal-700">{fmtMoney(totals.total)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl">
          <button
            onClick={() => exportOrderToPDF(order, "", "")}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white rounded-xl transition"
          >
            <Download className="w-4 h-4" /> Download PDF
          </button>
          <button onClick={onClose} className="ml-auto px-4 py-2 text-sm font-semibold text-slate-500 rounded-xl hover:bg-slate-100 transition">Close</button>
        </div>
      </div>
    </ModalBackdrop>
  );
}