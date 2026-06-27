import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { base44, supabase } from "@/api/supabaseClient";
import { cachedFilter, cachedList } from "@/lib/queries/cachedEntity";
import { DashboardSkeleton } from "@/components/shared/Skeletons";

const SUPABASE_FUNC_URL = import.meta.env.VITE_SUPABASE_URL;
import { createPageUrl } from "@/utils";
import { fmtMoney, fmtDate, O_STATUSES, getShopPricingConfig, getDisplayName, getOrderDisplayClient } from "../components/shared/pricing";
import { computeOutstanding } from "@/lib/reports/invoiceStats";
import { bucketQuotes } from "@/lib/broker/quoteStatus";
import { Users, TrendingUp, ChevronDown, ChevronUp, Building2, Mail, Phone, MessageSquare, BarChart2, Package, DollarSign, FileText, Bell, RefreshCw } from "lucide-react";
import { readMetricsCache, writeMetricsCache, clearMetricsCache } from "@/lib/qbMetricsCache";
import { resolveQuoteLink, QUOTE_LINK_KIND } from "@/lib/quotes/resolveQuoteLink";
import BrokerMessaging from "../components/broker/BrokerMessaging";
import BrokerNotificationFeed from "../components/broker/BrokerNotificationFeed";
import GettingStartedChecklist from "../components/GettingStartedChecklist";
import MfaNudgeBanner from "../components/MfaNudgeBanner";
import HintTip from "../components/shared/HintTip";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { shopScope } from "@/lib/shopScope";

const STATUS_COLORS = {
  Draft: "bg-slate-100 text-slate-600",
  Pending: "bg-yellow-100 text-yellow-700",
  Approved: "bg-emerald-100 text-emerald-700",
  Declined: "bg-red-100 text-red-600",
};

