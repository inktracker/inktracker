import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { base44, supabase } from "@/api/supabaseClient";

const SUPABASE_FUNC_URL = import.meta.env.VITE_SUPABASE_URL;
import { createPageUrl } from "@/utils";
import { fmtMoney, fmtDate, O_STATUSES } from "../components/shared/pricing";
import { Users, TrendingUp, ChevronDown, ChevronUp, Building2, Mail, Phone, MessageSquare, Paperclip, BarChart2, Package, DollarSign } from "lucide-react";
import BrokerMessaging from "../components/broker/BrokerMessaging";
import BrokerDocuments from "../components/broker/BrokerDocuments";
import BrokerNotificationFeed from "../components/broker/BrokerNotificationFeed";
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
      className="w-full bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 shadow-sm hover:shadow-md hover:border-slate-300 transition text-left min-w-0"
    >
      <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1.5">{label}</div>
      <div className={`text-xl sm:text-2xl font-bold ${color} truncate`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-400 mt-1">{sub}</div>}
    </button>
  );
}

const ORDER_STATUSES_PENDING = ["Art Approval", "Order Goods", "Pre-Press"];
const ORDER_STATUSES_PRODUCTION = ["Printing", "Finishing", "QC"];
const ORDER_STATUSES_COMPLETE = ["Ready for Pickup", "Completed"];

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

  useEffect(() => {
    async function loadData() {
      try {
        const currentUser = await base44.auth.me();
        if (!currentUser) { await base44.auth.redirectToLogin(); return; }
        if (currentUser.role === "broker") { navigate(createPageUrl("BrokerDashboard")); return; }
        setUser(currentUser);

        const [q, o, invItems, allUsers] = await Promise.all([
          base44.entities.Quote.filter({ shop_owner: currentUser.email }, "-created_date", 100),
          base44.entities.Order.filter({ shop_owner: currentUser.email }, "-created_date", 50),
          base44.entities.InventoryItem.filter({ shop_owner: currentUser.email }),
          base44.entities.User.list(),
        ]);

        setQuotes(q);
        setOrders(o);
        setInventory(invItems);

        // Fetch live invoice data from QB (non-blocking)
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.access_token) {
            const res = await fetch(`${SUPABASE_FUNC_URL}/functions/v1/qbSync`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "getPerformanceData", accessToken: session.access_token }),
            });
            if (res.ok) {
              const data = await res.json();
              setInvoices(data.revenue || []);
            }
          }
        } catch (err) {
          console.warn("[Dashboard] QB data failed:", err?.message);
        }
        setBrokers(allUsers.filter(u => u.role === "broker" && (u.assigned_shops || []).includes(currentUser.email)));
        setShopOwners(allUsers.filter(u => u.role !== "broker"));
        setLoading(false);
      } catch (error) {
        await base44.auth.redirectToLogin();
      }
    }
    loadData();
  }, [navigate]);

  if (loading) return <div className="min-h-screen flex items-center justify-center text-slate-400">Loading…</div>;

  const pendingQuotes = quotes.filter(q => q.status === "Pending").length;
  const approvedQuotes = quotes.filter(q => q.status === "Approved").length;
  const brokerQuotes = quotes.filter(q => q.broker_id).length;
  const activeOrders = orders.filter(o => !["Ready for Pickup", "Completed"].includes(o.status)).length;
  const openOrdersCount = orders.filter(o => o.status !== "Completed").length;
  const openOrdersValue = orders.filter(o => o.status !== "Completed").reduce((sum, o) => sum + (o.total || 0), 0);
  const unpaidInvoices = invoices.reduce((sum, i) => sum + (i.balance || 0), 0);
  const lowStockItems = inventory.filter(i => (i.qty || 0) <= (i.reorder || 0));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">Dashboard</h1>
          <p className="text-slate-500 text-sm mt-1">{user?.shop_name || "My Shop"} · Overview & broker management</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-slate-200 dark:border-slate-700">
        {[
          { id: "overview", label: "Overview", icon: TrendingUp },
          { id: "brokers", label: "Brokers", icon: Users, badge: brokerUnreadCount },
        ].map(({ id, label, icon: NavIcon, badge }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 -mb-px transition ${
              tab === id ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-200"
            }`}
          >
            <NavIcon className="w-4 h-4" /> {label}
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
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
            <MetricCard label="Pending Quotes" value={pendingQuotes} sub="Awaiting approval" color="text-yellow-600" onClick={() => navigate(createPageUrl("Quotes"))} />
            <MetricCard label="Approved" value={approvedQuotes} sub="Ready to convert" color="text-emerald-600" onClick={() => navigate(createPageUrl("Quotes"))} />
            <MetricCard label="Broker Quotes" value={brokerQuotes} sub="Submitted by brokers" color="text-indigo-600" onClick={() => navigate(createPageUrl("Quotes"))} />
            <MetricCard label="Open Orders" value={openOrdersCount} sub={fmtMoney(openOrdersValue)} color="text-blue-600" onClick={() => navigate(createPageUrl("Production"))} />
            <MetricCard label="Unpaid Invoices" value={fmtMoney(unpaidInvoices)} sub="Outstanding" color="text-red-600" onClick={() => navigate(createPageUrl("Invoices"))} />
            <MetricCard label="Low Stock Items" value={lowStockItems.length} sub="Need reorder" color="text-red-600" onClick={() => navigate(createPageUrl("Inventory"))} />
          </div>

          {/* Order Pipeline */}
          <div>
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Order Pipeline</h3>
            <div className="grid gap-4 grid-cols-2 md:grid-cols-4 lg:grid-cols-8">
              {O_STATUSES.map(status => {
                const inStage = orders.filter((o) => o.status === status);
                return (
                  <div key={status} className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
                    <button
                      onClick={() => navigate(`/Orders?status=${encodeURIComponent(status)}`)}
                      className="w-full text-left bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-4 py-3 hover:bg-slate-100 transition"
                    >
                      <div className="text-xs font-bold text-slate-600 uppercase tracking-widest">{status}</div>
                      <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">{inStage.length}</div>
                    </button>
                    <div className="p-3 space-y-2 max-h-48 overflow-y-auto">
                      {inStage.map((o) => (
                        <button
                          key={o.id}
                          onClick={() => navigate(`/Orders?id=${o.id}`)}
                          className="w-full text-left text-xs bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-2 border border-slate-100 dark:border-slate-700 hover:bg-indigo-50 hover:border-indigo-200 transition"
                        >
                          <div className="font-semibold text-slate-800 dark:text-slate-200 truncate">{o.customer_name}</div>
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
                <div className="py-12 text-center text-slate-400 text-sm">No quotes yet.</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {quotes.slice(0, 6).map(q => (
                    <button
                      key={q.id}
                      onClick={() => navigate(`/Quotes?id=${q.id}`)}
                      className="w-full text-left px-5 py-3 flex items-center justify-between hover:bg-slate-50 dark:bg-slate-800 transition"
                    >
                      <div>
                        <div className="font-semibold text-slate-800 dark:text-slate-200 text-sm">{q.customer_name || "—"}</div>
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