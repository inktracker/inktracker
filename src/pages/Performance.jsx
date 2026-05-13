import { useState, useEffect, useMemo } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import { fmtMoney } from "../components/shared/pricing";
import { getDateRangeValues } from "@/lib/dateRangeUtils";
import { computeOutstanding } from "@/lib/reports/invoiceStats";
import { QB_REPORTS, qbReportUrl } from "@/lib/reports/qbReportLink";
import { ShoppingBag, DollarSign, Receipt, Layers, Activity, FileText, ExternalLink } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
  const [dateRange, setDateRange] = useState("thisMonth");

  const SUPABASE_FUNC_URL = import.meta.env.VITE_SUPABASE_URL;

  useEffect(() => {
    async function load() {
      const u = await base44.auth.me();

      // Background QB connection check — drives whether the Reports card shows.
      (async () => {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const res = await fetch(`${SUPABASE_FUNC_URL}/functions/v1/qbSync`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "checkConnection", accessToken: session?.access_token }),
          });
          const data = await res.json();
          setQbConnected(!!data?.connected);
        } catch {
          setQbConnected(false);
        }
      })();

      try {
        const [perfData, allOrders, allInvoices] = await Promise.all([
          base44.entities.ShopPerformance.filter({ shop_owner: u.email }, "-date", 1000).catch(() => []),
          base44.entities.Order.filter({ shop_owner: u.email }, "-created_date", 1000).catch(() => []),
          base44.entities.Invoice.filter({ shop_owner: u.email }, "-created_date", 1000).catch(() => []),
        ]);
        setRecords(perfData);
        setOrders(allOrders);
        setInvoices(allInvoices);
      } catch {}

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
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Performance</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Quick local stats. For full accounting reports, open them in QuickBooks below.
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

      {/* Local stats — period-bound */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <StatCard
          icon={ShoppingBag}
          label="Orders (period)"
          value={totalOrders}
          sub={dateRange === "all" ? "All time" : "Completed in range"}
          color="indigo"
        />
        {/* The underlying ShopPerformance.total field is the order's
            grand total — tax + rush + extras included. "Gross Sales" in
            accounting usually means revenue before tax, so the label
            was misleading. Renamed to make the inclusion explicit. */}
        <StatCard
          icon={DollarSign}
          label="Total Sales (incl. tax)"
          value={fmtMoney(grossSales)}
          sub={`${totalOrders} completed`}
          color="emerald"
        />
        <StatCard
          icon={Layers}
          label="Avg. Order Value"
          value={fmtMoney(aov)}
          color="slate"
        />
      </div>

      {/* Local stats — current state (not date-bound) */}
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
          label="Outstanding Invoices"
          value={fmtMoney(outstandingTotals.total)}
          sub={`${outstandingTotals.count} unpaid`}
          color="amber"
        />
      </div>

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
