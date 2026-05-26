import { useState, useEffect, useMemo } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import { fmtMoney } from "../components/shared/pricing";
import { getDateRangeValues } from "@/lib/dateRangeUtils";
import { computeOutstanding } from "@/lib/reports/invoiceStats";
import { QB_REPORTS, qbReportUrl } from "@/lib/reports/qbReportLink";
import { ShoppingBag, DollarSign, Receipt, Layers, Activity, FileText, ExternalLink, RefreshCw } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { readMetricsCache, writeMetricsCache, clearMetricsCache } from "@/lib/qbMetricsCache";

const COMPLETED_STATUSES = new Set(["Completed", "Shipped", "Delivered", "Picked Up"]);
const CANCELLED_STATUSES = new Set(["Cancelled", "Canceled", "Voided"]);

function StatCard({ icon: Icon, label, value, sub, color = "indigo" }) {
  const colors = {
    indigo:  "bg-indigo-50 text-indigo-600",
    emerald: "bg-emerald-50 text-emerald-600",
    amber:   "bg-amber-50 text-amber-600",
    rose:    "bg-rose-50 text-rose-600",
    slate:   "bg-slate-50 text-slate-600",
  };
  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-700 p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${colors[color] || colors.indigo}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</div>
      </div>
      <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
    </div>
  );
}