function MetricCard({ label, value, sub, color = "text-teal-600", onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full bg-white dark:bg-slate-900 rounded-xl sm:rounded-2xl border border-slate-200 dark:border-slate-700 p-3 sm:p-4 shadow-sm hover:shadow-md hover:border-slate-300 transition text-left"
    >
      <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-1.5">{label}</div>
      <div className={`text-xl sm:text-2xl font-bold ${color} truncate`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-500 mt-1">{sub}</div>}
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

function BrokerCard({ broker, shopOwners, currentUser, orders, unreadMessageCount = 0 }) {
  const [open, setOpen] = useState(false);
  // Default to the Messages sub-tab when the user opens a card that has
  // unread messages — that's almost certainly why they're clicking in.
  const [subTab, setSubTab] = useState(unreadMessageCount > 0 ? "messages" : "performance");
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
    try {
      const res = await base44.entities.Customer.filter({ shop_owner: `broker:${broker.email}` });
      setClients(res);
    } catch (e) {
      console.error("[BrokerCard] clients fetch failed:", e);
    } finally {
      setLoadingClients(false);
    }
  }

  // Pre-load the client list so the count shows on the collapsed card
  // header without the user needing to expand. N parallel queries
  // (one per broker on this shop) — bounded; acceptable.
  useEffect(() => {
    loadClients();
     
  }, [broker.email]);

  function toggle() {
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
            {broker.company_name && <span className="text-xs text-slate-500">{broker.company_name}</span>}
            {assignedShopNames.length > 0 && assignedShopNames.map((name, i) => (
              <span key={i} className="text-xs bg-teal-50 text-teal-700 font-semibold px-2 py-0.5 rounded-full">{name}</span>
            ))}
            {unreadMessageCount > 0 && (
              <span
                title={`${unreadMessageCount} unread message${unreadMessageCount === 1 ? "" : "s"} from this broker`}
                className="inline-flex items-center gap-1 text-xs bg-teal-600 text-white font-bold px-2 py-0.5 rounded-full"
              >
                <MessageSquare className="w-3 h-3" /> {unreadMessageCount}
              </span>
            )}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">{broker.email}</div>
        </div>
        {/* Quick stats */}
        <div className="flex items-center gap-4 shrink-0 ml-4">
          <div className="text-right hidden sm:block">
            <div className="text-xs text-slate-500">Clients</div>
            <div className="font-bold text-green-700 text-sm">{loadingClients ? "…" : clients.length}</div>
          </div>
          <div className="text-right hidden sm:block">
            <div className="text-xs text-slate-500">Orders</div>
            <div className="font-bold text-slate-800 dark:text-slate-200 text-sm">{brokerOrders.length}</div>
          </div>
          <div className="text-right hidden sm:block">
            <div className="text-xs text-slate-500">Revenue</div>
            <div className="font-bold text-teal-700 text-sm">{fmtMoney(totalRevenue)}</div>
          </div>
          {open ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-100 dark:border-slate-700">
          <div className="flex border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-5">
            {[
              { id: "performance", label: "Performance", icon: BarChart2 },
              { id: "clients", label: "Clients", icon: Users },
              { id: "messages", label: "Messages", icon: MessageSquare, badge: unreadMessageCount },
            ].map(({ id, label, icon: Icon, badge }) => (
              <button
                key={id}
                onClick={() => handleSubTab(id)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 -mb-px transition ${subTab === id ? "border-teal-600 text-teal-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}
              >
                <Icon className="w-3.5 h-3.5" />{label}
                {badge > 0 && (
                  <span className="bg-teal-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                    {badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="px-5 py-4 bg-slate-50 dark:bg-slate-800">
            {/* Performance */}
            {subTab === "performance" && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-center">
                    <div className="text-xs text-slate-500 font-semibold uppercase tracking-wide mb-1">Total Orders</div>
                    <div className="text-2xl font-bold text-slate-800 dark:text-slate-200">{brokerOrders.length}</div>
                  </div>
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-center">
                    <div className="text-xs text-slate-500 font-semibold uppercase tracking-wide mb-1">Revenue</div>
                    <div className="text-lg font-bold text-teal-700">{fmtMoney(totalRevenue)}</div>
                  </div>
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-center">
                    <div className="text-xs text-slate-500 font-semibold uppercase tracking-wide mb-1">Avg. Order</div>
                    <div className="text-lg font-bold text-slate-700">{fmtMoney(avgOrderValue)}</div>
                  </div>
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3">
                    <div className="text-xs text-slate-500 font-semibold uppercase tracking-wide mb-1.5">Status</div>
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
                        <Bar yAxisId="left" dataKey="orders" name="Orders" fill="#458465" radius={[4,4,0,0]} />
                        <Bar yAxisId="right" dataKey="revenue" name="Revenue" fill="#10b981" radius={[4,4,0,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="text-sm text-slate-500 text-center py-6">No order history yet.</div>
                )}
              </div>
            )}

            {/* Clients */}
            {subTab === "clients" && (
              <>
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">Clients ({loadingClients ? "…" : clients.length})</div>
                {loadingClients ? (
                  <div className="text-xs text-slate-500">Loading clients…</div>
                ) : clients.length === 0 ? (
                  <div className="text-xs text-slate-500">No clients added yet.</div>
                ) : (
                  <div className="space-y-2">
                    {clients.map(c => (
                      <div key={c.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2.5 flex items-start justify-between">
                        <div>
                          <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">{getDisplayName(c)}</div>
                          {c.company && <div className="flex items-center gap-1 text-xs text-slate-500 mt-0.5"><Building2 className="w-3 h-3" /> {c.company}</div>}
                        </div>
                        <div className="text-right text-xs text-slate-500 space-y-0.5">
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
  // QB connection drives where the financial chips source their
  // numbers from. When connected we kick off a getDashboardMetrics
  // call to pull Revenue + AR directly from QB; the chips render
  // those values instead of the local estimates. When not connected,
  // chips fall back to local order/invoice data.
  const [qbConnected, setQbConnected] = useState(false);
  const [qbMetrics, setQbMetrics] = useState(null);
  const [brokerUnreadCount, setBrokerUnreadCount] = useState(0);
  // Unread messages from brokers (separate from BrokerNotification rows
  // which cover quote-submission events). Combined with brokerUnreadCount
  // for the single Brokers-tab badge so one indicator covers "anything
  // broker-related needing attention".
  const [brokerMessageUnreadCount, setBrokerMessageUnreadCount] = useState(0);
  // Map of broker email → unread message count from that broker. Drives
  // the per-row indicator on the broker list so the user can see WHICH
  // broker's messages are unread without clicking through.
  const [brokerUnreadByEmail, setBrokerUnreadByEmail] = useState({});
  // Tracked set of unread message IDs (id → from_email). Lets us
  // decrement accurately on realtime UPDATE/DELETE events without
  // depending on `payload.old.read`, which Supabase only includes when
  // the table has REPLICA IDENTITY FULL — which the messages table does
  // not. Without this, the badge wouldn't go down when BrokerMessaging
  // marked messages read on view.
  const unreadMsgsRef = useRef(new Map());
  const [customerCount, setCustomerCount] = useState(0);
  // id → customer entity. Used by getDisplayName / getOrderDisplayClient
  // so the Order Pipeline + Recent Quotes cards show the company first,
  // falling back to contact name. Without this lookup the dashboard had
  // to use raw order.customer_name / quote.customer_name (contact only),
  // which is why those cards drifted from the Orders/Quotes pages.
  const [customers, setCustomers] = useState({});

  const [qbRefreshing, setQbRefreshing] = useState(false);

  // Pull QB metrics, honoring the 5-min localStorage cache unless the
  // caller passes { force: true } (e.g. via the Refresh button).
  // Extracted so both the initial-load effect and the manual refresh
  // share one code path. Best-effort: errors leave qbMetrics null,
  // chips fall back to local estimates.
  async function fetchQbMetrics({ force = false } = {}) {
    try {
      const me = await base44.auth.me();
      const shopOwner = me?.email;
      if (!force && shopOwner) {
        const cached = readMetricsCache(shopOwner);
        if (cached) { setQbMetrics(cached); return; }
      }
      const { data: { session } } = await supabase.auth.getSession();
      const { data: m, error: mErr } = await base44.functions.invoke("qbSync", {
        action: "getDashboardMetrics",
        accessToken: session?.access_token,
      });
      if (!mErr && m && typeof m === "object") {
        setQbMetrics(m);
        if (shopOwner) writeMetricsCache(shopOwner, m);
      }
    } catch {
      // Swallow — chips fall back to local estimates.
    }
  }

  // Background QB connection check + metrics fetch on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const { data, error: invErr } = await base44.functions.invoke("qbSync", {
          action: "checkConnection",
          accessToken: session?.access_token,
        });
        const connected = !invErr && !!data?.connected;
        if (cancelled) return;
        setQbConnected(connected);
        if (!connected) return;
        await fetchQbMetrics();
      } catch {
        if (!cancelled) { setQbConnected(false); setQbMetrics(null); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function handleRefreshQb() {
    setQbRefreshing(true);
    clearMetricsCache();
    try { await fetchQbMetrics({ force: true }); }
    finally { setQbRefreshing(false); }
  }

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
      // Reads go through the react-query cache (cachedFilter/cachedList): a
      // remount within staleTime (30s) serves these instantly with no network,
      // killing refetch-on-every-navigation. None of these lists are realtime
      // here (only Messages is, below), so caching is safe. Writes elsewhere
      // invalidate the table, so a freshly created quote/order/etc. still shows.
      const [q, o, invItems, allUsers, custs, localInvoices] = await Promise.all([
        cachedFilter("Quote", { filters: { shop_owner: shopScope(currentUser) }, sort: "-created_date", limit: 100 }).catch((e) => { console.error("[Dashboard] quotes fetch failed:", e); return []; }),
        cachedFilter("Order", { filters: { shop_owner: shopScope(currentUser) }, sort: "-created_date", limit: 50 }).catch((e) => { console.error("[Dashboard] orders fetch failed:", e); return []; }),
        cachedFilter("InventoryItem", { filters: { shop_owner: shopScope(currentUser) } }).catch((e) => { console.error("[Dashboard] inventory fetch failed:", e); return []; }),
        cachedList("User").catch((e) => { console.error("[Dashboard] users fetch failed:", e); return []; }),
        cachedFilter("Customer", { filters: { shop_owner: shopScope(currentUser) } }).catch((e) => { console.error("[Dashboard] customers fetch failed:", e); return []; }),
        // Project only the fields computeOutstanding() reads — the invoices
        // table is wide (jsonb line snapshots) and select * detoasted every
        // row (~180ms / ~600KB for one shop). id/date/total/paid is all the
        // Dashboard needs. See perf analysis fix #3.
        cachedFilter("Invoice", { filters: { shop_owner: shopScope(currentUser) }, sort: "-created_date", limit: 1000, columns: "id,date,total,paid" }).catch((e) => { console.error("[Dashboard] invoices fetch failed:", e); return []; }),
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
      const myBrokers = allUsers.filter(u => u.role === "broker" && (u.assigned_shops || []).includes(currentUser.email));
      setBrokers(myBrokers);
      setShopOwners(allUsers.filter(u => u.role !== "broker"));

      // Unread broker-message count for the Brokers-tab badge. Filtered
      // to messages whose sender is one of THIS shop's brokers — otherwise
      // unread customer/system messages would inflate the badge too and
      // make it confusing (the badge is labelled "Brokers" not "Messages").
      try {
        const unread = await base44.entities.Message.filter({
          to_email: currentUser.email,
          read: false,
        }, "-created_date", 200);
        const brokerEmails = new Set(myBrokers.map(b => b.email));
        const fromBrokers = (unread || []).filter(m => brokerEmails.has(m.from_email));
        // Build the authoritative tracking map: message id → sender email.
        // Counts derive from this so realtime updates can decrement by id
        // without needing the old read state in the payload.
        unreadMsgsRef.current = new Map(fromBrokers.map(m => [m.id, m.from_email]));
        recomputeBrokerUnread();
      } catch {
        // Best-effort.
      }

      setLoading(false);
    }
    loadData();
  }, [navigate]);

  // Recompute counts from the ID-tracking ref. Single source of truth so
  // the per-broker map and the total stay in sync; called whenever the
  // ref changes (initial load, realtime add/remove).
  function recomputeBrokerUnread() {
    const byEmail = {};
    for (const sender of unreadMsgsRef.current.values()) {
      byEmail[sender] = (byEmail[sender] || 0) + 1;
    }
    setBrokerUnreadByEmail(byEmail);
    setBrokerMessageUnreadCount(unreadMsgsRef.current.size);
  }

  // Realtime: keep brokerMessageUnreadCount fresh as messages arrive and
  // as the shop owner opens conversations (BrokerMessaging flips read=true
  // on view). Tracks by message ID instead of relying on the OLD payload's
  // `read` field — Supabase only includes the full old row under REPLICA
  // IDENTITY FULL, which this table doesn't have, so the prior
  // "old.read === false" check never fired and the badge wouldn't decrement
  // when conversations were opened.
  useEffect(() => {
    async function ensureSub() {
      let me;
      try {
        me = await base44.auth.me();
      } catch { return; }
      if (!me?.email) return;
      const myEmail = me.email;
      const brokerEmails = new Set(brokers.map(b => b.email));
      const isFromBroker = (row) => row && brokerEmails.has(row.from_email);
      const unsub = base44.entities.Message.subscribe((payload) => {
        const row = payload?.new || payload?.old;
        if (!row || row.to_email !== myEmail) return;
        if (!isFromBroker(payload.new) && !isFromBroker(payload.old)) return;
        const map = unreadMsgsRef.current;
        const id = row.id;
        let changed = false;
        if (payload.eventType === "INSERT" && payload.new && !payload.new.read) {
          if (!map.has(id)) { map.set(id, payload.new.from_email); changed = true; }
        } else if (payload.eventType === "UPDATE") {
          // Flipping read=true is the common case (opening a conversation).
          // Just drop the id from our set; no dependence on the old payload.
          if (payload.new?.read === true && map.has(id)) {
            map.delete(id); changed = true;
          }
        } else if (payload.eventType === "DELETE") {
          if (map.has(id)) { map.delete(id); changed = true; }
        }
        if (changed) recomputeBrokerUnread();
      });
      return unsub;
    }
    let cleanup;
    ensureSub().then((fn) => { cleanup = fn; });
    return () => { if (typeof cleanup === "function") cleanup(); };
  }, [brokers]);

  // Same-tab decrement when BrokerMessaging marks messages as read on view.
  // We can't rely on Supabase realtime UPDATE events for the messages table
  // (publication isn't configured to emit them), so BrokerMessaging dispatches
  // a window event with the affected ids and we drop them from our tracking
  // map right away. Realtime still handles INSERTs from other clients.
  useEffect(() => {
    function handler(e) {
      const ids = e?.detail?.messageIds || [];
      if (!ids.length) return;
      const map = unreadMsgsRef.current;
      let changed = false;
      for (const id of ids) {
        if (map.has(id)) { map.delete(id); changed = true; }
      }
      if (changed) recomputeBrokerUnread();
    }
    window.addEventListener("inktracker:messages-marked-read", handler);
    return () => window.removeEventListener("inktracker:messages-marked-read", handler);
  }, []);

  if (loading) return <DashboardSkeleton />;

  const sumTotals = (items) => items.reduce((s, x) => s + (Number(x.total) || 0), 0);

  // "Open" = total pipeline that hasn't been won/lost yet — Draft +
  // Sent + Pending all rolled together. The Approved bucket includes
  // both Approved and Approved and Paid. Bucketing lives in
  // lib/broker/quoteStatus.js + unit tests so the shop and broker
  // views can't drift.
  // ── New 5-chip set ─────────────────────────────────────────────────
  // 1. Quotes — ALL quotes (count + total value across every status)
  // 2. Open Orders — non-terminal orders
  // 3. Open Invoices — outstanding (unpaid) invoices
  // 4. Revenue (last 30 days) — sum of completed orders in the window
  // 5. Units Sold (last 30 days) — total garment count from those orders
  //
  // Per the project memory, QB is the v1 sole customer-payment integration.
  // When the shop is QB-connected, #4 + #5 ought to pull from QB's reports
  // for the authoritative number (some invoices may be created directly in
  // QB and synced back). The QB read path isn't wired here yet — local
  // order data is the source until we add a `getDashboardMetrics` action
  // to qbSync. Tracked in AUDIT_2026-05-26.md as a follow-up.
  // Match the Quotes page filter (Quotes.jsx:96-99) — quotes that have
  // been converted to orders aren't "active quotes" anymore, they live
  // under Orders. Counting them on the dashboard made the chip claim
  // e.g. "4 Quotes" then take you to an empty list. Both surfaces now
  // exclude "Converted to Order".
  const activeQuotes = quotes.filter((q) => q.status !== "Converted to Order");
  const totalQuotesCount = activeQuotes.length;
  const totalQuotesValue = sumTotals(activeQuotes);

  // Open orders excludes Completed AND Cancelled/Voided — all three are
  // terminal states. Cancelled jobs used to inflate the count + dollar
  // total even though they'd never invoice.
  const TERMINAL_STATUSES = new Set(["Completed", "Cancelled", "Voided"]);
  const activeOrders = orders.filter(o => !TERMINAL_STATUSES.has(o.status));
  const unpaidOpenOrders = activeOrders.filter(o => !o.paid);
  const openOrdersCount = activeOrders.length;
  const openOrdersValue = sumTotals(unpaidOpenOrders);

  const outstanding = computeOutstanding(invoices);
  const openInvoicesCount = outstanding.count;
  const openInvoicesValue = outstanding.total;

  // Last-30-day revenue + units. Scoped to orders whose status is
  // "Completed" AND whose completed_date falls inside the window. Matches
  // the Order Pipeline's Completed column scoping (PR #225) so the numbers
  // line up between the two surfaces.
  const REVENUE_WINDOW_DAYS = 30;
  const REVENUE_WINDOW_MS = REVENUE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const revenueWindowCutoff = Date.now() - REVENUE_WINDOW_MS;
  const recentCompleted = orders.filter(o => {
    if (o.status !== "Completed") return false;
    const t = o.completed_date ? new Date(o.completed_date).getTime() : 0;
    return t >= revenueWindowCutoff;
  });
  const revenueLast30 = sumTotals(recentCompleted);
  const unitsLast30 = recentCompleted.reduce((sum, o) => {
    return sum + (o.line_items || []).reduce((s, li) => {
      const sizes = li.sizes || {};
      return s + Object.values(sizes).reduce((a, v) => a + (parseInt(v, 10) || 0), 0);
    }, 0);
  }, 0);

  // Legacy aliases still used by GettingStartedChecklist + lower-half UI
  // (the Open Quotes count + dollar total appear on the order-pipeline
  // chips below the new metric row).
  const { pending, approved: approvedQuotesList, draft } = bucketQuotes(quotes);
  const openQuotesList     = [...draft, ...pending];
  const openQuotes         = openQuotesList.length;
  const approvedQuotes     = approvedQuotesList.length;
  const openQuotesValue    = sumTotals(openQuotesList);
  const approvedQuotesValue = sumTotals(approvedQuotesList);

  const lowStockItems = inventory.filter(i => (i.reorder || 0) > 0 && (i.qty || 0) <= (i.reorder || 0));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100">Dashboard</h1>
          <p className="text-slate-500 text-xs sm:text-sm mt-0.5">{user?.shop_name || "My Shop"}</p>
        </div>
      </div>

      {/* MFA nudge — auto-hides when the user is enrolled or has
          dismissed within the last 7 days. */}
      <MfaNudgeBanner />

      {/* Tabs */}
      <div className="flex gap-0 border-b border-slate-200 dark:border-slate-700">
        {[
          { id: "overview", label: "Overview", icon: TrendingUp },
          {
            id: "brokers",
            label: "Brokers",
            icon: Users,
            // Split into two distinct chips so the source is obvious at a
            // glance — a single combined "5" left users guessing whether
            // it meant unread messages, broker activity, or both.
            chips: [
              brokerUnreadCount > 0 && {
                icon: Bell,
                count: brokerUnreadCount,
                title: `${brokerUnreadCount} new broker activity event${brokerUnreadCount === 1 ? "" : "s"}`,
              },
              brokerMessageUnreadCount > 0 && {
                icon: MessageSquare,
                count: brokerMessageUnreadCount,
                title: `${brokerMessageUnreadCount} unread message${brokerMessageUnreadCount === 1 ? "" : "s"} from brokers`,
              },
            ].filter(Boolean),
            hint: "Independent resellers who bring their own clients to your shop for production. Manage brokers from Account > Admin Panel.",
          },
        ].map(({ id, label, icon: NavIcon, chips, hint }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-5 py-3 text-[12px] font-bold uppercase tracking-[0.16em] border-b-2 -mb-px transition ${
              tab === id ? "border-teal-600 text-teal-700" : "border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-200"
            }`}
          >
            <NavIcon className="w-4 h-4" /> {label}
            {hint && <HintTip text={hint} side="bottom" />}
            {(chips || []).map(({ icon: ChipIcon, count, title }, i) => (
              <span
                key={i}
                title={title}
                className="inline-flex items-center gap-1 bg-teal-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-full leading-none"
              >
                <ChipIcon className="w-3 h-3" /> {count}
              </span>
            ))}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW TAB ── */}
      {tab === "overview" && (
        <div className="space-y-6">
          {/* Metrics — all 5 chips always visible.
                When QB is connected AND the getDashboardMetrics call
                returned, Open Invoices + Revenue (30d) display the
                QB-sourced numbers (with a "via QuickBooks" label).
                If QB isn't connected, or the metrics call is still in
                flight / errored, those chips fall back to the local
                estimates so the user always sees a value. Units Sold
                stays local — QB doesn't track garment counts. */}
          {(() => {
            const qbReady = qbConnected && qbMetrics;
            const invoicesLabel = qbReady ? "Open Invoices (QB)" : "Open Invoices";
            const invoicesValue = qbReady ? qbMetrics.openInvoicesCount : openInvoicesCount;
            const invoicesSub   = qbReady ? fmtMoney(qbMetrics.openInvoicesTotal) : fmtMoney(openInvoicesValue);
            const revenueLabel  = qbReady ? "Revenue (30d, QB)" : "Revenue (30d)";
            const revenueValue  = qbReady ? fmtMoney(qbMetrics.revenueLast30Days) : fmtMoney(revenueLast30);
            const revenueSub    = qbReady
              ? `${qbMetrics.revenueOrderCount} invoice${qbMetrics.revenueOrderCount === 1 ? "" : "s"}`
              : `${recentCompleted.length} order${recentCompleted.length === 1 ? "" : "s"}`;
            return (
              <>
                <div
                  data-tour="metrics"
                  className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3"
                >
                  <MetricCard label="Quotes" value={totalQuotesCount} sub={fmtMoney(totalQuotesValue)} color="text-yellow-600" onClick={() => navigate(createPageUrl("Quotes"))} />
                  <MetricCard label="Open Orders" value={openOrdersCount} sub={fmtMoney(openOrdersValue)} color="text-blue-600" onClick={() => navigate(createPageUrl("Production"))} />
                  <MetricCard label={invoicesLabel} value={invoicesValue} sub={invoicesSub} color="text-red-600" onClick={() => navigate(createPageUrl("Invoices"))} />
                  <MetricCard label={revenueLabel} value={revenueValue} sub={revenueSub} color="text-emerald-600" onClick={() => navigate(createPageUrl("Performance"))} />
                  <MetricCard label="Units Sold (30d)" value={unitsLast30.toLocaleString()} sub={`${recentCompleted.length} order${recentCompleted.length === 1 ? "" : "s"}`} color="text-green-600" onClick={() => navigate(createPageUrl("Performance"))} />
                </div>
                {qbConnected && !qbMetrics && (
                  <p className="text-[11px] text-slate-500 -mt-3">
                    Loading authoritative numbers from QuickBooks…
                  </p>
                )}
                {qbReady && (
                  <div className="-mt-3 flex items-center gap-2 text-[11px] text-slate-500">
                    <span>
                      Open Invoices + Revenue sourced from QuickBooks · as of {new Date(qbMetrics.asOf || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <button
                      type="button"
                      onClick={handleRefreshQb}
                      disabled={qbRefreshing}
                      className="inline-flex items-center gap-1 font-semibold text-teal-600 hover:text-teal-700 disabled:opacity-50"
                      title="Refresh now — bypasses the 5-minute cache and re-queries QuickBooks"
                    >
                      <RefreshCw className={`w-3 h-3 ${qbRefreshing ? "animate-spin" : ""}`} />
                      {qbRefreshing ? "Refreshing…" : "Refresh"}
                    </button>
                  </div>
                )}
              </>
            );
          })()}

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
                // "Completed" is terminal — show only jobs completed in the
                // last 30 days. Without this the column accumulates forever
                // and the count stops being useful (was showing 6+ months
                // of completed jobs on a freshly-onboarded shop).
                const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
                const inStage = orders.filter((o) => {
                  if (o.status !== status) return false;
                  if (status !== "Completed") return true;
                  const t = o.completed_date ? new Date(o.completed_date).getTime() : 0;
                  return t >= thirtyDaysAgo;
                });
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
                          className="w-full text-left text-xs bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-2 border border-slate-100 dark:border-slate-700 hover:bg-teal-50 hover:border-teal-200 transition"
                        >
                          <div className="font-display uppercase tracking-[0.04em] text-slate-900 dark:text-slate-100 text-sm truncate leading-tight">{getOrderDisplayClient(o, customers[o.customer_id])}</div>
                          <div className="font-display uppercase tracking-[0.12em] text-[10px] text-slate-500 mt-0.5">{o.order_id}</div>
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
                <span className="text-xs font-semibold text-slate-500">{quotes.length} total</span>
              </button>
              {quotes.length === 0 ? (
                <div className="py-12 text-center">
                  <FileText className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                  <p className="text-sm text-slate-500 mb-3">No quotes yet</p>
                  <button onClick={() => navigate(createPageUrl("Quotes"))} className="text-xs font-semibold text-teal-600 hover:text-teal-700 transition">
                    Create your first quote &rarr;
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {quotes.slice(0, 6).map(q => (
                    <button
                      key={q.id}
                      onClick={() => {
                        // Shared resolver (lib/quotes/resolveQuoteLink) so the
                        // Dashboard, Calendar, and Production grids all route
                        // converted quotes identically. Includes a reverse-link
                        // fallback (orders.find by quote_id) for legacy rows
                        // where converted_order_id was never written.
                        const r = resolveQuoteLink(q, orders);
                        if (r.kind === QUOTE_LINK_KIND.OPEN_ORDER) {
                          navigate(`/Orders?id=${r.order.id}`);
                          return;
                        }
                        if (r.kind === QUOTE_LINK_KIND.NAVIGATE_ORDERS) {
                          navigate("/Orders");
                          return;
                        }
                        navigate(`/Quotes?id=${r.quoteId}`);
                      }}
                      className="w-full text-left px-5 py-3 flex items-center justify-between hover:bg-slate-50 dark:bg-slate-800 transition"
                    >
                      <div>
                        <div className="font-display uppercase tracking-[0.04em] text-slate-900 dark:text-slate-100 text-base leading-tight">{getDisplayName(customers[q.customer_id] || q.customer_name) || "—"}</div>
                        <div className="font-display uppercase tracking-[0.12em] text-[10px] text-slate-500 mt-1">
                          {q.quote_id}
                          {q.broker_id && <span className="ml-2 text-teal-500">via broker</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {q.date && <span className="font-display uppercase tracking-[0.1em] text-[10px] text-slate-500">{fmtDate(q.date)}</span>}
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
                <span className="text-xs font-semibold text-slate-500">{lowStockItems.length} flagged</span>
              </button>
              {lowStockItems.length === 0 ? (
                <div className="py-12 text-center text-slate-500 text-sm">All items are well stocked.</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {lowStockItems.slice(0, 6).map(item => (
                    <button
                      key={item.id}
                      onClick={() => navigate(createPageUrl("Inventory"))}
                      className="w-full text-left px-5 py-3 hover:bg-slate-50 dark:bg-slate-800 transition"
                    >
                      <div className="flex justify-between items-start mb-1 gap-3">
                        <div className="font-display uppercase tracking-[0.04em] text-slate-900 dark:text-slate-100 text-base leading-tight">{item.item}</div>
                        <span className="font-display uppercase tracking-[0.12em] text-[10px] text-slate-500 shrink-0 mt-0.5">{item.sku}</span>
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
                className="w-full text-left bg-teal-50 border border-teal-200 rounded-xl p-4 flex items-center gap-3 hover:bg-teal-100 transition"
              >
                <Package className="w-7 h-7 text-teal-400" />
                <div>
                  <div className="text-xs font-semibold text-teal-500 uppercase tracking-widest">Total Broker Orders</div>
                  <div className="text-2xl font-bold text-teal-700">{orders.filter(o => o.broker_id).length}</div>
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
                className="w-full text-left bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3 hover:bg-green-100 transition"
              >
                <Users className="w-7 h-7 text-green-400" />
                <div>
                  <div className="text-xs font-semibold text-green-500 uppercase tracking-widest">Active Brokers</div>
                  <div className="text-2xl font-bold text-green-700">{brokers.length}</div>
                </div>
              </button>
            </div>
          )}
          {brokers.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl py-16 text-center">
              <Users className="w-12 h-12 text-slate-200 mx-auto mb-3" />
              <p className="text-slate-500 text-sm">Brokers can be assigned to your shop from the <strong>Account</strong> page by an admin.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {brokers.map(broker => (
                <BrokerCard
                  key={broker.id}
                  broker={broker}
                  shopOwners={shopOwners}
                  currentUser={user}
                  orders={orders}
                  unreadMessageCount={brokerUnreadByEmail[broker.email] || 0}
                />
              ))}
            </div>
          )}
        </div>
      )}

    </div>
  );
}