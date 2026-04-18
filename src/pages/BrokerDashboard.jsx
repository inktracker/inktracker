import { useState, useEffect } from "react";
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
import BrokerMessaging from "../components/broker/BrokerMessaging";
import BrokerDocuments from "../components/broker/BrokerDocuments";
import BrokerPerformanceSelf from "../components/broker/BrokerPerformanceSelf";
import BrokerFilesTab from "../components/broker/BrokerFilesTab";
import BrokerInvoicesTab from "../components/broker/BrokerInvoicesTab";
import { exportQuoteToPDF } from "../components/shared/pdfExport";
import { STANDARD_MARKUP } from "../components/shared/pricing";
import SendQuoteModal from "../components/quotes/SendQuoteModal";

const ORDER_STEPS = [
  "Art Approval",
  "Pre-Press",
  "Printing",
  "Finishing",
  "QC",
  "Ready for Pickup",
  "Completed",
];

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

function normalizeStatus(status) {
  if (status === "Approved and Paid") return "Shop Approved";
  if (status === "Approved") return "Shop Approved";
  if (status === "Sent") return "Pending";
  return status || "Draft";
}

function QuoteStatusBadge({ status }) {
  const normalized = normalizeStatus(status);
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
  const brokerTotals = calcQuoteTotals(quote, BROKER_MARKUP);
  const clientTotals = calcQuoteTotals(quote, STANDARD_MARKUP);
  const normalizedStatus = normalizeStatus(quote.status);
  const canSubmit = normalizedStatus === "Draft";
  const canDelete = normalizedStatus === "Draft";
  const [actionLoading, setActionLoading] = useState(null);
  const [showPaymentPicker, setShowPaymentPicker] = useState(false);
  const [showSendModal, setShowSendModal] = useState(false);

  const shopApproved = quote.status === "Shop Approved" || quote.status === "Approved" || quote.status === "Approved and Paid";
  const sentToClient = quote.status === "Sent to Client";
  const canSendToClient = shopApproved || sentToClient;
  const canMarkClientApproved = shopApproved || sentToClient;
  const canMarkClientResponse = sentToClient;
  const canRecordPayment = quote.status === "Client Approved";
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
    await doUpdate({
      status: "Client Approved",
      client_status: "Approved",
      client_approved_at: new Date().toISOString(),
      payment_status: quote.payment_status || "Unpaid",
    }, "clientApproved");
    // Notify shop to convert quote to order
    if (quote.shop_owner) {
      await base44.entities.BrokerNotification.create({
        shop_owner: quote.shop_owner,
        broker_id: quote.broker_id || quote.broker_email || "",
        broker_name: quote.broker_name || "",
        broker_company: quote.broker_company || "",
        action: "client_approved_quote",
        item_label: `${quote.quote_id} — ${quote.customer_name}`,
        item_id: quote.id,
        item_entity: "Quote",
        read: false,
      });
    }
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
    <div
      className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex justify-end"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-lg h-full overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
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

          {/* Status banners */}
          {normalizedStatus === "Draft" && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-700">
              <span className="font-semibold">Saved as draft.</span> Submit to shop when ready.
            </div>
          )}
          {normalizedStatus === "Pending" && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 text-sm text-yellow-800">
              <span className="font-semibold">Awaiting shop review.</span> You'll see this updated once the shop responds.
            </div>
          )}
          {canMarkClientApproved && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm text-emerald-800">
              <span className="font-semibold">Shop approved!</span> Mark as client approved when your client confirms.
            </div>
          )}
          {quote.status === "Sent to Client" && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-800">
              <span className="font-semibold">Sent to client.</span> Waiting for client response.
              {quote.sent_to_client_at && <div className="text-xs mt-1 text-blue-600">Sent: {new Date(quote.sent_to_client_at).toLocaleDateString()}</div>}
            </div>
          )}
          {quote.status === "Client Approved" && (
            <div className="bg-teal-50 border border-teal-200 rounded-xl px-4 py-3 text-sm text-teal-800">
              <span className="font-semibold">Client approved!</span> The shop will be notified to convert this into a production order.
              {quote.payment_status && quote.payment_status !== "Unpaid" && (
                <div className="text-xs mt-1 font-semibold text-teal-600">Payment: {quote.payment_status}</div>
              )}
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
            {parseFloat(quote.discount) > 0 && (
              <div className="flex justify-between text-sm text-emerald-600">
                <span>Discount ({quote.discount}%)</span>
                <span>−{fmtMoney(brokerTotals.sub - brokerTotals.afterDisc)}</span>
              </div>
            )}
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
                  alert("Could not generate the Shop Order Form PDF: " + (err?.message || err));
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
                  alert("Could not generate the Client Quote PDF: " + (err?.message || err));
                }
              }}
              className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-semibold border border-slate-200 text-slate-600 py-2 rounded-xl hover:bg-slate-100 transition"
            >
              <Download className="w-3.5 h-3.5" /> Client Quote
            </button>
          </div>

          {/* Draft actions */}
          {canSubmit && (
            <div className="flex gap-2">
              <button
                onClick={() => onEdit(quote)}
                className="flex-1 inline-flex items-center justify-center gap-2 border border-slate-200 text-slate-700 text-sm font-semibold py-2.5 rounded-xl hover:bg-slate-100 transition"
              >
                <Pencil className="w-4 h-4" /> Edit Draft
              </button>
              <button
                onClick={() => onSubmit(quote)}
                className="flex-1 inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold py-2.5 rounded-xl transition"
              >
                <Send className="w-4 h-4" /> Submit to Shop
              </button>
            </div>
          )}

          {/* Send to Client */}
          {canSendToClient && (
            <button
              onClick={handleSendToClient}
              className="w-full inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold py-2.5 rounded-xl transition"
            >
              <Send className="w-4 h-4" />
              {sentToClient ? "Resend to Client" : "Send to Client"}
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
                onClick={() => onDelete(quote)}
                className="inline-flex items-center justify-center gap-2 border border-red-200 text-red-600 text-sm font-semibold py-2 px-4 rounded-xl hover:bg-red-50 transition"
              >
                <Trash2 className="w-4 h-4" /> Delete Draft
              </button>
            )}
          </div>
        </div>
      </div>
    </div>

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

