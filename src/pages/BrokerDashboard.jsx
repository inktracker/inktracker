import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { base44 } from "@/api/supabaseClient";
import {
  Users,
  Package,
  Plus,
  LogOut,
  Clock,
  CheckCircle2,
  XCircle,
  PenLine,
  ChevronRight,
  X,
  Truck,
  UserCircle,
  MessageSquare,
  Paperclip,
  BarChart2,
  FolderOpen,
  FileText,
  Eye,
  Send,
  Pencil,
  Trash2,
  Download,
  ThumbsUp,
  ThumbsDown,
  CreditCard,
  ArrowRight,
  TrendingUp,
} from "lucide-react";
import BrokerOrderPDFModal from "../components/broker/BrokerOrderPDFModal";
import BrokerPerformance from "../components/broker/BrokerPerformance";
import {
  fmtDate,
  fmtMoney,
  calcQuoteTotals,
  BROKER_MARKUP,
} from "../components/shared/pricing";
import BrokerQuoteEditor from "../components/broker/BrokerQuoteEditor";
import BrokerClientList from "../components/broker/BrokerClientList";
import BrokerProfile from "../components/broker/BrokerProfile";
import ShopActionFeed from "../components/broker/ShopActionFeed";
import BrokerMessaging from "../components/broker/BrokerMessaging";
import BrokerPerformanceSelf from "../components/broker/BrokerPerformanceSelf";
import BrokerLayout from "../components/broker/BrokerLayout";
import BrokerInvoicesTab from "../components/broker/BrokerInvoicesTab";
import ModalBackdrop from "../components/shared/ModalBackdrop";
import { exportQuoteToPDF } from "../components/shared/pdfExport";
import { STANDARD_MARKUP, O_STATUSES } from "../components/shared/pricing";
import { normalizeQuoteStatus } from "@/lib/broker/quoteStatus";
import {
  getQuoteTotalSafe as getQuoteTotalSafeLib,
  getClientTotalSafe as getClientTotalSafeLib,
} from "@/lib/broker/quoteTotals";
import SendQuoteModal from "../components/quotes/SendQuoteModal";
import { notify } from "@/lib/notify";

// Broker dashboard's per-order progress strip. Now uses the canonical
// O_STATUSES (slim 5-stage pipeline) instead of its own copy.
const ORDER_STEPS = O_STATUSES;

const STATUS_CONFIG = {
  Draft: { label: "Draft", icon: PenLine, bg: "bg-slate-100", text: "text-slate-600", bar: "bg-slate-400" },
  Pending: { label: "Pending", icon: Clock, bg: "bg-yellow-100", text: "text-yellow-700", bar: "bg-yellow-500" },
  Sent: { label: "Pending", icon: Clock, bg: "bg-blue-100", text: "text-blue-700", bar: "bg-blue-500" },
  Approved: { label: "Shop Approved", icon: CheckCircle2, bg: "bg-emerald-100", text: "text-emerald-700", bar: "bg-emerald-500" },
  "Approved and Paid": { label: "Shop Approved", icon: CheckCircle2, bg: "bg-emerald-100", text: "text-emerald-700", bar: "bg-emerald-500" },
  "Shop Approved": { label: "Shop Approved", icon: CheckCircle2, bg: "bg-emerald-100", text: "text-emerald-700", bar: "bg-emerald-500" },
  "Sent to Client": { label: "Sent to Client", icon: Send, bg: "bg-blue-100", text: "text-blue-700", bar: "bg-blue-500" },
  "Client Approved": { label: "Client Approved", icon: ThumbsUp, bg: "bg-teal-100", text: "text-teal-700", bar: "bg-teal-500" },
  "Client Rejected": { label: "Client Rejected", icon: ThumbsDown, bg: "bg-red-100", text: "text-red-600", bar: "bg-red-400" },
  "Converted to Order": { label: "Converted", icon: ArrowRight, bg: "bg-violet-100", text: "text-violet-700", bar: "bg-violet-500" },
  Declined: { label: "Declined", icon: XCircle, bg: "bg-red-100", text: "text-red-600", bar: "bg-red-400" },
};

