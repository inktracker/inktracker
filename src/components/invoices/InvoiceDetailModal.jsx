import { useState, useEffect } from "react";
import { base44 } from "@/api/supabaseClient";
import { fmtDate, fmtMoney, calcGroupPrice, getQty, BIG_SIZES, SIZES } from "../shared/pricing";
import { exportInvoiceToPDF } from "../shared/pdfExport";

export default function InvoiceDetailModal({ invoice, customer, onClose, onMarkPaid, onDelete, onConvertToInvoice }) {
  const [loading, setLoading] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [reordered, setReordered] = useState(false);

  const [shopName, setShopName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");

  async function handleReorder() {
    setReordering(true);
    try {
      const newQuoteId = `Q-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase().slice(-4)}`;
      await base44.entities.Quote.create({
        quote_id: newQuoteId,
        shop_owner: invoice.shop_owner,
        customer_id: invoice.customer_id || "",
        customer_name: invoice.customer_name || "",
        date: new Date().toISOString().split("T")[0],
        due_date: null,
        status: "Draft",
        notes: invoice.notes || "",
        rush_rate: invoice.rush_rate || 0,
        extras: invoice.extras || {},
        line_items: invoice.line_items || [],
        discount: invoice.discount || 0,
        tax_rate: invoice.tax_rate || 8.265,
        deposit_pct: 0,
        deposit_paid: false,
      });
      setReordered(true);
      setTimeout(() => setReordered(false), 3000);
    } catch (err) {
      console.error("Reorder failed:", err);
    } finally {
      setReordering(false);
    }
  }

  useEffect(() => {
    // Invoice now contains all order data directly
    setLoading(false);
    base44.auth.me().then(u => {
      if (u) { setShopName(u.shop_name || ""); setLogoUrl(u.logo_url || ""); }
    }).catch(() => {});
  }, [invoice]);

  // Calculate totals from invoice data
  const totals = invoice ? { sub: invoice.subtotal, afterDisc: (invoice.subtotal || 0) * (1 - (invoice.discount || 0) / 100), tax: invoice.tax, total: invoice.total } : null;

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-start justify-center p-4 overflow-auto"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-4" onMouseDown={e => e.stopPropagation()}>

        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-200 flex justify-between items-start">
          <div>
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1">{invoice.invoice_id} · {fmtDate(invoice.date)}</div>
            <h2 className="text-sm font-semibold text-slate-900">{customer?.company || invoice.customer_name}</h2>
            {invoice.due && <div className="text-sm text-slate-400 mt-0.5">Due: {fmtDate(invoice.due)}</div>}
          </div>
          <div className="flex items-center gap-3">
            {invoice.status && <span className="text-xs font-semibold text-slate-600 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-full">{invoice.status}</span>}
            {invoice.paid
              ? <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">Paid</span>
              : <span className="text-xs font-semibold text-red-500 bg-red-50 border border-red-100 px-2.5 py-1 rounded-full">Unpaid</span>}
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
          </div>
        </div>

        {/* Dates */}
        <div className="px-6 py-4 grid grid-cols-2 sm:grid-cols-4 gap-4 border-b border-slate-100 bg-slate-50/50">
          <div>
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-0.5">Issued</div>
            <div className="text-sm font-semibold text-slate-700">{fmtDate(invoice.date) || "—"}</div>
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-0.5">Due</div>
            <div className="text-sm font-semibold text-slate-700">{fmtDate(invoice.due) || "—"}</div>
          </div>

          {invoice.paid && invoice.paid_date && (
            <div>
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-0.5">Paid On</div>
              <div className="text-sm font-semibold text-emerald-600">{fmtDate(invoice.paid_date)}</div>
            </div>
          )}
        </div>

        <div className="p-6 space-y-5">
          {/* Line items */}
          {!loading && invoice.line_items && (invoice.line_items || []).map(li => {
            const qty = getQty(li);
            const twoXL = BIG_SIZES.reduce((s, sz) => s + (parseInt((li.sizes||{})[sz]) || 0), 0);
            const r = calcGroupPrice(li.garmentCost, qty, li.imprints, invoice.rush_rate || 0, invoice.extras || {});
            const activeSizes = SIZES.filter(sz => (parseInt((li.sizes||{})[sz]) || 0) > 0);
            return (
              <div key={li.id} className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex justify-between items-center">
                  <div>
                    <span className="font-bold text-slate-800 text-sm">{li.style || "Garment"}</span>
                    {li.garmentColor && <span className="ml-2 text-xs text-slate-500">· {li.garmentColor}</span>}
                    <span className="ml-2 text-xs text-slate-400">Wholesale: {fmtMoney(li.garmentCost)}</span>
                  </div>
                  {r && <span className="font-bold text-slate-700 text-sm">{fmtMoney(r.sub + twoXL*2)}</span>}
                </div>

                {activeSizes.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b border-slate-100 bg-slate-50/50">
                        <td className="px-4 py-2 text-xs text-slate-400 font-semibold">Size</td>
                        {activeSizes.map(sz => <td key={sz} className="px-3 py-2 text-center text-xs font-semibold text-slate-600">{sz}</td>)}
                        <td className="px-4 py-2 text-center text-xs font-semibold text-slate-600">Total</td>
                      </tr></thead>
                      <tbody>
                        <tr>
                          <td className="px-4 py-2 text-xs text-slate-500">Qty</td>
                          {activeSizes.map(sz => <td key={sz} className="px-3 py-2 text-center font-semibold text-slate-800">{(li.sizes||{})[sz] || 0}</td>)}
                          <td className="px-4 py-2 text-center font-bold text-slate-800">{qty}</td>
                        </tr>
                        {r && (
                          <tr>
                            <td className="px-4 py-2 text-xs text-slate-400">Price/ea</td>
                            {activeSizes.map(sz => (
                              <td key={sz} className="px-3 py-2 text-center text-xs text-slate-500">
                                {fmtMoney(r.ppp + (BIG_SIZES.includes(sz) ? 2 : 0))}
                                {BIG_SIZES.includes(sz) && <span className="text-amber-500 ml-0.5">*</span>}
                              </td>
                            ))}
                            <td className="px-4 py-2 text-center text-xs font-bold text-slate-700">{fmtMoney(r.sub + twoXL*2)}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="border-t border-slate-100 p-4 space-y-3">
                   {(li.imprints || []).map(imp => (
                           <div key={imp.id} className="space-y-1.5">
                             {imp.title && <div className="text-xs font-bold text-slate-800">{imp.title}</div>}
                             <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
                               <span className="font-bold text-slate-800">{imp.location}</span>
                               <span className="text-slate-500">{imp.colors} color{imp.colors !== 1 ? "s" : ""} · {imp.technique}</span>
                               {imp.pantones && <span className="text-indigo-600 font-medium">{imp.pantones}</span>}
                               {imp.details && <span className="text-slate-400 italic">{imp.details}</span>}
                             </div>
                             {(imp.width || imp.height) && (
                               <div className="flex gap-2 text-xs text-slate-500">
                                 {imp.width && <span>Width: {imp.width}</span>}
                                 {imp.height && <span>Height: {imp.height}</span>}
                               </div>
                             )}
                           </div>
                         ))}

                   </div>
              </div>
            );
          })}

          {/* Extras / Add-ons */}
          {invoice.extras && Object.values(invoice.extras).some(Boolean) && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">Add-ons</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(invoice.extras).filter(([,v])=>v).map(([k])=>(
                  <span key={k} className="text-xs font-semibold bg-white border border-slate-200 text-slate-600 px-2.5 py-1 rounded-full capitalize">{k.replace(/([A-Z])/g,' $1')}</span>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          {invoice.notes && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
              <span className="font-semibold">Notes: </span>{invoice.notes}
            </div>
          )}

          {/* Totals */}
          <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-2">
            <div className="flex justify-between text-sm text-slate-500"><span>Subtotal</span><span>{fmtMoney(invoice.subtotal)}</span></div>
            {invoice.discount > 0 && (
              <div className="flex justify-between text-sm text-emerald-600">
                <span>Discount ({invoice.discount}%)</span>
                <span>−{fmtMoney((invoice.subtotal || 0) * (invoice.discount / 100))}</span>
              </div>
            )}
            {invoice.tax > 0 && (
              <div className="flex justify-between text-sm text-slate-500">
                <span>Tax {invoice.tax_rate ? `(${invoice.tax_rate}%)` : ""}</span>
                <span>{fmtMoney(invoice.tax)}</span>
              </div>
            )}
            {invoice.rush_rate > 0 && (
              <div className="flex justify-between text-sm text-orange-600"><span>Rush Fee</span><span>included</span></div>
            )}
            <div className="flex justify-between font-bold text-slate-900 border-t border-slate-200 pt-2">
              <span className="text-base">Total</span>
              <span className="text-2xl">{fmtMoney(invoice.total)}</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl">
          {!invoice.paid && (
            <button onClick={() => { onMarkPaid(invoice.id); onClose(); }}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-4 py-2 rounded-xl transition">
              Mark as Paid
            </button>
          )}
          {invoice.status === "Draft" && onConvertToInvoice && (
            <button onClick={() => { onConvertToInvoice(invoice); onClose(); }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2 rounded-xl transition">
              Convert to Invoice
            </button>
          )}
          <button
            onClick={handleReorder}
            disabled={reordering}
            className="px-4 py-2 text-sm font-semibold text-indigo-600 border border-indigo-200 rounded-xl hover:bg-indigo-50 transition disabled:opacity-50"
          >
            {reordered ? "✓ Draft quote created!" : reordering ? "Creating…" : "Reorder"}
          </button>
          <button onClick={() => exportInvoiceToPDF(invoice, customer, shopName, logoUrl)} className="px-4 py-2 text-sm font-semibold text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-100 transition">📥 Download PDF</button>
          {onDelete && <button onClick={() => onDelete(invoice.id)} className="px-4 py-2 text-sm font-semibold text-red-400 border border-red-200 rounded-xl hover:bg-red-50 transition">Delete</button>}
          <button onClick={onClose} className="ml-auto px-4 py-2 text-sm font-semibold text-slate-400 rounded-xl hover:bg-slate-100 transition">Close</button>
        </div>
      </div>
    </div>
  );
}