export default function BrokerDashboard() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("quotes");
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
        const [allQuotes, myClients, myOrders, shopResults] = await Promise.all([
          base44.entities.Quote.list("-created_date", 200),
          base44.entities.Customer.filter({ shop_owner: `broker:${u.email}` }),
          base44.entities.Order.filter({ broker_id: u.email }, "-created_date", 100),
          assignedShop ? base44.entities.Shop.filter({ owner_email: assignedShop }) : Promise.resolve([]),
        ]);
        const shopRecord = (shopResults || [])[0] || null;
        setShop(shopRecord);
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
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

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
      alert(
        "Your account isn't linked to a shop yet. Ask the shop admin to re-send your invite or assign you from the Admin Panel → Broker Manager."
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
  }

  async function handleSubmitDraft(quote) {
    await handleSaveQuote({
      ...quote,
      status: "Pending",
    });
  }

  async function handleDeleteDraft(quote) {
    if (!quote?.id) return;
    if (!window.confirm("Delete this draft? This cannot be undone.")) return;

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
    statusCounts[s] = quotes.filter((q) => (normalizeStatus(q.status) === s || q.status === s)).length;
  });

  const filteredQuotes =
    filterStatus === "All"
      ? quotes
      : quotes.filter((q) => normalizeStatus(q.status) === filterStatus || q.status === filterStatus);

  const actionableQuotes = quotes.filter((q) => ACTION_STATUSES.includes(normalizeStatus(q.status)));

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 md:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/69aa650fd3e825e66ff81817/b4e2dc53f_logo.png"
              alt="InkTracker"
              className="w-8 h-8 object-contain"
            />
            <div>
              <div className="text-base font-bold text-slate-900">Broker Portal</div>
              <div className="text-xs text-slate-400">
                {user.display_name || user.full_name}
                {user.company_name ? ` · ${user.company_name}` : ""}
              </div>
            </div>
          </div>

          <button
            onClick={() => base44.auth.logout("/")}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-red-500 font-semibold transition px-3 py-2 rounded-lg hover:bg-red-50"
          >
            <LogOut className="w-4 h-4" /> Sign Out
          </button>
        </div>

        <div className="max-w-5xl mx-auto border-t border-slate-100">
          <div
            className="flex overflow-x-auto md:hidden"
            style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          >
            {[
              { id: "quotes", label: "Overview", icon: BarChart2 },
              { id: "clients", label: "Clients", icon: Users },
              { id: "orders", label: "Orders", icon: Package },
              { id: "performance", label: "Performance", icon: TrendingUp },
              { id: "messages", label: "Messages", icon: MessageSquare },
              { id: "documents", label: "Documents", icon: Paperclip },
              { id: "jobfiles", label: "Files", icon: FolderOpen },
              { id: "invoices", label: "Invoices", icon: FileText },
              { id: "profile", label: "Profile", icon: UserCircle },
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex items-center gap-1.5 px-4 py-3 text-sm font-semibold border-b-2 -mb-px transition whitespace-nowrap shrink-0 ${
                  tab === id
                    ? "border-indigo-600 text-indigo-700"
                    : "border-transparent text-slate-500"
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>

          <div className="hidden md:flex px-8">
            {[
              { id: "quotes", label: "Overview", icon: BarChart2 },
              { id: "clients", label: "Clients", icon: Users },
              { id: "orders", label: "Orders", icon: Package },
              { id: "performance", label: "Performance", icon: TrendingUp },
              { id: "messages", label: "Messages", icon: MessageSquare },
              { id: "documents", label: "Documents", icon: Paperclip },
              { id: "jobfiles", label: "Files", icon: FolderOpen },
              { id: "invoices", label: "Invoices", icon: FileText },
              { id: "profile", label: "Profile", icon: UserCircle },
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 -mb-px transition ${
                  tab === id
                    ? "border-indigo-600 text-indigo-700"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 md:px-8 py-8">
        {tab === "quotes" && (
          <div className="space-y-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Overview</h1>
                <p className="text-slate-500 text-sm mt-0.5">
                  Track your performance and manage the quotes that still need action.
                </p>
              </div>

              <button
                onClick={openNewQuoteEditor}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition shrink-0"
              >
                <Plus className="w-4 h-4" /> New Quote
              </button>
            </div>

            <BrokerPerformanceSelf orders={orders} brokerEmail={user.email} />

            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">All Quotes</h2>
                  <p className="text-slate-500 text-sm mt-0.5">
                    Click any quote to view details and download Shop or Client forms.
                  </p>
                </div>
              </div>

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
                      const normalized = normalizeStatus(q.status);

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

        {tab === "documents" && user && (
          <div className="space-y-5">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Documents</h1>
              <p className="text-slate-500 text-sm mt-0.5">
                Upload and share files with your assigned shop.
              </p>
            </div>

            <BrokerDocuments
              brokerEmail={user.email}
              shopOwner={(user.assigned_shops || [])[0] || ""}
              isAdmin={false}
            />
          </div>
        )}

        {tab === "jobfiles" && user && (
          <BrokerFilesTab brokerEmail={user.email} orders={orders} />
        )}

        {tab === "performance" && user && (
          <BrokerPerformance orders={orders} />
        )}

        {tab === "invoices" && user && (
          <BrokerInvoicesTab
            orders={orders}
            quotes={quotes}
            brokerEmail={user.email}
          />
        )}

        {tab === "profile" && user && (
          <BrokerProfile
            user={user}
            onUpdate={(updated) => setUser((u) => ({ ...u, ...updated }))}
          />
        )}
      </main>

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
          onDelete={handleDeleteDraft}
          onUpdate={(updated) => {
            setQuotes((prev) => prev.map((q) => (q.id === updated.id ? updated : q)));
            setSelectedQuote(updated);
          }}
          shop={shop}
          user={user}
        />
      )}
    </div>
  );
}

function getQuoteTotalSafe(quote) {
  try {
    const totals = calcQuoteTotals(quote || {}, BROKER_MARKUP);
    return Number(totals?.total || 0);
  } catch {
    return 0;
  }
}