function QuoteStatusBadge({ status }) {
  const normalized = normalizeQuoteStatus(status);
  const cfg = STATUS_CONFIG[normalized] || STATUS_CONFIG.Draft;
  const Icon = cfg.icon;

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${cfg.bg} ${cfg.text}`}
    >
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

function QuoteDetailDrawer({ quote, onClose, onEdit, onSubmit, onDelete, onUpdate, shop, user }) {
  // Both broker-side and client-side totals are read straight from the
  // saved quote. The broker editor stamps both at save time
  // (BrokerQuoteEditor.runSave). No recomputation — saved is the contract.
  // Legacy quotes saved before client_* columns existed fall back to live
  // calc so older rows still display sensibly.
  const brokerTotals = (Number.isFinite(quote.total) && Number.isFinite(quote.subtotal))
    ? {
        sub:       Number(quote.subtotal),
        afterDisc: Number(quote.total) - Number(quote.tax || 0),
        tax:       Number(quote.tax || 0),
        total:     Number(quote.total),
        deposit:   (Number(quote.total)) * ((parseFloat(quote.deposit_pct) || 0) / 100),
      }
    : calcQuoteTotals(quote, BROKER_MARKUP);
  const clientTotals = (Number.isFinite(quote.client_total) && Number.isFinite(quote.client_subtotal))
    ? {
        sub:       Number(quote.client_subtotal),
        afterDisc: Number(quote.client_total) - Number(quote.client_tax || 0),
        tax:       Number(quote.client_tax || 0),
        total:     Number(quote.client_total),
        deposit:   (Number(quote.client_total)) * ((parseFloat(quote.deposit_pct) || 0) / 100),
      }
    : calcQuoteTotals(quote, STANDARD_MARKUP);
  const normalizedStatus = normalizeQuoteStatus(quote.status);
  const canSubmit = normalizedStatus === "Draft";
  // Brokers can delete anything that doesn't have a real order behind
  // it. "Converted to Order" is the lock — there's an active Order row
  // tied to this quote; deleting the source would orphan the audit
  // trail (OrderDetailModal looks up quote.id → totals, line items,
  // message thread). Everything else (Draft, Sent to Client, Client
  // Approved/Rejected, Pending, Shop Approved, Declined) is fair game.
  const canDelete = normalizedStatus !== "Converted to Order";
  // Shop-visible statuses — warn the broker before yanking it from
  // the shop's queue. The shop will just see it vanish; no cross-
  // tenant notification yet (follow-up).
  const isShopVisible =
    normalizedStatus === "Pending" || normalizedStatus === "Shop Approved";
  const [actionLoading, setActionLoading] = useState(null);
  const [showPaymentPicker, setShowPaymentPicker] = useState(false);
  const [showSendModal, setShowSendModal] = useState(false);

  // New workflow (2026-05-22): broker → client FIRST, then client → shop.
  // The shop only sees quotes that the broker's client has already approved.
  // This stops the shop from reviewing quotes that never materialize.
  //
  //   Draft           → Send to Client       (sets status: "Sent to Client")
  //   Sent to Client  → Mark Client Approved → "Client Approved"
  //   Client Approved → Submit to Shop       (sets status: "Pending")
  //   Pending         → (shop reviews)       → "Shop Approved"
  //   Shop Approved   → (shop produces)      → "Converted to Order"
  const shopApproved = quote.status === "Shop Approved" || quote.status === "Approved" || quote.status === "Approved and Paid";
  const sentToClient = quote.status === "Sent to Client";
  const clientApproved = quote.status === "Client Approved";
  // Send to Client is available from Draft (initial send) and Sent to Client
  // (resend). Once the client has approved, no point in resending.
  const canSendToClient = normalizedStatus === "Draft" || sentToClient;
  const canMarkClientApproved = sentToClient;
  const canMarkClientResponse = sentToClient;
  // Submit to Shop is gated on client approval.
  const canSubmitToShop = clientApproved;
  const canRecordPayment = clientApproved || shopApproved;
  const isConverted = quote.status === "Converted to Order";

  async function doUpdate(fields, loadingKey) {
    setActionLoading(loadingKey);
    const updated = await base44.entities.Quote.update(quote.id, fields);
    onUpdate(updated);
    setActionLoading(null);
  }

  function handleSendToClient() {
    setShowSendModal(true);
  }

  async function handleSendToClientSuccess() {
    // SendQuoteModal already emailed and set status="Sent".
    // Now update to "Sent to Client" status.
    const updated = await base44.entities.Quote.update(quote.id, {
      status: "Sent to Client",
      sent_to_client_at: new Date().toISOString(),
    });
    onUpdate(updated);
    setShowSendModal(false);
  }

  async function handleMarkClientApproved() {
    // Under the new client-first workflow, the shop doesn't get notified
    // here — the quote is still broker-only at this point (status:
    // "Client Approved"). Notification fires when the broker explicitly
    // hits "Submit to Shop" (see handleSubmitDraft).
    await doUpdate({
      status: "Client Approved",
      client_status: "Approved",
      client_approved_at: new Date().toISOString(),
      payment_status: quote.payment_status || "Unpaid",
    }, "clientApproved");
  }

  async function handleMarkClientRejected() {
    await doUpdate({
      status: "Client Rejected",
      client_status: "Rejected",
    }, "clientRejected");
    // Notify shop
    if (quote.shop_owner) {
      await base44.entities.BrokerNotification.create({
        shop_owner: quote.shop_owner,
        broker_id: quote.broker_id || quote.broker_email || "",
        broker_name: quote.broker_name || "",
        broker_company: quote.broker_company || "",
        action: "client_rejected_quote",
        item_label: `${quote.quote_id} — ${quote.customer_name}`,
        item_id: quote.id,
        item_entity: "Quote",
        read: false,
      });
    }
  }

  async function handleRecordPayment(paymentStatus) {
    setShowPaymentPicker(false);
    await doUpdate({ payment_status: paymentStatus }, "recordPayment");
  }


  return (
    <>
    <ModalBackdrop onClose={onClose} z="z-50" bg="bg-slate-900/50" layout="slide-right">
      <div className="bg-white w-full max-w-lg h-full overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50 sticky top-0 z-10">
          <div>
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
              {quote.quote_id}
            </div>
            <div className="font-bold text-slate-900 text-lg">
              {quote.customer_name || "—"}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <QuoteStatusBadge status={quote.status} />
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
              <div className="text-xs text-slate-400 font-semibold uppercase tracking-wide mb-0.5">Quote Date</div>
              <div className="font-semibold text-slate-800">{fmtDate(quote.date)}</div>
            </div>

            {quote.due_date && (
              <div className={`rounded-xl px-4 py-3 border ${quote.rush_rate > 0 ? "bg-orange-50 border-orange-200" : "bg-slate-50 border-slate-100"}`}>
                <div className="text-xs font-semibold uppercase tracking-wide mb-0.5 text-slate-400">In-Hands Date</div>
                <div className={`font-semibold ${quote.rush_rate > 0 ? "text-orange-700" : "text-slate-800"}`}>
                  {fmtDate(quote.due_date)} {quote.rush_rate > 0 && "⚡ Rush"}
                </div>
              </div>
            )}
          </div>

          {/* Status banners — wording reflects the client-first workflow:
              quotes must be approved by the client BEFORE they go to the shop. */}
          {normalizedStatus === "Draft" && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-700">
              <span className="font-semibold">Saved as draft.</span> Send to your client to get approval before submitting to the shop.
            </div>
          )}
          {quote.status === "Sent to Client" && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-800">
              <span className="font-semibold">Sent to client.</span> Waiting for their response — once they approve, you can submit to the shop.
              {quote.sent_to_client_at && <div className="text-xs mt-1 text-blue-600">Sent: {new Date(quote.sent_to_client_at).toLocaleDateString()}</div>}
            </div>
          )}
          {quote.status === "Client Approved" && (
            <div className="bg-teal-50 border border-teal-200 rounded-xl px-4 py-3 text-sm text-teal-800">
              <span className="font-semibold">Client approved!</span> Submit to your shop to start production.
              {quote.payment_status && quote.payment_status !== "Unpaid" && (
                <div className="text-xs mt-1 font-semibold text-teal-600">Payment: {quote.payment_status}</div>
              )}
            </div>
          )}
          {normalizedStatus === "Pending" && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 text-sm text-yellow-800">
              <span className="font-semibold">Awaiting shop review.</span> The client has approved and the shop is now reviewing the order.
            </div>
          )}
          {shopApproved && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm text-emerald-800">
              <span className="font-semibold">Shop approved!</span> Production is starting.
            </div>
          )}
          {quote.status === "Client Rejected" && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
              <span className="font-semibold">Client rejected.</span> Contact your client for more information.
            </div>
          )}
          {normalizedStatus === "Declined" && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
              <span className="font-semibold">Quote declined by shop.</span> Contact the shop for more information.
            </div>
          )}
          {isConverted && (
            <div className="bg-violet-50 border border-violet-200 rounded-xl px-4 py-3 text-sm text-violet-800">
              <span className="font-semibold">Converted to order!</span>
              {quote.converted_order_id && (
                <div className="text-xs mt-1 font-mono text-violet-600">Order ID: {quote.converted_order_id}</div>
              )}
            </div>
          )}

          {/* Payment status indicator */}
          {quote.payment_status && quote.payment_status !== "Unpaid" && quote.status !== "Client Approved" && (
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
              <CreditCard className="w-3.5 h-3.5" /> Payment: {quote.payment_status}
            </div>
          )}

          {/* Line Items */}
          {(quote.line_items || []).length > 0 && (
            <div>
              <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Line Items</div>
              <div className="space-y-2">
                {quote.line_items.map((li, i) => {
                  const qty = Object.values(li.sizes || {}).reduce((s, v) => s + (parseInt(v) || 0), 0);
                  return (
                    <div key={li.id || i} className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-semibold text-slate-800 text-sm">{li.style || "Garment"}</div>
                          {li.garmentColor && <div className="text-xs text-slate-400">{li.garmentColor}</div>}
                        </div>
                        <div className="text-xs font-semibold text-slate-600 bg-slate-200 rounded-full px-2 py-0.5">Qty: {qty}</div>
                      </div>
                      {(li.imprints || []).filter((imp) => imp.colors > 0).map((imp, j) => (
                        <div key={j} className="mt-2 text-xs text-slate-500 flex gap-2">
                          <span className="font-semibold text-slate-700">{imp.location}</span>
                          <span>·</span>
                          <span>{imp.colors} color{imp.colors !== 1 ? "s" : ""}</span>
                          <span>·</span>
                          <span>{imp.technique}</span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {quote.notes && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
              <span className="font-semibold">Notes: </span>{quote.notes}
            </div>
          )}

          {/* Pricing */}
          <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-2">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1">Your Broker Price</div>
            <div className="flex justify-between text-sm text-slate-500">
              <span>Subtotal</span><span>{fmtMoney(brokerTotals.sub)}</span>
            </div>
            {parseFloat(quote.discount) > 0 && (() => {
              const dv = parseFloat(quote.discount);
              const isFlat = quote.discount_type === "flat" || (dv > 100 && quote.discount_type !== "percent");
              return (
                <div className="flex justify-between text-sm text-emerald-600">
                  <span>Discount {isFlat ? `(${fmtMoney(dv)})` : `(${quote.discount}%)`}</span>
                  <span>−{fmtMoney(brokerTotals.sub - brokerTotals.afterDisc)}</span>
                </div>
              );
            })()}
            <div className="flex justify-between font-bold text-slate-900 border-t border-slate-200 pt-2 text-lg">
              <span>Your Price</span><span>{fmtMoney(brokerTotals.total)}</span>
            </div>
            {Number(quote.deposit_pct) > 0 && (
              <div className="flex justify-between text-sm text-indigo-600 font-semibold">
                <span>Deposit ({quote.deposit_pct}%)</span><span>{fmtMoney(brokerTotals.deposit)}</span>
              </div>
            )}
            <div className="border-t border-slate-200 pt-2 mt-1">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1">Client Sees</div>
              <div className="flex justify-between font-bold text-violet-700">
                <span>Client Total</span><span>{fmtMoney(clientTotals.total)}</span>
              </div>
            </div>
          </div>

          {/* Payment picker inline */}
          {showPaymentPicker && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
              <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Select Payment Status</div>
              {["Deposit Requested", "Deposit Paid", "Paid in Full"].map((opt) => (
                <button
                  key={opt}
                  onClick={() => handleRecordPayment(opt)}
                  className="w-full text-left text-sm font-semibold px-4 py-2.5 rounded-xl border border-slate-200 hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700 transition"
                >
                  {opt}
                </button>
              ))}
              <button
                onClick={() => setShowPaymentPicker(false)}
                className="w-full text-sm text-slate-400 py-1.5"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        {/* Action footer */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 sticky bottom-0 space-y-2">
          {/* PDF downloads — always shown */}
          <div className="flex gap-2">
            <button
              onClick={async () => {
                try {
                  await exportQuoteToPDF(quote, {
                    mode: "shop",
                    shopName: shop?.shop_name || "",
                    logoUrl: shop?.logo_url || "",
                  });
                } catch (err) {
                  console.error("[BrokerDashboard] Shop PDF export failed:", err);
                  notify.error("Couldn't generate Shop Order Form PDF", err);
                }
              }}
              className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-semibold border border-slate-200 text-slate-600 py-2 rounded-xl hover:bg-slate-100 transition"
            >
              <Download className="w-3.5 h-3.5" /> Shop Order Form
            </button>
            <button
              onClick={async () => {
                try {
                  await exportQuoteToPDF(quote, {
                    mode: "client",
                    shopName: user?.company_name || user?.display_name || user?.full_name || "",
                  });
                } catch (err) {
                  console.error("[BrokerDashboard] Client PDF export failed:", err);
                  notify.error("Couldn't generate Client Quote PDF", err);
                }
              }}
              className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-semibold border border-slate-200 text-slate-600 py-2 rounded-xl hover:bg-slate-100 transition"
            >
              <Download className="w-3.5 h-3.5" /> Client Quote
            </button>
          </div>

          {/* Draft → Edit + Send to Client. The broker MUST get the client
              to approve before submitting to the shop, so "Submit to Shop"
              is intentionally not available from Draft. */}
          {canSubmit && (
            <div className="flex gap-2">
              <button
                onClick={() => onEdit(quote)}
                className="flex-1 inline-flex items-center justify-center gap-2 border border-slate-200 text-slate-700 text-sm font-semibold py-2.5 rounded-xl hover:bg-slate-100 transition"
              >
                <Pencil className="w-4 h-4" /> Edit Draft
              </button>
              <button
                onClick={handleSendToClient}
                className="flex-1 inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold py-2.5 rounded-xl transition"
              >
                <Send className="w-4 h-4" /> Send to Client
              </button>
            </div>
          )}

          {/* Resend to Client (post-send / pre-client-response) */}
          {sentToClient && (
            <button
              onClick={handleSendToClient}
              className="w-full inline-flex items-center justify-center gap-2 border border-indigo-200 text-indigo-600 text-sm font-semibold py-2.5 rounded-xl hover:bg-indigo-50 transition"
            >
              <Send className="w-4 h-4" /> Resend to Client
            </button>
          )}

          {/* Client Approved → Submit to Shop. This is the trigger that
              moves the quote into the shop's queue. Only here do we set
              status="Pending" so the shop sees it. */}
          {canSubmitToShop && (
            <button
              onClick={() => onSubmit(quote)}
              className="w-full inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold py-2.5 rounded-xl transition"
            >
              <Send className="w-4 h-4" /> Submit to Shop
            </button>
          )}

          {/* Client response buttons — shown after sending */}
          {canMarkClientResponse ? (
            <div className="flex gap-2">
              <button
                disabled={actionLoading === "clientApproved"}
                onClick={handleMarkClientApproved}
                className="flex-1 inline-flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold py-2.5 rounded-xl transition disabled:opacity-60"
              >
                <ThumbsUp className="w-4 h-4" />
                {actionLoading === "clientApproved" ? "Saving…" : "Client Approved"}
              </button>
              <button
                disabled={actionLoading === "clientRejected"}
                onClick={handleMarkClientRejected}
                className="flex-1 inline-flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold py-2.5 rounded-xl transition disabled:opacity-60"
              >
                <ThumbsDown className="w-4 h-4" />
                {actionLoading === "clientRejected" ? "Saving…" : "Client Rejected"}
              </button>
            </div>
          ) : canMarkClientApproved ? (
            <button
              disabled={actionLoading === "clientApproved"}
              onClick={handleMarkClientApproved}
              className="w-full inline-flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold py-2.5 rounded-xl transition disabled:opacity-60"
            >
              <ThumbsUp className="w-4 h-4" />
              {actionLoading === "clientApproved" ? "Saving…" : "Mark Client Approved"}
            </button>
          ) : null}

          {/* Record Payment */}
          {canRecordPayment && !showPaymentPicker && (
            <button
              onClick={() => setShowPaymentPicker(true)}
              className="w-full inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold py-2.5 rounded-xl transition"
            >
              <CreditCard className="w-4 h-4" /> Record Payment
            </button>
          )}


          {/* Close / Delete */}
          <div className="flex gap-2">
            {!canSubmit && (
              <button
                onClick={onClose}
                className="flex-1 border border-slate-200 text-slate-600 text-sm font-semibold py-2 rounded-xl hover:bg-slate-100 transition"
              >
                Close
              </button>
            )}
            {canDelete && (
              <button
                onClick={() => onDelete(quote, { isShopVisible })}
                className="inline-flex items-center justify-center gap-2 border border-red-200 text-red-600 text-sm font-semibold py-2 px-4 rounded-xl hover:bg-red-50 transition"
              >
                <Trash2 className="w-4 h-4" /> Delete Quote
              </button>
            )}
          </div>
        </div>
      </div>
    </ModalBackdrop>

    {showSendModal && (
      <SendQuoteModal
        quote={quote}
        customer={null}
        onClose={() => setShowSendModal(false)}
        onSuccess={handleSendToClientSuccess}
      />
    )}
    </>
  );
}

// initialTab lets a top-level route wrapper (e.g. QuotesRoute) mount
// the broker dashboard already pinned to a section without needing
// the ?tab= query string. Used by the shared /Quotes route — when a
// broker navigates there, QuotesRoute renders BrokerDashboard
// initialTab="quotes" so the section opens directly. Falls back to
// ?tab= and finally to "overview" when no signal is provided.
export default function BrokerDashboard({ initialTab } = {}) {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(() => {
    // initialTab (from a top-level route wrapper like QuotesRoute) wins
    // over the legacy ?tab= query string, which itself overrides the
    // default landing "overview" (was "quotes" — the combined
    // Overview+List page that got split on 2026-05-27).
    if (initialTab) return initialTab;
    const params = new URLSearchParams(window.location.search);
    return params.get("tab") || "overview";
  });
  const [quotes, setQuotes] = useState([]);
  const [clients, setClients] = useState([]);
  const [orders, setOrders] = useState([]);
  const [shopAddons, setShopAddons] = useState(null);
  const [shop, setShop] = useState(null);
  const [editorQuote, setEditorQuote] = useState(null);
  const [showEditor, setShowEditor] = useState(false);
  const [previewOrder, setPreviewOrder] = useState(null);
  const [selectedQuote, setSelectedQuote] = useState(null);
  const [filterStatus, setFilterStatus] = useState("All");
  // Unread message count addressed to this broker. Used by BrokerLayout to
  // show a badge on the Messages tab so the broker notices new messages
  // without sitting on that tab.
  const [unreadMessageCount, setUnreadMessageCount] = useState(0);
  // Unread BrokerNotification rows where this broker is the recipient
  // (shop-side actions: approved / declined / order completed). Mirror of
  // the shop's brokerUnreadCount — gives the broker a heads-up when their
  // shop has acted on something.
  const [shopActionUnreadCount, setShopActionUnreadCount] = useState(0);

  useEffect(() => {
    async function load() {
      try {
        const u = await base44.auth.me();
        if (!u) {
          base44.auth.redirectToLogin();
          return;
        }

        if (u.role !== "broker") {
          window.location.href = "/";
          return;
        }

        // First-time broker: if profile is incomplete, redirect to onboarding
        if (!u.full_name?.trim()) {
          window.location.href = "/BrokerOnboarding";
          return;
        }

        const assignedShop = (u.assigned_shops || [])[0] || null;
        const [allQuotes, myClients, myOrders, shopResults, shopProfileResults] = await Promise.all([
          base44.entities.Quote.filter({ broker_id: u.email }, "-created_date", 200),
          base44.entities.Customer.filter({ shop_owner: `broker:${u.email}` }),
          base44.entities.Order.filter({ broker_id: u.email }, "-created_date", 100),
          assignedShop ? base44.entities.Shop.filter({ owner_email: assignedShop }) : Promise.resolve([]),
          // shop_name and logo_url live on the shop owner's profile (not on
          // the shops table). Fetch them so the broker's shop-form PDF can
          // show the host shop's branding.
          assignedShop ? base44.entities.User.filter({ email: assignedShop }) : Promise.resolve([]),
        ]);
        const shopRecord = (shopResults || [])[0] || null;
        const shopProfile = (shopProfileResults || [])[0] || null;
        // Merge profile fields onto the shop object so existing consumers
        // (BrokerQuoteEditor's shop?.shop_name etc.) just work.
        setShop(shopRecord || shopProfile ? {
          ...(shopRecord || {}),
          shop_name: shopProfile?.shop_name || shopRecord?.shop_name || "",
          logo_url: shopProfile?.logo_url || shopRecord?.logo_url || "",
          owner_email: assignedShop || shopRecord?.owner_email || "",
        } : null);
        if (shopRecord?.addons?.length) {
          setShopAddons(shopRecord.addons.map(a => ({ ...a, rate: parseFloat(a.rate) || 0 })));
        }

        const myQuotes = (allQuotes || []).filter((q) => {
          return (
            q?.broker_id === u.email ||
            q?.broker_email === u.email ||
            q?.brokerId === u.email ||
            q?.created_by === u.email ||
            q?.shop_owner === `broker:${u.email}`
          );
        });

        setUser(u);
        setQuotes(myQuotes);
        setClients([...(myClients || [])].sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: 'base' })));
        setOrders(myOrders || []);

        // Unread message count for the Messages-tab badge. Anything where
        // the broker is the recipient and the row hasn't been marked read
        // yet. BrokerMessaging flips read=true on view, so this naturally
        // drops as the broker reads their inbox.
        try {
          const unread = await base44.entities.Message.filter({
            to_email: u.email,
            read: false,
          }, "-created_date", 200);
          setUnreadMessageCount((unread || []).length);
        } catch {
          // Best-effort — bad count just hides the badge, doesn't break.
        }

        // Shop-action notification count comes from the ShopActionFeed
        // component (it owns the list + realtime subscription and reports
        // unread count up via onUnreadCountChange).
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  // (Shop-action notification realtime is owned by ShopActionFeed — it
  // pushes the unread count back via onUnreadCountChange.)

  // Realtime: keep the unread-message badge fresh as new messages arrive
  // and as the broker (or the open thread) flips read=true on view.
  useEffect(() => {
    if (!user?.email) return;
    const unsub = base44.entities.Message.subscribe((payload) => {
      const row = payload?.new || payload?.old;
      if (!row) return;
      // Only care about messages addressed to this broker.
      const isMine = row.to_email === user.email;
      if (!isMine) return;
      if (payload.eventType === "INSERT") {
        if (!row.read) setUnreadMessageCount((n) => n + 1);
      } else if (payload.eventType === "UPDATE") {
        // Catch the unread → read flip from BrokerMessaging's read-on-view.
        const wasUnread = payload.old?.read === false;
        const isNowRead = row.read === true;
        if (wasUnread && isNowRead) {
          setUnreadMessageCount((n) => Math.max(0, n - 1));
        }
      } else if (payload.eventType === "DELETE") {
        if (payload.old?.read === false) {
          setUnreadMessageCount((n) => Math.max(0, n - 1));
        }
      }
    });
    return unsub;
  }, [user?.email]);

  useEffect(() => {
    if (!user) return;

    const unsubOrders = base44.entities.Order.subscribe((event) => {
      const eventBrokerId = event?.data?.broker_id;

      setOrders((prev) => {
        const alreadyExists = prev.some((o) => o.id === event.id);
        const belongsToBroker = eventBrokerId === user.email || alreadyExists;

        if (!belongsToBroker) return prev;

        if (event.type === "update") {
          return prev.map((o) => (o.id === event.id ? { ...o, ...event.data } : o));
        }

        if (event.type === "create") {
          return [{ ...event.data }, ...prev.filter((o) => o.id !== event.id)];
        }

        if (event.type === "delete") {
          return prev.filter((o) => o.id !== event.id);
        }

        return prev;
      });
    });

    const unsubQuotes = base44.entities.Quote.subscribe((event) => {
      const eventData = event?.data || {};

      setQuotes((prev) => {
        const alreadyExists = prev.some((q) => q.id === event.id);

        const belongsToBroker =
          eventData?.broker_id === user.email ||
          eventData?.broker_email === user.email ||
          eventData?.brokerId === user.email ||
          eventData?.created_by === user.email ||
          eventData?.shop_owner === `broker:${user.email}` ||
          alreadyExists;

        if (!belongsToBroker) return prev;

        if (event.type === "update") {
          return prev.map((q) => (q.id === event.id ? { ...q, ...eventData } : q));
        }

        if (event.type === "create") {
          return [{ ...eventData }, ...prev.filter((q) => q.id !== event.id)];
        }

        if (event.type === "delete") {
          return prev.filter((q) => q.id !== event.id);
        }

        return prev;
      });

      setSelectedQuote((prev) => {
        if (!prev || prev.id !== event.id) return prev;

        if (event.type === "update") {
          return { ...prev, ...eventData };
        }

        if (event.type === "delete") {
          return null;
        }

        return prev;
      });
    });

    return () => {
      unsubOrders();
      unsubQuotes();
    };
  }, [user]);

  async function handleSaveQuote(quoteData) {
    const assignedShop = (user.assigned_shops || [])[0] || null;
    const nextStatus = quoteData.status || "Draft";
    const isSubmittingToShop = nextStatus === "Pending";

    if (isSubmittingToShop && !assignedShop) {
      notify.error(
        "Your account isn't linked to a shop",
        "Ask the shop admin to re-send your invite or assign you from the Admin Panel → Broker Manager."
      );
      return;
    }

    const payload = {
      ...quoteData,
      status: nextStatus,
      broker_id: user.email,
      broker_email: user.email,
      broker_name: user.display_name || user.full_name || "",
      broker_company: user.company_name || "",
      shop_owner: isSubmittingToShop ? assignedShop : null,
    };

    let saved;

    if (quoteData.id) {
      saved = await base44.entities.Quote.update(quoteData.id, payload);
      setQuotes((prev) => prev.map((q) => (q.id === quoteData.id ? saved : q)));
    } else {
      saved = await base44.entities.Quote.create(payload);
      setQuotes((prev) => [saved, ...prev.filter((q) => q.id !== saved.id)]);
    }

    setSelectedQuote(saved);
    setShowEditor(false);
    setEditorQuote(null);

    // Shop notification fires HERE — on the broker's "Submit to Shop"
    // action (post-client-approval), not on Mark-Client-Approved. Before
    // this point the shop has nothing to do; only now does a quote land
    // in their Pending queue. Best-effort: don't block the broker on a
    // failed notification insert.
    if (isSubmittingToShop && assignedShop) {
      try {
        await base44.entities.BrokerNotification.create({
          shop_owner: assignedShop,
          broker_id: user.email,
          broker_name: user.display_name || user.full_name || "",
          broker_company: user.company_name || "",
          action: "client_approved_quote",
          item_label: `${saved.quote_id} — ${saved.customer_name || "Unknown client"}`,
          item_id: saved.id,
          item_entity: "Quote",
          read: false,
        });
      } catch (err) {
        console.warn("Couldn't create shop notification (non-fatal):", err);
      }
    }
  }

  async function handleSubmitDraft(quote) {
    // Called from the broker drawer's "Submit to Shop" button — gated on
    // Client Approved status. Sets quote.status = "Pending" and the shop
    // becomes able to see the quote in their queue.
    await handleSaveQuote({
      ...quote,
      status: "Pending",
    });
  }

  async function handleDeleteQuote(quote, { isShopVisible = false } = {}) {
    if (!quote?.id) return;
    // Warn more loudly when the shop has already seen it — they'll
    // notice it vanish from their queue with no cross-tenant
    // notification yet. The drawer's `isShopVisible` flag covers
    // Pending + Shop Approved (the two states the shop reviews).
    const msg = isShopVisible
      ? "This quote is in the shop's queue. Deleting will remove it from their view immediately. Continue?"
      : "Delete this quote? This cannot be undone.";
    if (!window.confirm(msg)) return;

    await base44.entities.Quote.delete(quote.id);
    setQuotes((prev) => prev.filter((q) => q.id !== quote.id));
    setSelectedQuote(null);
  }

  async function handleAddClient(clientData) {
    const saved = await base44.entities.Customer.create({
      ...clientData,
      shop_owner: `broker:${user.email}`,
    });

    setClients((prev) => [saved, ...prev].sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: 'base' })));
    return saved;
  }

  async function handleEditClient(clientId, data) {
    const updated = await base44.entities.Customer.update(clientId, data);
    setClients((prev) => prev.map((c) => (c.id === clientId ? updated : c)));
  }

  async function handleDeleteClient(clientId) {
    await base44.entities.Customer.delete(clientId);
    setClients((prev) => prev.filter((c) => c.id !== clientId));
  }

  function openNewQuoteEditor() {
    setSelectedQuote(null);
    setEditorQuote(null);
    setShowEditor(true);
  }

  function openDraftEditor(quote) {
    setSelectedQuote(null);
    setEditorQuote(quote);
    setShowEditor(true);
  }

  function closeEditor() {
    setShowEditor(false);
    setEditorQuote(null);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-slate-400 text-sm">Loading your portal…</div>
      </div>
    );
  }

  if (!user) return null;

  const ACTION_STATUSES = ["Draft", "Pending", "Shop Approved", "Sent to Client", "Client Approved"];

  const statusCounts = { All: quotes.length };
  ["Draft", "Pending", "Shop Approved", "Sent to Client", "Client Approved", "Declined", "Converted to Order"].forEach((s) => {
    statusCounts[s] = quotes.filter((q) => (normalizeQuoteStatus(q.status) === s || q.status === s)).length;
  });

  const filteredQuotes =
    filterStatus === "All"
      ? quotes
      : quotes.filter((q) => normalizeQuoteStatus(q.status) === filterStatus || q.status === filterStatus);

  const actionableQuotes = quotes.filter((q) => ACTION_STATUSES.includes(normalizeQuoteStatus(q.status)));

  // "Needs you" badge on Overview — quotes where SOMETHING JUST HAPPENED
  // and the broker has a next move:
  //   - Client Approved → broker should submit to shop
  //   - Shop Approved   → shop OK'd production, broker should notify client
  // Draft / Sent to Client / Pending intentionally excluded (no broker
  // action available, just waiting).
  const needsAttentionCount = quotes.filter((q) => {
    const s = normalizeQuoteStatus(q.status);
    return s === "Client Approved" || s === "Shop Approved";
  }).length;

  return (
    <BrokerLayout
      user={user}
      tab={tab}
      setTab={setTab}
      badges={{
        // Overview badge = shop-side notifications (approved / declined /
        // order done) since Shop Action Feed lives on Overview.
        overview: shopActionUnreadCount,
        // Quotes badge = quotes in the broker's action queue (Client
        // Approved or Shop Approved) since those rows live on Quotes.
        quotes: needsAttentionCount,
        messages: unreadMessageCount,
      }}
    >
      <div>
        {/* Overview — KPIs + shop-action feed + performance summary.
            The full filterable quotes list moved to its own tab below
            on 2026-05-27 so the broker portal mirrors the shop sidebar
            layout. No state / calc changes — JSX was lifted, not
            rewritten. */}
        {tab === "overview" && (
          <div className="space-y-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Overview</h1>
                <p className="text-slate-500 text-sm mt-0.5">
                  Track your performance and the quotes that still need action.
                </p>
              </div>

              <button
                onClick={openNewQuoteEditor}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition shrink-0"
              >
                <Plus className="w-4 h-4" /> New Quote
              </button>
            </div>

            <ShopActionFeed
              brokerId={user.email}
              onUnreadCountChange={setShopActionUnreadCount}
            />

            {needsAttentionCount > 0 && (
              <button
                onClick={() => navigate(createPageUrl("Quotes"))}
                className="w-full bg-white border border-indigo-200 rounded-2xl px-5 py-4 flex items-center justify-between hover:bg-indigo-50 transition text-left group"
              >
                <div>
                  <div className="text-sm font-semibold text-indigo-700">
                    {needsAttentionCount} quote{needsAttentionCount === 1 ? "" : "s"} waiting on you
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Client Approved or Shop Approved — open Quotes to act on them.
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-indigo-400 group-hover:text-indigo-700 transition" />
              </button>
            )}

            <BrokerPerformanceSelf orders={orders} brokerEmail={user.email} />
          </div>
        )}

        {/* Quotes — full filterable list. Promoted from a section inside
            the old Overview tab to its own page (2026-05-27). All data,
            filters, sorting, and click handlers point at the same state
            as before. */}
        {tab === "quotes" && (
          <div className="space-y-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Quotes</h1>
                <p className="text-slate-500 text-sm mt-0.5">
                  All your quotes. Click any to view details and download Shop or Client forms.
                </p>
              </div>

              <button
                onClick={openNewQuoteEditor}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition shrink-0"
              >
                <Plus className="w-4 h-4" /> New Quote
              </button>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
              <div className="flex gap-2 flex-wrap">
                {["All", "Draft", "Pending", "Shop Approved", "Sent to Client", "Client Approved", "Declined", "Converted to Order"].map((s) => {
                  const active = filterStatus === s;
                  return (
                    <button
                      key={s}
                      onClick={() => setFilterStatus(s)}
                      className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition ${
                        active
                          ? "bg-indigo-600 text-white border-indigo-600"
                          : "bg-white text-slate-600 border-slate-200 hover:border-indigo-300"
                      }`}
                    >
                      {s}{" "}
                      <span className="font-bold opacity-75">({statusCounts[s] || 0})</span>
                    </button>
                  );
                })}
              </div>

              {filteredQuotes.length === 0 ? (
                <div className="bg-slate-50 border border-slate-200 rounded-2xl py-16 text-center">
                  <Clock className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                  <p className="text-slate-400 text-sm font-medium">
                    No quotes found.
                  </p>
                </div>
              ) : (
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden divide-y divide-slate-100">
                  {filteredQuotes
                    .map((q) => {
                      const normalized = normalizeQuoteStatus(q.status);

                      return (
                        <button
                          key={q.id}
                          onClick={() => setSelectedQuote(q)}
                          className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition text-left group"
                        >
                          <div className="flex items-center gap-4 min-w-0">
                            <div
                              className={`w-1.5 h-10 rounded-full shrink-0 ${
                                STATUS_CONFIG[normalized]?.bar || "bg-slate-300"
                              }`}
                            />
                            <div className="min-w-0">
                              <div className="font-semibold text-slate-800 text-sm truncate">
                                {q.customer_name || "—"}
                              </div>
                              <div className="text-xs text-slate-400 mt-0.5">
                                {q.quote_id}
                                {q.due_date && (
                                  <span className="ml-2">
                                    · In-hands: {fmtDate(q.due_date)}
                                  </span>
                                )}
                                {q.rush_rate > 0 && (
                                  <span className="ml-2 text-orange-500 font-semibold">
                                    ⚡ Rush
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 shrink-0 ml-4">
                            <span className="text-xs text-slate-400 hidden sm:block">
                              {fmtDate(q.date)}
                            </span>
                            <span className="text-sm font-semibold text-slate-700 hidden md:block">
                              {fmtMoney(getQuoteTotalSafe(q))}
                            </span>
                            <QuoteStatusBadge status={q.status} />
                            <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition" />
                          </div>
                        </button>
                      );
                    })}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "clients" && (
          <div className="space-y-5">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Clients</h1>
              <p className="text-slate-500 text-sm mt-0.5">
                Your personal client list — separate from the shop&apos;s database.
              </p>
            </div>

            <BrokerClientList
              clients={clients}
              onAdd={handleAddClient}
              onEdit={handleEditClient}
              onDelete={handleDeleteClient}
            />
          </div>
        )}

        {tab === "orders" && (
          <div className="space-y-5">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Orders</h1>
              <p className="text-slate-500 text-sm mt-0.5">
                Track the production status of your submitted orders — read only.
              </p>
            </div>

            {orders.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl py-20 text-center">
                <Package className="w-12 h-12 text-slate-200 mx-auto mb-3" />
                <p className="text-slate-400 text-sm font-medium">
                  No orders yet. Orders appear here once a quote is approved and
                  converted.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {orders.map((order) => {
                  const stepIdx = ORDER_STEPS.indexOf(order.status);
                  const pct =
                    stepIdx >= 0
                      ? Math.round(((stepIdx + 1) / ORDER_STEPS.length) * 100)
                      : 0;
                  const isComplete = order.status === "Completed";

                  return (
                    <div
                      key={order.id}
                      className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-bold text-slate-900">
                            {order.customer_name || "—"}
                          </div>
                          <div className="text-xs text-slate-400 mt-0.5">
                            {order.order_id}
                            {order.due_date && (
                              <span className="ml-2">
                                · Due: {fmtDate(order.due_date)}
                              </span>
                            )}
                          </div>
                        </div>

                        <span
                          className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${
                            isComplete
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-indigo-100 text-indigo-700"
                          }`}
                        >
                          {isComplete ? (
                            <CheckCircle2 className="w-3 h-3" />
                          ) : (
                            <Truck className="w-3 h-3" />
                          )}
                          {order.status}
                        </span>
                      </div>

                      <div>
                        <div className="flex justify-between text-xs text-slate-400 mb-1.5">
                          <span>Production Progress</span>
                          <span>{pct}%</span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              isComplete ? "bg-emerald-500" : "bg-indigo-500"
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>

                      <button
                        onClick={() => setPreviewOrder(order)}
                        className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 border border-indigo-200 px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition w-fit"
                      >
                        <Eye className="w-3.5 h-3.5" /> Preview PDF
                      </button>

                      <div className="flex flex-wrap gap-1.5">
                        {ORDER_STEPS.map((step, i) => {
                          const done = i < stepIdx;
                          const current = i === stepIdx;

                          return (
                            <span
                              key={step}
                              className={`text-xs px-2.5 py-1 rounded-full font-semibold border transition ${
                                current
                                  ? "bg-indigo-600 text-white border-indigo-600"
                                  : done
                                  ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                                  : "bg-slate-50 text-slate-400 border-slate-200"
                              }`}
                            >
                              {done && "✓ "}
                              {step}
                            </span>
                          );
                        })}
                      </div>

                      {(order.line_items || []).length > 0 && (
                        <div className="border-t border-slate-100 pt-3 grid gap-2">
                          {order.line_items.map((li, i) => {
                            const qty = Object.values(li.sizes || {}).reduce(
                              (s, v) => s + (parseInt(v) || 0),
                              0
                            );

                            return (
                              <div
                                key={i}
                                className="flex justify-between text-sm text-slate-600"
                              >
                                <span>
                                  {li.style || "Garment"}{" "}
                                  {li.garmentColor ? `· ${li.garmentColor}` : ""}
                                </span>
                                <span className="font-semibold">Qty: {qty}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === "messages" && user && (
          <div className="space-y-5">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Messages</h1>
              <p className="text-slate-500 text-sm mt-0.5">
                Direct messages with your assigned shop.
              </p>
            </div>

            {(user.assigned_shops || []).length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl py-16 text-center text-slate-400 text-sm">
                You are not assigned to a shop yet. Contact your administrator.
              </div>
            ) : (
              <div className="space-y-4">
                {user.assigned_shops.map((shopEmail) => (
                  <div key={shopEmail}>
                    <div className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">
                      {shopEmail}
                    </div>
                    <BrokerMessaging
                      currentUser={user}
                      otherEmail={shopEmail}
                      otherName={shopEmail}
                      threadId={`${user.email}:${shopEmail}`}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Paperwork + Job Files were removed — both flows now happen inside
            Messages as attachments. If a broker has bookmarked one of those
            tab URLs, the layout still parses the tab param but no handler
            renders, so the page goes blank gracefully (Messages is the
            sibling that replaced them). */}

        {tab === "performance" && user && (
          <BrokerPerformance orders={orders} />
        )}

        {tab === "invoices" && user && (
          <BrokerInvoicesTab
            orders={orders}
            quotes={quotes}
            brokerEmail={user.email}
            broker={user}
            shop={shop}
          />
        )}

        {tab === "profile" && user && (
          <BrokerProfile
            user={user}
            onUpdate={(updated) => setUser((u) => ({ ...u, ...updated }))}
          />
        )}
      {showEditor && (
        <BrokerQuoteEditor
          quote={editorQuote}
          customers={clients}
          onSave={handleSaveQuote}
          onClose={closeEditor}
          onAddCustomer={handleAddClient}
          shopAddons={shopAddons}
          shop={shop}
          broker={user}
        />
      )}

      {previewOrder && (
        <BrokerOrderPDFModal
          order={previewOrder}
          onClose={() => setPreviewOrder(null)}
        />
      )}

      {selectedQuote && (
        <QuoteDetailDrawer
          quote={quotes.find((q) => q.id === selectedQuote.id) || selectedQuote}
          onClose={() => setSelectedQuote(null)}
          onEdit={openDraftEditor}
          onSubmit={handleSubmitDraft}
          onDelete={handleDeleteQuote}
          onUpdate={(updated) => {
            setQuotes((prev) => prev.map((q) => (q.id === updated.id ? updated : q)));
            setSelectedQuote(updated);
          }}
          shop={shop}
          user={user}
        />
      )}
    </div>
    </BrokerLayout>
  );
}

// Bound to BROKER/STANDARD markup so callers don't have to pass the
// calc fn at every call site. Logic lives in lib/broker/quoteTotals
// and is covered by unit tests there.
function getQuoteTotalSafe(quote) {
  return getQuoteTotalSafeLib(quote, (q) => calcQuoteTotals(q, BROKER_MARKUP));
}

function getClientTotalSafe(quote) {
  return getClientTotalSafeLib(quote, (q) => calcQuoteTotals(q, STANDARD_MARKUP));
}