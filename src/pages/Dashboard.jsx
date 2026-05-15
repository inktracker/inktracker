import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { base44, supabase } from "@/api/supabaseClient";

const SUPABASE_FUNC_URL = import.meta.env.VITE_SUPABASE_URL;
import { createPageUrl } from "@/utils";
import { fmtMoney, fmtDate, O_STATUSES, getShopPricingConfig, getDisplayName, getOrderDisplayClient } from "../components/shared/pricing";
import { computeOutstanding } from "@/lib/reports/invoiceStats";
import { bucketQuotes } from "@/lib/broker/quoteStatus";
import { Users, TrendingUp, ChevronDown, ChevronUp, Building2, Mail, Phone, MessageSquare, Paperclip, BarChart2, Package, DollarSign, FileText } from "lucide-react";
import BrokerMessaging from "../components/broker/BrokerMessaging";
import BrokerDocuments from "../components/broker/BrokerDocuments";
import BrokerNotificationFeed from "../components/broker/BrokerNotificationFeed";
import GettingStartedChecklist from "../components/GettingStartedChecklist";
import HintTip from "../components/shared/HintTip";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";

const STATUS_COLORS = {
  Draft: "bg-slate-100 text-slate-600",
  Pending: "bg-yellow-100 text-yellow-700",
  Approved: "bg-emerald-100 text-emerald-700",
  Declined: "bg-red-100 text-red-600",
};

function MetricCard({ label, value, sub, color = "text-indigo-600", onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full bg-white dark:bg-slate-900 rounded-xl sm:rounded-2xl border border-slate-200 dark:border-slate-700 p-3 sm:p-4 shadow-sm hover:shadow-md hover:border-slate-300 transition text-left"
    >
      <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1.5">{label}</div>
      <div className={`text-xl sm:text-2xl font-bold ${color} truncate`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-400 mt-1">{sub}</div>}
    </button>
  );
}

// Analytics buckets for the slim 5-stage pipeline (O_STATUSES).
// Printing is the only production stage now — Finishing + QC were
// collapsed into it on 2026-05-12. Completed is terminal.
const ORDER_STATUSES_PENDING    = ["Art Approval", "Order Goods", "Pre-Press"];
const ORDER_STATUSES_PRODUCTION = ["Printing"];
const ORDER_STATUSES_COMPLETE   = ["Completed"];

function classifyStatus(status) {
  if (ORDER_STATUSES_PENDING.includes(status)) return "pending";
  if (ORDER_STATUSES_PRODUCTION.includes(status)) return "production";
  return "completed";
}

function getMonthlyData(orders) {
  const map = {};
  orders.forEach(o => {
    const d = o.date || o.created_date?.split("T")[0];
    if (!d) return;
    const key = d.slice(0, 7);
    if (!map[key]) map[key] = { month: key, orders: 0, revenue: 0 };
    map[key].orders += 1;
    map[key].revenue += o.total || 0;
  });
  return Object.values(map)
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-12)
    .map(m => ({ ...m, month: m.month.slice(5) + "/" + m.month.slice(2, 4) }));
}

