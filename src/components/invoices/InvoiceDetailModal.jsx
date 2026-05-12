import { useState, useEffect } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import { fmtDate, fmtMoney, calcLinkedLinePrice, buildLinkedQtyMap, getQty, BIG_SIZES, SIZES, buildQBInvoicePayload } from "../shared/pricing";
import { exportInvoiceToPDF } from "../shared/pdfExport";
import SendInvoiceModal from "./SendInvoiceModal";
import OrderDetailModal from "../orders/OrderDetailModal";
import MessagesTab from "../shared/MessagesTab";
import CollapsibleSection from "../shared/CollapsibleSection";
import { invoiceThreadId } from "@/lib/messageThreads";
import { resolveInvoicePdfSource } from "@/lib/invoice/resolveInvoicePdfSource";
import { MessageSquare } from "lucide-react";

export default function InvoiceDetailModal({ invoice, customer, onClose, onMarkPaid, onDelete, onConvertToInvoice }) {
  const [loading, setLoading] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [reordered, setReordered] = useState(false);
  const [viewingOrder, setViewingOrder] = useState(null);

  const [shopName, setShopName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [shopProfile, setShopProfile] = useState(null);
  const [showSendModal, setShowSendModal] = useState(false);
  const [qbCreating, setQbCreating] = useState(false);
  const [qbStatus, setQbStatus] = useState(null);

  const SUPABASE_FUNC_URL = import.meta.env.VITE_SUPABASE_URL;

  async function handleCreateInQB() {
    if (invoice.qb_invoice_id || invoice.qb_payment_link) {
      if (!window.confirm("This invoice was previously synced to QuickBooks. Create a new one anyway?")) return;
    }
    setQbCreating(true);
    setQbStatus(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not signed in");

      // Treat invoice like a quote so buildQBInvoicePayload works
      const quoteShape = {
        ...invoice,
        quote_id: invoice.invoice_id,
        customer_email: customer?.email || "",
      };
      let invoicePayload = buildQBInvoicePayload(quoteShape);

      // If buildQBInvoicePayload produced no lines (e.g. invoice from QB pull or
      // order with no sizes object), build a simple single-line payload from the
      // invoice totals so the QB sync still works.
      if (!invoicePayload?.lines?.length) {
        const lineItems = invoice.line_items || [];
        const lines = lineItems.length > 0
          ? lineItems.map(li => {
              const qty = getQty(li) || Number(li.qty) || 1;
              const amount = Number(li.total) || Number(li.amount) || (invoice.subtotal || invoice.total || 0);
              return {
                description: [li.brand, li.style, li.garmentColor, li.description].filter(Boolean).join(" ") || "Service",
                qty,
                unitPrice: Number((amount / qty).toFixed(4)),
                amount: Number(amount.toFixed(2)),
                itemName: "Screen Print",
              };
            }).filter(l => l.amount > 0)
          : [{
              description: "Invoice",
              qty: 1,
              unitPrice: Number((invoice.subtotal || invoice.total || 0).toFixed(2)),
              amount: Number((invoice.subtotal || invoice.total || 0).toFixed(2)),
              itemName: "Screen Print",
            }];

        const discVal = parseFloat(invoice.discount) || 0;
        const isFlat = invoice.discount_type === "flat";
        invoicePayload = {
          lines,
          discountPercent: isFlat ? 0 : discVal,
          discountAmount: isFlat ? discVal : 0,
          discountType: isFlat ? "flat" : "percent",
          taxPercent: parseFloat(invoice.tax_rate) || 0,
          depositAmount: 0,
        };
      }

      const res = await fetch(`${SUPABASE_FUNC_URL}/functions/v1/qbSync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "createInvoice",
          accessToken: session.access_token,
          quote: quoteShape,
          invoicePayload,
          customer: {
            id: invoice.customer_id,
            name: invoice.customer_name,
            email: customer?.email || "",
            company: customer?.company || "",
            phone: customer?.phone || "",
            address: customer?.address || "",
            qb_customer_id: customer?.qb_customer_id || "",
            tax_exempt: customer?.tax_exempt || false,
            tax_id: customer?.tax_id || "",
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create");
      setQbStatus({ type: "success", text: `Invoice created in QuickBooks.${data.paymentLink ? " Payment link ready." : ""}` });
    } catch (err) {
      setQbStatus({ type: "error", text: err.message });
    } finally {
      setQbCreating(false);
    }
  }

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
        discount_type: invoice.discount_type || "percent",
        tax_rate: invoice.tax_rate || 0,
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
      if (u) {
        setShopName(u.shop_name || "");
        setLogoUrl(u.logo_url || "");
        setShopProfile(u);
      }
    }).catch(() => {});
  }, [invoice]);

  // Fetch the QB-generated invoice PDF and return a blob URL the caller can
  // open or download. Returns null on any failure so the caller can fall back.
  async function fetchQBInvoicePdfBlob(qbInvoiceId) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_FUNC_URL}/functions/v1/qbSync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "getInvoicePDF",
          accessToken: session?.access_token,
          qbInvoiceId,
        }),
      });
      const data = await res.json();
      if (!data?.pdf) return null;
      const byteChars = atob(data.pdf);
      const byteArray = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i);
      const blob = new Blob([byteArray], { type: "application/pdf" });
      return URL.createObjectURL(blob);
    } catch {
      return null;
    }
  }

  // Calculate totals from invoice data
  const discVal = parseFloat(invoice?.discount) || 0;
  const sub = invoice?.subtotal || 0;
  const isFlat = invoice?.discount_type === "flat" || (discVal > 100 && invoice?.discount_type !== "percent");
  const afterDisc = isFlat ? Math.max(0, sub - discVal) : sub * (1 - discVal / 100);
  const totals = invoice ? { sub, afterDisc, tax: invoice.tax, total: invoice.total } : null;

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-start justify-center p-4 overflow-auto"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-3xl my-4" onMouseDown={e => e.stopPropagation()}>

        {/* Header */}
        <div className="px-4 sm:px-6 py-5 border-b border-slate-200 dark:border-slate-700 flex justify-between items-start">
          <div>
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1">{invoice.invoice_id} · {fmtDate(invoice.date)}</div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{customer?.company || invoice.customer_name}</h2>
            {invoice.due && <div className="text-sm text-slate-400 mt-0.5">Due: {fmtDate(invoice.due)}</div>}
          </div>
          <div className="flex items-center gap-3">
            {invoice.status && <span className="text-xs font-semibold text-slate-600 bg-slate-100 border border-slate-200 dark:border-slate-700 px-2.5 py-1 rounded-full">{invoice.status}</span>}
            {invoice.paid
              ? <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">Paid</span>
              : <span className="text-xs font-semibold text-red-500 bg-red-50 border border-red-100 px-2.5 py-1 rounded-full">Unpaid</span>}
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
          </div>
        </div>

        {/* Dates */}
        <div className="px-4 sm:px-6 py-4 grid grid-cols-2 sm:grid-cols-4 gap-4 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
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

        <div className="p-4 sm:p-6 space-y-5">
          {/* Line items.
              Handles two shapes:
                - Native InkTracker line items: have _ppp/_lineTotal saved
                  via "calculate once", plus sizes + imprints. Computed
                  via calcLinkedLinePrice as a fallback for legacy rows.
                - QB-pulled line items (from qbSync handlePullInvoices):
                  have li.lineTotal + li.qty directly, no sizes/imprints,
                  garmentCost: 0. Render as a simple row.
              The garmentCost "Wholesale:" badge only shows when there
              is a real cost — QB-pulled invoices set it to 0, which
              was rendering as "Wholesale: $0.00" everywhere. */}
          {!loading && invoice.line_items && (() => {
            const linkedQtyMap = buildLinkedQtyMap(invoice.line_items || []);
            return (invoice.line_items || []).map(li => {
            const qty = getQty(li) || Number(li.qty) || 0;
            const override = Number(li?.clientPpp);
            const hasOverride = Number.isFinite(override) && override > 0 && qty > 0;
            const hasSaved = Number.isFinite(li._ppp) && li._ppp > 0 && Number.isFinite(li._lineTotal);
            // Direct lineTotal from QB-pulled shape — last fallback so
            // pulled invoices show their real amount instead of $0.
            const directLineTotal = Number(li.lineTotal);
            const hasDirectTotal = Number.isFinite(directLineTotal) && directLineTotal !== 0;
            const r = hasSaved
              ? { ppp: li._ppp, lineTotal: li._lineTotal, rushFee: li._rushFee || 0 }
              : hasOverride
                ? { ppp: override, lineTotal: override * qty, rushFee: 0 }
                : hasDirectTotal
                  ? { ppp: qty > 0 ? directLineTotal / qty : directLineTotal, lineTotal: directLineTotal, rushFee: 0 }
                  : calcLinkedLinePrice(li, invoice.rush_rate || 0, invoice.extras || {}, undefined, linkedQtyMap);
            const activeSizes = SIZES.filter(sz => (parseInt((li.sizes||{})[sz]) || 0) > 0);
            const garmentCostNum = Number(li.garmentCost);
            const hasGarmentCost = Number.isFinite(garmentCostNum) && garmentCostNum > 0;
            return (
              <div key={li.id} className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                <div className="bg-slate-50 dark:bg-slate-800 px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <span className="font-bold text-slate-800 dark:text-slate-200 text-sm">{li.style || "Item"}</span>
                    {li.garmentColor && <span className="ml-2 text-xs text-slate-500">· {li.garmentColor}</span>}
                    {hasGarmentCost && <span className="ml-2 text-xs text-slate-400">Wholesale: {fmtMoney(garmentCostNum)}</span>}
                  </div>
                  {r && r.lineTotal !== 0 && <span className="font-bold text-slate-700 text-sm whitespace-nowrap">{fmtMoney(r.lineTotal)}</span>}
                </div>

                {activeSizes.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                        <td className="px-4 py-2 text-xs text-slate-400 font-semibold">Size</td>
                        {activeSizes.map(sz => <td key={sz} className="px-3 py-2 text-center text-xs font-semibold text-slate-600">{sz}</td>)}
                        <td className="px-4 py-2 text-center text-xs font-semibold text-slate-600">Total</td>
                      </tr></thead>
                      <tbody>
                        <tr>
                          <td className="px-4 py-2 text-xs text-slate-500">Qty</td>
                          {activeSizes.map(sz => <td key={sz} className="px-3 py-2 text-center font-semibold text-slate-800 dark:text-slate-200">{(li.sizes||{})[sz] || 0}</td>)}
                          <td className="px-4 py-2 text-center font-bold text-slate-800 dark:text-slate-200">{qty}</td>
                        </tr>
                        {r && (
                          <tr>
                            <td className="px-4 py-2 text-xs text-slate-400">Price/ea</td>
                            {activeSizes.map(sz => (
                              <td key={sz} className="px-3 py-2 text-center text-xs text-slate-500">
                                {fmtMoney(r.ppp)}
                              </td>
                            ))}
                            <td className="px-4 py-2 text-center text-xs font-bold text-slate-700">{fmtMoney(r.lineTotal)}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* No-sizes/no-imprints fallback (e.g. QB-pulled rows):
                    show a single qty × price/ea row instead of an empty
                    body so the line item card still conveys the numbers. */}
                {activeSizes.length === 0 && (li.imprints || []).length === 0 && r && qty > 0 && (
                  <div className="px-4 py-3 flex items-center justify-between text-xs text-slate-500">
                    <span>{qty} × {fmtMoney(r.ppp)}</span>
                    <span className="font-bold text-slate-700">{fmtMoney(r.lineTotal)}</span>
                  </div>
                )}

                {(li.imprints || []).length > 0 && (
                  <div className="border-t border-slate-100 dark:border-slate-700 p-4 space-y-3">
                    {(li.imprints || []).map(imp => (
                      <div key={imp.id} className="space-y-1.5">
                        {imp.title && <div className="text-xs font-bold text-slate-800 dark:text-slate-200">{imp.title}</div>}
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-2 border border-slate-100 dark:border-slate-700">
                          <span className="font-bold text-slate-800 dark:text-slate-200">{imp.location}</span>
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
                )}
              </div>
            );
          })})()}

          {/* Extras / Add-ons */}
          {invoice.extras && Object.values(invoice.extras).some(Boolean) && (
            <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">Add-ons</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(invoice.extras).filter(([,v])=>v).map(([k])=>(
                  <span key={k} className="text-xs font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 px-2.5 py-1 rounded-full capitalize">{k.replace(/([A-Z])/g,' $1')}</span>
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
          <div className="bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2">
            <div className="flex justify-between text-sm text-slate-500"><span>Subtotal</span><span>{fmtMoney(invoice.subtotal)}</span></div>
            {invoice.discount > 0 && (
              <div className="flex justify-between text-sm text-emerald-600">
                <span>Discount {isFlat ? `(${fmtMoney(discVal)})` : `(${invoice.discount}%)`}</span>
                <span>−{fmtMoney(sub - afterDisc)}</span>
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
            <div className="flex justify-between font-bold text-slate-900 dark:text-slate-100 border-t border-slate-200 dark:border-slate-700 pt-2">
              <span className="text-base">Total</span>
              <span className="text-2xl">{fmtMoney(invoice.total)}</span>
            </div>
          </div>
        </div>

        {/* Messages — threaded conversation with reply box. Collapsible;
            shares one localStorage key with the other detail modals so
            the user's preference applies everywhere. */}
        <CollapsibleSection
          title="Messages"
          icon={<MessageSquare className="w-4 h-4 text-slate-500" />}
          storageKey="messages-window-collapsed"
          className="px-4 sm:px-6 py-4 border-t border-slate-200 dark:border-slate-700"
        >
          <MessagesTab
            threadId={invoiceThreadId(invoice)}
            currentUserEmail={invoice.shop_owner}
            replyContext={{
              customerEmail: invoice.customer_email || customer?.email || "",
              shopName,
              refId: invoice.invoice_id,
              defaultSubject: `Invoice ${invoice.invoice_id}`,
            }}
          />
        </CollapsibleSection>

        {/* Footer */}
        <div className="flex flex-wrap items-center gap-2 px-4 sm:px-6 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-b-2xl">
          {!invoice.paid && (
            <button onClick={() => { onMarkPaid(invoice.id); onClose(); }}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition">
              Mark as Paid
            </button>
          )}
          {invoice.status === "Draft" && onConvertToInvoice && (
            <button onClick={() => { onConvertToInvoice(invoice); onClose(); }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition">
              Convert to Invoice
            </button>
          )}
          {!invoice.paid && (
            <button onClick={() => setShowSendModal(true)}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition">
              Send Invoice
            </button>
          )}
          {invoice.order_id && (
            <button onClick={async () => {
              try {
                const order = await base44.entities.Order.filter({ order_id: invoice.order_id });
                if (order?.[0]) setViewingOrder(order[0]);
                else alert("Order not found");
              } catch { alert("Could not load order"); }
            }}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition">
              View Order
            </button>
          )}
          <button onClick={handleCreateInQB} disabled={qbCreating}
            className="text-xs font-semibold text-[#2CA01C] hover:text-[#248A18] px-3 py-1.5 rounded-lg hover:bg-[#2CA01C]/5 transition disabled:opacity-50">
            {qbCreating ? "Creating…" : "Create in QB"}
          </button>
          <button onClick={async () => {
            // QB-synced invoices: show what QB actually generated, not our local copy.
            const target = resolveInvoicePdfSource(invoice);
            if (target.source === "qb") {
              const blobUrl = await fetchQBInvoicePdfBlob(target.qbInvoiceId);
              if (blobUrl) { window.open(blobUrl, "_blank"); return; }
              // QB fetch failed — fall through to local PDF.
            }
            const url = await exportInvoiceToPDF(invoice, customer, { shop: shopProfile || { shop_name: shopName }, logoUrl, output: "blob" });
            if (url) window.open(url, "_blank");
          }}
            className="text-xs font-semibold text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition">
            Preview PDF
          </button>
          <button onClick={async () => {
            const target = resolveInvoicePdfSource(invoice);
            if (target.source === "qb") {
              const blobUrl = await fetchQBInvoicePdfBlob(target.qbInvoiceId);
              if (blobUrl) {
                const a = document.createElement("a");
                a.href = blobUrl;
                a.download = `Invoice-${invoice.invoice_id || target.qbInvoiceId}.pdf`;
                a.click();
                URL.revokeObjectURL(blobUrl);
                return;
              }
              // QB fetch failed — fall through to local PDF.
            }
            exportInvoiceToPDF(invoice, customer, { shop: shopProfile || { shop_name: shopName }, logoUrl });
          }}
            className="text-xs font-semibold text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition">
            Download PDF
          </button>
          <button onClick={handleReorder} disabled={reordering}
            className="text-xs font-semibold text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition disabled:opacity-50">
            {reordered ? "✓ Reordered" : reordering ? "Creating…" : "Reorder"}
          </button>
          {onDelete && <button onClick={() => onDelete(invoice.id)}
            className="text-xs font-semibold text-red-400 hover:text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-50 transition">
            Delete
          </button>}
          <button onClick={onClose} className="ml-auto text-xs font-semibold text-slate-400 hover:text-slate-600 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition">Close</button>
        </div>
        {qbStatus && (
          <div className={`px-4 sm:px-6 py-2 text-sm border-t ${
            qbStatus.type === "success" ? "bg-emerald-50 border-emerald-200 text-emerald-700" :
            qbStatus.type === "info" ? "bg-blue-50 border-blue-200 text-blue-700" :
            "bg-red-50 border-red-200 text-red-600"
          }`}>
            {qbStatus.text}
          </div>
        )}

        {showSendModal && (
          <SendInvoiceModal
            invoice={invoice}
            customer={customer}
            onClose={() => setShowSendModal(false)}
            onSuccess={() => setShowSendModal(false)}
          />
        )}
        {viewingOrder && (
          <OrderDetailModal
            order={viewingOrder}
            onClose={() => setViewingOrder(null)}
          />
        )}
      </div>
    </div>
  );
}