export default function Performance() {
  const [records, setRecords] = useState([]);   // ShopPerformance archive (completed orders)
  const [orders, setOrders] = useState([]);     // live orders (for active count)
  const [invoices, setInvoices] = useState([]); // local invoices (for outstanding)
  const [loading, setLoading] = useState(true);
  const [qbConnected, setQbConnected] = useState(false);
  const [qbMetrics, setQbMetrics] = useState(null);
  const [qbRefreshing, setQbRefreshing] = useState(false);
  const [dateRange, setDateRange] = useState("thisMonth");
  const [loadError, setLoadError] = useState("");

  const SUPABASE_FUNC_URL = import.meta.env.VITE_SUPABASE_URL;

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
      // Fall back to local — chip will show local fields if QB fetch fails.
    }
  }

  async function handleRefreshQb() {
    setQbRefreshing(true);
    clearMetricsCache();
    try { await fetchQbMetrics({ force: true }); }
    finally { setQbRefreshing(false); }
  }

  useEffect(() => {
    async function load() {
      const u = await base44.auth.me();

      // Background QB connection check + metrics fetch. When connected
      // we pull Revenue + AR from QB and overlay them on the cards.
      // Same two-step pattern as Dashboard.jsx (cache-aware via
      // fetchQbMetrics → readMetricsCache).
      (async () => {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token;
          const { data, error: invErr } = await base44.functions.invoke("qbSync", {
            action: "checkConnection",
            accessToken: token,
          });
          const connected = !invErr && !!data?.connected;
          setQbConnected(connected);
          if (!connected) return;
          await fetchQbMetrics();
        } catch {
          setQbConnected(false);
          setQbMetrics(null);
        }
      })();

      // Per-query .catch + a `loadError` flag so an RLS hiccup surfaces in
      // the UI as a banner instead of silently rendering zeros. Each
      // bucket falls back to [] so the math below stays safe.
      let failures = 0;
      const [perfData, allOrders, allInvoices] = await Promise.all([
        base44.entities.ShopPerformance.filter({ shop_owner: u.email }, "-date", 1000).catch((e) => { console.error("[Performance] perf fetch failed:", e); failures++; return []; }),
        base44.entities.Order.filter({ shop_owner: u.email }, "-created_date", 1000).catch((e) => { console.error("[Performance] orders fetch failed:", e); failures++; return []; }),
        base44.entities.Invoice.filter({ shop_owner: u.email }, "-created_date", 1000).catch((e) => { console.error("[Performance] invoices fetch failed:", e); failures++; return []; }),
      ]);
      setRecords(perfData);
      setOrders(allOrders);
      setInvoices(allInvoices);
      if (failures > 0) setLoadError(`Some performance data couldn't load (${failures} of 3 sources). Numbers below may be incomplete.`);

      setLoading(false);
    }
    load();
  }, []);

  // ── Date-filtered records (drives Total Orders + Gross Sales) ────────────
  const { from, to } = useMemo(() => {
    if (dateRange === "all") return { from: null, to: null };
    const r = getDateRangeValues(dateRange) || {};
    return { from: r.dateFrom || null, to: r.dateTo || null };
  }, [dateRange]);

  const filteredRecords = useMemo(() => {
    if (!from && !to) return records;
    return records.filter((r) => {
      if (!r.date) return false;
      if (from && r.date < from) return false;
      if (to   && r.date > to)   return false;
      return true;
    });
  }, [records, from, to]);

  // ── Stats ────────────────────────────────────────────────────────────────
  const totalOrders = filteredRecords.length;
  const grossSales  = filteredRecords.reduce((s, r) => s + (Number(r.total) || 0), 0);
  const aov         = totalOrders > 0 ? grossSales / totalOrders : 0;

  const activeOrders = useMemo(() => {
    return orders.filter((o) => {
      const s = o?.status;
      return s && !COMPLETED_STATUSES.has(s) && !CANCELLED_STATUSES.has(s);
    });
  }, [orders]);
  const activeCount = activeOrders.length;
  const activeValue = activeOrders.reduce((s, o) => s + (Number(o.total) || 0), 0);

  const outstandingTotals = useMemo(() => computeOutstanding(invoices), [invoices]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400 text-sm">
        Loading performance…
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {loadError && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
          {loadError}
        </div>
      )}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Performance</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {qbConnected
              ? "Operational view of recent orders. QuickBooks is the source of truth for sales, tax, and accounts receivable — open the reports below for those numbers."
              : "Quick local stats. Connect QuickBooks for authoritative sales and AR reports."}
          </p>
        </div>

        <div className="w-full sm:w-56">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1 block">Date Range</label>
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="thisMonth">This Month</SelectItem>
              <SelectItem value="lastMonth">Last Month</SelectItem>
              <SelectItem value="last3Months">Last 3 Months</SelectItem>
              <SelectItem value="last6Months">Last 6 Months</SelectItem>
              <SelectItem value="last12Months">Last 12 Months</SelectItem>
              <SelectItem value="lastYear">Last Year</SelectItem>
              <SelectItem value="thisYear">This Year</SelectItem>
              <SelectItem value="all">All Time</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Local stats — period-bound. All five cards always render.
          When QB is connected AND the getDashboardMetrics call returned,
          Total Sales (30d) + Outstanding Invoices show QB-sourced
          numbers with a "via QuickBooks" badge in the label. Orders
          (period) + Avg. Order Value stay local — QB doesn't give us
          a directly comparable invoice count per arbitrary date-range
          here, and AOV derives from those two anyway.
          Note: the QB Total Sales is fixed to the last 30 days
          regardless of the page's date-range selector — `getDashboardMetrics`
          today returns just the 30d window. We surface that in the sub
          label so the user isn't confused when they pick "Last Year"
          and see a 30d-only QB number. */}
      {(() => {
        const qbReady = qbConnected && qbMetrics;
        const salesLabel = qbReady ? "Total Sales (QB, 30d)" : "Total Sales (incl. tax)";
        const salesValue = qbReady ? fmtMoney(qbMetrics.revenueLast30Days) : fmtMoney(grossSales);
        const salesSub   = qbReady
          ? `${qbMetrics.revenueOrderCount} invoice${qbMetrics.revenueOrderCount === 1 ? "" : "s"} · live from QuickBooks`
          : `${totalOrders} completed`;
        const arLabel = qbReady ? "Outstanding Invoices (QB)" : "Outstanding Invoices";
        const arValue = qbReady ? fmtMoney(qbMetrics.openInvoicesTotal) : fmtMoney(outstandingTotals.total);
        const arSub   = qbReady
          ? `${qbMetrics.openInvoicesCount} unpaid · live from QuickBooks`
          : `${outstandingTotals.count} unpaid`;
        return (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <StatCard
                icon={ShoppingBag}
                label="Orders (period)"
                value={totalOrders}
                sub={dateRange === "all" ? "All time" : "Completed in range"}
                color="indigo"
              />
              <StatCard
                icon={DollarSign}
                label={salesLabel}
                value={salesValue}
                sub={salesSub}
                color="emerald"
              />
              <StatCard
                icon={Layers}
                label="Avg. Order Value"
                value={fmtMoney(aov)}
                color="slate"
              />
            </div>

            {/* Current state (not date-bound) */}
            <div className="grid grid-cols-2 gap-4">
              <StatCard
                icon={Activity}
                label="Active Orders"
                value={activeCount}
                sub={activeValue > 0 ? `${fmtMoney(activeValue)} in production` : null}
                color="indigo"
              />
              <StatCard
                icon={Receipt}
                label={arLabel}
                value={arValue}
                sub={arSub}
                color="amber"
              />
            </div>

            {qbConnected && !qbMetrics && (
              <p className="text-xs text-slate-400 -mt-4">
                Loading authoritative numbers from QuickBooks…
              </p>
            )}
            {qbReady && (
              <div className="-mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span>
                  Total Sales + Outstanding Invoices sourced from QuickBooks. Avg. Order Value remains a local estimate. As of {new Date(qbMetrics.asOf || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.
                </span>
                <button
                  type="button"
                  onClick={handleRefreshQb}
                  disabled={qbRefreshing}
                  className="inline-flex items-center gap-1 font-semibold text-indigo-600 hover:text-indigo-700 disabled:opacity-50"
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

      {/* QuickBooks Reports — deep-link card (only when connected). */}
      {qbConnected && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-700 p-6 space-y-4">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-indigo-600" />
            <h3 className="text-base font-bold text-slate-800 dark:text-slate-200">Detailed Reports (QuickBooks)</h3>
          </div>
          <p className="text-sm text-slate-500 -mt-2">
            For P&amp;L, Balance Sheet, Cash Flow, AR Aging, and Sales by Customer — open in QuickBooks for full date controls and drill-down.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {QB_REPORTS.map((r) => (
              <a
                key={r.key}
                href={qbReportUrl(r.key)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 hover:border-indigo-300 hover:bg-indigo-50 dark:hover:bg-slate-800 transition"
              >
                <span className="truncate">{r.label}</span>
                <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