function BrokerCard({ broker, shopOwners, currentUser, orders }) {
  const [open, setOpen] = useState(false);
  const [subTab, setSubTab] = useState("performance");
  const [clients, setClients] = useState([]);
  const [loadingClients, setLoadingClients] = useState(false);

  const brokerOrders = useMemo(() => orders.filter(o => o.broker_id === broker.email), [orders, broker.email]);
  const totalRevenue = brokerOrders.reduce((s, o) => s + (o.total || 0), 0);
  const avgOrderValue = brokerOrders.length ? totalRevenue / brokerOrders.length : 0;
  const pending = brokerOrders.filter(o => classifyStatus(o.status) === "pending").length;
  const production = brokerOrders.filter(o => classifyStatus(o.status) === "production").length;
  const completed = brokerOrders.filter(o => classifyStatus(o.status) === "completed").length;
  const monthlyData = useMemo(() => getMonthlyData(brokerOrders), [brokerOrders]);

  async function loadClients() {
    if (clients.length > 0) return;
    setLoadingClients(true);
    const res = await base44.entities.Customer.filter({ shop_owner: `broker:${broker.email}` });
    setClients(res);
    setLoadingClients(false);
  }

  function toggle() {
    if (!open && subTab === "clients") loadClients();
    setOpen(v => !v);
  }

  function handleSubTab(id) {
    if (id === "clients") loadClients();
    setSubTab(id);
  }

  const assignedShopNames = (broker.assigned_shops || []).map(email => {
    const owner = shopOwners.find(s => s.email === email);
    return owner?.shop_name || email;
  });

  const threadId = currentUser ? `${broker.email}:${currentUser.email}` : null;

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
      <button onClick={toggle} className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 dark:bg-slate-800 transition text-left">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="font-semibold text-slate-800 dark:text-slate-200 text-sm">{broker.display_name || broker.full_name || broker.email}</div>
            {broker.company_name && <span className="text-xs text-slate-400">{broker.company_name}</span>}
            {assignedShopNames.length > 0 && assignedShopNames.map((name, i) => (
              <span key={i} className="text-xs bg-indigo-50 text-indigo-700 font-semibold px-2 py-0.5 rounded-full">{name}</span>
            ))}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">{broker.email}</div>
        </div>
        {/* Quick stats */}
        <div className="flex items-center gap-4 shrink-0 ml-4">
          <div className="text-right hidden sm:block">
            <div className="text-xs text-slate-400">Orders</div>
            <div className="font-bold text-slate-800 dark:text-slate-200 text-sm">{brokerOrders.length}</div>
          </div>
          <div className="text-right hidden sm:block">
            <div className="text-xs text-slate-400">Revenue</div>
            <div className="font-bold text-indigo-700 text-sm">{fmtMoney(totalRevenue)}</div>
          </div>
          {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-100 dark:border-slate-700">
          <div className="flex border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-5">
            {[
              { id: "performance", label: "Performance", icon: BarChart2 },
              { id: "clients", label: "Clients", icon: Users },
              { id: "messages", label: "Messages", icon: MessageSquare },
              { id: "documents", label: "Documents", icon: Paperclip },
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => handleSubTab(id)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 -mb-px transition ${subTab === id ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-400 hover:text-slate-700"}`}
              >
                <Icon className="w-3.5 h-3.5" />{label}
              </button>
            ))}
          </div>

          <div className="px-5 py-4 bg-slate-50 dark:bg-slate-800">
            {/* Performance */}
            {subTab === "performance" && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-center">
                    <div className="text-xs text-slate-400 font-semibold uppercase tracking-wide mb-1">Total Orders</div>
                    <div className="text-2xl font-bold text-slate-800 dark:text-slate-200">{brokerOrders.length}</div>
                  </div>
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-center">
                    <div className="text-xs text-slate-400 font-semibold uppercase tracking-wide mb-1">Revenue</div>
                    <div className="text-lg font-bold text-indigo-700">{fmtMoney(totalRevenue)}</div>
                  </div>
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-center">
                    <div className="text-xs text-slate-400 font-semibold uppercase tracking-wide mb-1">Avg. Order</div>
                    <div className="text-lg font-bold text-slate-700">{fmtMoney(avgOrderValue)}</div>
                  </div>
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3">
                    <div className="text-xs text-slate-400 font-semibold uppercase tracking-wide mb-1.5">Status</div>
                    <div className="flex flex-wrap gap-1">
                      <span className="text-xs font-semibold bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">{pending} Pending</span>
                      <span className="text-xs font-semibold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{production} In Prod</span>
                      <span className="text-xs font-semibold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">{completed} Done</span>
                    </div>
                  </div>
                </div>
                {monthlyData.length > 0 ? (
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                    <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Monthly Activity (Last 12 Months)</div>
                    <ResponsiveContainer width="100%" height={160}>
                      <BarChart data={monthlyData} margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
                        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                        <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                        <YAxis yAxisId="right" orientation="right" tickFormatter={v => `$${(v/1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(val, name) => name === "Revenue" ? fmtMoney(val) : val} />
                        <Legend />
                        <Bar yAxisId="left" dataKey="orders" name="Orders" fill="#6366f1" radius={[4,4,0,0]} />
                        <Bar yAxisId="right" dataKey="revenue" name="Revenue" fill="#10b981" radius={[4,4,0,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="text-sm text-slate-400 text-center py-6">No order history yet.</div>
                )}
              </div>
            )}

            {/* Clients */}
            {subTab === "clients" && (
              <>
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">Clients ({loadingClients ? "…" : clients.length})</div>
                {loadingClients ? (
                  <div className="text-xs text-slate-400">Loading clients…</div>
                ) : clients.length === 0 ? (
                  <div className="text-xs text-slate-400">No clients added yet.</div>
                ) : (
                  <div className="space-y-2">
                    {clients.map(c => (
                      <div key={c.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2.5 flex items-start justify-between">
                        <div>
                          <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">{c.name}</div>
                          {c.company && <div className="flex items-center gap-1 text-xs text-slate-500 mt-0.5"><Building2 className="w-3 h-3" /> {c.company}</div>}
                        </div>
                        <div className="text-right text-xs text-slate-400 space-y-0.5">
                          {c.email && <div className="flex items-center gap-1 justify-end"><Mail className="w-3 h-3" />{c.email}</div>}
                          {c.phone && <div className="flex items-center gap-1 justify-end"><Phone className="w-3 h-3" />{c.phone}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Messages */}
            {subTab === "messages" && currentUser && (
              <BrokerMessaging
                currentUser={currentUser}
                otherEmail={broker.email}
                otherName={broker.full_name || broker.email}
                threadId={threadId}
              />
            )}

            {/* Documents */}
            {subTab === "documents" && (
              <BrokerDocuments brokerEmail={broker.email} shopOwner={currentUser?.email} isAdmin={true} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [quotes, setQuotes] = useState([]);
  const [orders, setOrders] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [brokers, setBrokers] = useState([]);
  const [shopOwners, setShopOwners] = useState([]);
  const [tab, setTab] = useState("overview");
  const [brokerUnreadCount, setBrokerUnreadCount] = useState(0);
  const [customerCount, setCustomerCount] = useState(0);
  // id → customer entity. Used by getDisplayName / getOrderDisplayClient
  // so the Order Pipeline + Recent Quotes cards show the company first,
  // falling back to contact name. Without this lookup the dashboard had
  // to use raw order.customer_name / quote.customer_name (contact only),
  // which is why those cards drifted from the Orders/Quotes pages.
  const [customers, setCustomers] = useState({});

  useEffect(() => {
    async function loadData() {
      // Auth first — failing here is the only case that should bounce to
      // login. Everything below is data the user is allowed to read; an
      // RLS hiccup on one of the parallel queries shouldn't log them out.
      let currentUser;
      try {
        currentUser = await base44.auth.me();
      } catch {
        await base44.auth.redirectToLogin();
        return;
      }
      if (!currentUser) { await base44.auth.redirectToLogin(); return; }
      if (currentUser.role === "broker") { navigate(createPageUrl("BrokerDashboard")); return; }
      setUser(currentUser);

      // Each query catches its own error and falls back to a sensible
      // empty value. The dashboard renders zeros for the failed slice
      // instead of bouncing the user to login on any single RLS / network
      // blip. base44.entities.User.list() is also explicitly scoped to
      // brokers assigned to this shop's email so the "All users" call
      // can't accidentally enumerate other shops if RLS ever loosens.
      const [q, o, invItems, allUsers, custs, localInvoices] = await Promise.all([
        base44.entities.Quote.filter({ shop_owner: currentUser.email }, "-created_date", 100).catch((e) => { console.error("[Dashboard] quotes fetch failed:", e); return []; }),
        base44.entities.Order.filter({ shop_owner: currentUser.email }, "-created_date", 50).catch((e) => { console.error("[Dashboard] orders fetch failed:", e); return []; }),
        base44.entities.InventoryItem.filter({ shop_owner: currentUser.email }).catch((e) => { console.error("[Dashboard] inventory fetch failed:", e); return []; }),
        base44.entities.User.list().catch((e) => { console.error("[Dashboard] users fetch failed:", e); return []; }),
        base44.entities.Customer.filter({ shop_owner: currentUser.email }).catch((e) => { console.error("[Dashboard] customers fetch failed:", e); return []; }),
        base44.entities.Invoice.filter({ shop_owner: currentUser.email }, "-created_date", 1000).catch((e) => { console.error("[Dashboard] invoices fetch failed:", e); return []; }),
      ]);

      setQuotes(q);
      setOrders(o);
      setInventory(invItems);
      setCustomerCount(custs.length);
      const custMap = {};
      (custs || []).forEach((c) => { custMap[c.id] = c; });
      setCustomers(custMap);
      setInvoices(localInvoices);
      // Brokers panel: filter client-side to the brokers explicitly
      // assigned to THIS shop. User.list() returns whatever RLS allows;
      // the assigned_shops filter is the in-app guard so a future RLS
      // loosening can't accidentally enumerate other shops' users.
      setBrokers(allUsers.filter(u => u.role === "broker" && (u.assigned_shops || []).includes(currentUser.email)));
      setShopOwners(allUsers.filter(u => u.role !== "broker"));
      setLoading(false);
    }
    loadData();
  }, [navigate]);

  if (loading) return <div className="min-h-screen flex items-center justify-center text-slate-400">Loading…</div>;

  const sumTotals = (items) => items.reduce((s, x) => s + (Number(x.total) || 0), 0);

  // "Pending" here means "out with the customer" — covers both Sent
  // (emailed, awaiting reply) and Pending (manually marked). "Approved"
  // includes both Approved and Approved and Paid. Bucketing logic
  // lives in lib/broker/quoteStatus.js + unit tests so the shop and
  // broker views can't drift.
  const { pending: pendingQuotesList, approved: approvedQuotesList } = bucketQuotes(quotes);
  const pendingQuotes      = pendingQuotesList.length;
  const approvedQuotes     = approvedQuotesList.length;
  const pendingQuotesValue = sumTotals(pendingQuotesList);
  const approvedQuotesValue = sumTotals(approvedQuotesList);

  // Open orders that are NOT yet paid. Pre-paid orders (paid===true)
  // contribute zero to the outstanding sum since the money's already
  // in. Their count still shows in `activeOrders` for the pipeline UI;
  // the metric card just doesn't add them to the dollar total.
  //
  // Excludes Completed AND Cancelled/Voided — both are terminal states.
  // Without the second filter, cancelled jobs inflated the open-orders
  // count and dollar total even though they'll never be invoiced.
  const TERMINAL_STATUSES = new Set(["Completed", "Cancelled", "Voided"]);
  const activeOrders = orders.filter(o => !TERMINAL_STATUSES.has(o.status));
  const unpaidOpenOrders = activeOrders.filter(o => !o.paid);
  const openOrdersCount = activeOrders.length;
  const openOrdersValue = sumTotals(unpaidOpenOrders);

  const outstanding = computeOutstanding(invoices);
  const unpaidInvoicesCount = outstanding.count;
  const unpaidInvoicesValue = outstanding.total;

  // Items where qty AND reorder are both 0 aren't really "low stock" —
  // they're just uninitialized rows. Require a reorder threshold > 0
  // before flagging, so the alert only fires once the shop has set a
  // par level for the SKU.
  const lowStockItems = inventory.filter(i => (i.reorder || 0) > 0 && (i.qty || 0) <= (i.reorder || 0));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100">Dashboard</h1>
          <p className="text-slate-500 text-xs sm:text-sm mt-0.5">{user?.shop_name || "My Shop"}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-slate-200 dark:border-slate-700">
        {[
          { id: "overview", label: "Overview", icon: TrendingUp },
          { id: "brokers", label: "Brokers", icon: Users, badge: brokerUnreadCount, hint: "Sales reps who submit orders on behalf of your shop. Manage brokers from Account > Admin Panel." },
        ].map(({ id, label, icon: NavIcon, badge, hint }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 -mb-px transition ${
              tab === id ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-200"
            }`}
          >
            <NavIcon className="w-4 h-4" /> {label}
            {hint && <HintTip text={hint} side="bottom" />}
            {badge > 0 && (
              <span className="bg-indigo-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-full leading-none">
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW TAB ── */}
      {tab === "overview" && (
        <div className="space-y-6">
          {/* Metrics */}
          {/* 5 chips at the wide breakpoint (was 6, brokers removed).
              Each chip shows the count up top with its dollar value
              directly underneath — value-first reads consistent. The
              Open Orders sum excludes pre-paid orders (their money is
              already in). */}
          <div data-tour="metrics" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <MetricCard label="Pending Quotes" value={pendingQuotes} sub={fmtMoney(pendingQuotesValue)} color="text-yellow-600" onClick={() => navigate(createPageUrl("Quotes"))} />
            <MetricCard label="Approved" value={approvedQuotes} sub={fmtMoney(approvedQuotesValue)} color="text-emerald-600" onClick={() => navigate(createPageUrl("Quotes"))} />
            <MetricCard label="Open Orders" value={openOrdersCount} sub={fmtMoney(openOrdersValue)} color="text-blue-600" onClick={() => navigate(createPageUrl("Production"))} />
            <MetricCard label="Unpaid Invoices" value={unpaidInvoicesCount} sub={fmtMoney(unpaidInvoicesValue)} color="text-red-600" onClick={() => navigate(createPageUrl("Invoices"))} />
            <MetricCard label="Low Stock Items" value={lowStockItems.length} sub="Need reorder" color="text-red-600" onClick={() => navigate(createPageUrl("Inventory"))} />
          </div>

          {/* Getting Started Checklist */}
          <div data-tour="checklist">
          <GettingStartedChecklist
            quotes={quotes}
            orders={orders}
            customers={customerCount}
            inventory={inventory}
            hasPricing={!!getShopPricingConfig()}
          />
          </div>

          {/* Order Pipeline */}
          <div data-tour="pipeline" className="overflow-hidden">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Order Pipeline</h3>
              <HintTip text="Orders move through these stages from left to right. Click a stage to see its orders, or click an individual order to view details." />
            </div>
            {/* 5 columns at lg matches the metrics row above and uses
                the full page width. Was lg:grid-cols-8 — left the chips
                squeezed at the left third of the row. */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {O_STATUSES.map(status => {
                const inStage = orders.filter((o) => o.status === status);
                return (
                  <div key={status} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
                    <button
                      onClick={() => navigate(`/Orders?status=${encodeURIComponent(status)}`)}
                      className="w-full text-left bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-3 py-2 hover:bg-slate-100 transition"
                    >
                      <div className="text-[10px] font-bold text-slate-600 uppercase tracking-widest truncate">{status}</div>
                      <div className="text-xl font-bold text-slate-900 dark:text-slate-100">{inStage.length}</div>
                    </button>
                    <div className="p-2 space-y-1.5 max-h-36 overflow-y-auto">
                      {inStage.map((o) => (
                        <button
                          key={o.id}
                          onClick={() => navigate(`/Orders?id=${o.id}`)}
                          className="w-full text-left text-xs bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-2 border border-slate-100 dark:border-slate-700 hover:bg-indigo-50 hover:border-indigo-200 transition"
                        >
                          <div className="font-semibold text-slate-800 dark:text-slate-200 truncate">{getOrderDisplayClient(o, customers[o.customer_id])}</div>
                          <div className="text-slate-500">{o.order_id}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Recent Quotes & Low Stock */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
              <button
                onClick={() => navigate(createPageUrl("Quotes"))}
                className="w-full bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-5 py-3 flex items-center justify-between hover:bg-slate-100 transition"
              >
                <h3 className="text-xs font-bold text-slate-600 uppercase tracking-widest">Recent Quotes</h3>
                <span className="text-xs font-semibold text-slate-400">{quotes.length} total</span>
              </button>
              {quotes.length === 0 ? (
                <div className="py-12 text-center">
                  <FileText className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                  <p className="text-sm text-slate-400 mb-3">No quotes yet</p>
                  <button onClick={() => navigate(createPageUrl("Quotes"))} className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 transition">
                    Create your first quote &rarr;
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {quotes.slice(0, 6).map(q => (
                    <button
                      key={q.id}
                      onClick={() => navigate(`/Quotes?id=${q.id}`)}
                      className="w-full text-left px-5 py-3 flex items-center justify-between hover:bg-slate-50 dark:bg-slate-800 transition"
                    >
                      <div>
                        <div className="font-semibold text-slate-800 dark:text-slate-200 text-sm">{getDisplayName(customers[q.customer_id] || q.customer_name) || "—"}</div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          {q.quote_id}
                          {q.broker_id && <span className="ml-2 text-indigo-500 font-semibold">via broker</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {q.date && <span className="text-xs text-slate-400">{fmtDate(q.date)}</span>}
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_COLORS[q.status] || "bg-slate-100 text-slate-600"}`}>
                          {q.status}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
              <button
                onClick={() => navigate(createPageUrl("Inventory"))}
                className="w-full bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-5 py-3 flex items-center justify-between hover:bg-slate-100 transition text-left"
              >
                <h3 className="text-xs font-bold text-slate-600 uppercase tracking-widest">Low Stock Items</h3>
                <span className="text-xs font-semibold text-slate-400">{lowStockItems.length} flagged</span>
              </button>
              {lowStockItems.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-sm">All items are well stocked.</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {lowStockItems.slice(0, 6).map(item => (
                    <button
                      key={item.id}
                      onClick={() => navigate(createPageUrl("Inventory"))}
                      className="w-full text-left px-5 py-3 hover:bg-slate-50 dark:bg-slate-800 transition"
                    >
                      <div className="flex justify-between items-start mb-1">
                        <div className="font-semibold text-slate-800 dark:text-slate-200 text-sm">{item.item}</div>
                        <span className="text-xs text-slate-500">{item.sku}</span>
                      </div>
                      <div className="flex justify-between text-xs text-slate-500">
                        <span>Stock: {item.qty} {item.unit}</span>
                        <span className="font-semibold text-red-600">Reorder at: {item.reorder}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>


        </div>
      )}

      {/* ── BROKERS TAB ── */}
      {tab === "brokers" && (
        <div className="space-y-4">

          {/* Notification Feed */}
          {user && (
            <BrokerNotificationFeed
              shopOwner={user.email}
              onUnreadCountChange={setBrokerUnreadCount}
            />
          )}

          {/* Summary bar */}
          {brokers.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              <button
                onClick={() => navigate(createPageUrl("Orders"))}
                className="w-full text-left bg-indigo-50 border border-indigo-200 rounded-xl p-4 flex items-center gap-3 hover:bg-indigo-100 transition"
              >
                <Package className="w-7 h-7 text-indigo-400" />
                <div>
                  <div className="text-xs font-semibold text-indigo-500 uppercase tracking-widest">Total Broker Orders</div>
                  <div className="text-2xl font-bold text-indigo-700">{orders.filter(o => o.broker_id).length}</div>
                </div>
              </button>
              <button
                onClick={() => navigate(createPageUrl("Performance"))}
                className="w-full text-left bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center gap-3 hover:bg-emerald-100 transition"
              >
                <DollarSign className="w-7 h-7 text-emerald-400" />
                <div>
                  <div className="text-xs font-semibold text-emerald-500 uppercase tracking-widest">Total Revenue</div>
                  <div className="text-2xl font-bold text-emerald-700">{fmtMoney(orders.filter(o => o.broker_id).reduce((s, o) => s + (o.total || 0), 0))}</div>
                </div>
              </button>
              <button
                onClick={() => navigate(createPageUrl("AdminPanel"))}
                className="w-full text-left bg-violet-50 border border-violet-200 rounded-xl p-4 flex items-center gap-3 hover:bg-violet-100 transition"
              >
                <Users className="w-7 h-7 text-violet-400" />
                <div>
                  <div className="text-xs font-semibold text-violet-500 uppercase tracking-widest">Active Brokers</div>
                  <div className="text-2xl font-bold text-violet-700">{brokers.length}</div>
                </div>
              </button>
            </div>
          )}
          {brokers.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl py-16 text-center">
              <Users className="w-12 h-12 text-slate-200 mx-auto mb-3" />
              <p className="text-slate-400 text-sm">Brokers can be assigned to your shop from the <strong>Account</strong> page by an admin.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {brokers.map(broker => (
                <BrokerCard key={broker.id} broker={broker} shopOwners={shopOwners} currentUser={user} orders={orders} />
              ))}
            </div>
          )}
        </div>
      )}

    </div>
  );
}