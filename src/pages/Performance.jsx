import { useState, useEffect, useMemo } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import { fmtMoney } from "../components/shared/pricing";
import { getDateRangeValues } from "@/lib/dateRangeUtils";
import { TrendingUp, ShoppingBag, Users, DollarSign, TrendingDown, ChevronDown, ChevronUp, FileText, RefreshCw, ExternalLink } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import NativeStatsPanel from "@/components/shared/NativeStatsPanel";
import { computeNativeStats } from "@/lib/nativeStats";

function StatCard({ icon: Icon, label, value, sub, color = "indigo" }) {
  const colors = {
    indigo: "bg-indigo-50 text-indigo-600",
    emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    rose: "bg-rose-50 text-rose-600",
  };
  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-700 p-5 flex items-start gap-4">
      <div className={`p-2.5 rounded-xl ${colors[color]}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">{value}</div>
        <div className="text-sm font-semibold text-slate-500">{label}</div>
        {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

export default function Performance() {
  const [records, setRecords] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [qbConnected, setQbConnected] = useState(false);
  const [user, setUser] = useState(null);
  const [filters, setFilters] = useState(() => ({
    dateRange: "thisMonth",
    ...getDateRangeValues("thisMonth"),
    categoryFilter: "all",
  }));
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [jobCostOrders, setJobCostOrders] = useState([]);

  // Live entities for native (no-QB) stats.
  const [allQuotes, setAllQuotes] = useState([]);
  const [allOrders, setAllOrders] = useState([]);
  const [allInvoices, setAllInvoices] = useState([]);
  const [allCustomers, setAllCustomers] = useState([]);

  const SUPABASE_FUNC_URL = import.meta.env.VITE_SUPABASE_URL;

  // QB Reports state
  const [qbReport, setQbReport] = useState(null);
  const [qbReportLoading, setQbReportLoading] = useState(false);
  const [qbReportError, setQbReportError] = useState(null);
  const [selectedReport, setSelectedReport] = useState("ProfitAndLoss");
  const [reportStartDate, setReportStartDate] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 11); d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [reportEndDate, setReportEndDate] = useState(() => new Date().toISOString().slice(0, 10));

  const QB_REPORTS = [
    { id: "ProfitAndLoss",        label: "Profit & Loss" },
    { id: "BalanceSheet",         label: "Balance Sheet" },
    { id: "CashFlow",             label: "Cash Flow" },
    { id: "CustomerSales",        label: "Customer Sales" },
    { id: "VendorExpenses",       label: "Vendor Expenses" },
    { id: "AgedReceivableDetail", label: "Aged Receivables" },
    { id: "AgedPayableDetail",    label: "Aged Payables" },
    { id: "GeneralLedger",        label: "General Ledger" },
    { id: "TransactionList",      label: "Transaction List" },
    { id: "TrialBalance",         label: "Trial Balance" },
  ];

  async function callQbSync(action, params = {}) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${SUPABASE_FUNC_URL}/functions/v1/qbSync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, accessToken: session?.access_token, ...params }),
    });
    return res.json();
  }

  async function fetchQbReport(reportName, startDate, endDate) {
    setQbReportLoading(true);
    setQbReportError(null);
    setQbReport(null);
    try {
      const data = await callQbSync("getReport", { reportName, startDate, endDate });
      if (data?.error) throw new Error(data.error);
      setQbReport(data);
    } catch (err) {
      setQbReportError(err.message);
    } finally {
      setQbReportLoading(false);
    }
  }

  function parseReportRows(rows, depth = 0) {
    const result = [];
    for (const row of rows?.Row ?? []) {
      if (row.type === "Data") {
        const cols = row.ColData ?? [];
        const label = cols[0]?.value ?? "";
        if (!label) continue;
        result.push({ label, cols: cols.slice(1), depth, type: "data" });
      } else if (row.type === "Section") {
        const header = row.Header?.ColData;
        if (header?.[0]?.value) result.push({ label: header[0].value, cols: header.slice(1), depth, type: "header" });
        result.push(...parseReportRows(row.Rows, depth + 1));
        const summary = row.Summary?.ColData;
        if (summary?.[0]?.value) result.push({ label: summary[0].value, cols: summary.slice(1), depth, type: "total" });
      }
    }
    return result;
  }

  useEffect(() => {
    async function load() {
      const u = await base44.auth.me();
      setUser(u);

      // Check if QB is connected
      const connCheck = await callQbSync("checkConnection");
      const isConnected = connCheck?.connected ?? false;
      setQbConnected(isConnected);

      if (isConnected) {
        const { dateFrom, dateTo } = getDateRangeValues("thisMonth");
        const [qbData, plData] = await Promise.all([
          callQbSync("getPerformanceData", { dateFrom, dateTo }),
          callQbSync("getReport", { reportName: "ProfitAndLoss", startDate: dateFrom, endDate: dateTo }),
        ]);
        if (qbData?.error) {
          console.error("getPerformanceData error:", qbData.error);
        }
        setRecords(qbData?.revenue ?? []);
        setExpenses(qbData?.expenses ?? []);
        if (plData && !plData.error) {
          setQbPLTotals(extractPLTotals(plData));
        }
      } else {
        const [perfData, expData] = await Promise.all([
          base44.entities.ShopPerformance.filter({ shop_owner: u.email }, "-date", 1000),
          base44.entities.Expense.filter({ shop_owner: u.email }, "-payment_date", 1000),
        ]);
        setRecords(perfData);
        setExpenses(expData);
      }

      // Load full live entities for native stats. Done in parallel; failures
      // for any one entity leave that array empty without breaking the others.
      try {
        const [orders, quotes, invoices, customers] = await Promise.all([
          base44.entities.Order.filter({ shop_owner: u.email }, "-created_date", 1000).catch(() => []),
          base44.entities.Quote.filter({ shop_owner: u.email }, "-created_date", 1000).catch(() => []),
          base44.entities.Invoice.filter({ shop_owner: u.email }, "-created_date", 1000).catch(() => []),
          base44.entities.Customer.filter({ shop_owner: u.email }, "-created_date", 2000).catch(() => []),
        ]);
        setAllOrders(orders);
        setAllQuotes(quotes);
        setAllInvoices(invoices);
        setAllCustomers(customers);
        setJobCostOrders(orders.filter(o => o.actual_cost > 0 || o.actual_labor_cost > 0));
      } catch {}

      setLoading(false);
    }
    load();
  }, []);

  // QB P&L totals for stat cards (single source of truth)
  const [qbPLTotals, setQbPLTotals] = useState(null);

  // Refetch QB data when date filters change
  useEffect(() => {
    if (!qbConnected) return;
    const from = filters.dateFrom || getDateRangeValues(filters.dateRange).dateFrom;
    const to = filters.dateTo || getDateRangeValues(filters.dateRange).dateTo;
    if (!from || !to) return;
    let cancelled = false;
    (async () => {
      const [qbData, plData] = await Promise.all([
        callQbSync("getPerformanceData", { dateFrom: from, dateTo: to }),
        callQbSync("getReport", { reportName: "ProfitAndLoss", startDate: from, endDate: to }),
      ]);
      if (cancelled) return;
      if (!qbData?.error) {
        setRecords(qbData?.revenue ?? []);
        setExpenses(qbData?.expenses ?? []);
      }
      // Extract Total Income and Total Expenses from P&L report
      if (plData && !plData.error) {
        const totals = extractPLTotals(plData);
        setQbPLTotals(totals);
      }
    })();
    return () => { cancelled = true; };
  }, [filters.dateRange, filters.dateFrom, filters.dateTo, qbConnected]);

  function extractPLTotals(report) {
    let totalIncome = 0, totalExpenses = 0, netIncome = 0;
    const rows = report?.Rows?.Row ?? [];
    for (const row of rows) {
      const summary = row.Summary?.ColData;
      const header = row.Header?.ColData;
      const label = (summary?.[0]?.value || header?.[0]?.value || "").toLowerCase();
      const value = Number(summary?.[1]?.value || 0);
      if (label.includes("total income")) totalIncome = value;
      else if (label.includes("total expenses")) totalExpenses = value;
      else if (label.includes("net income") || label.includes("net operating income")) netIncome = value;
    }
    return { totalIncome, totalExpenses, netIncome };
  }

  // ── Date filtering ──
  const filteredRecords = useMemo(() => {
    let filtered = records;
    if (filters.dateRange !== "all" || filters.dateFrom || filters.dateTo) {
      const from = filters.dateFrom || getDateRangeValues(filters.dateRange).dateFrom;
      const to = filters.dateTo || getDateRangeValues(filters.dateRange).dateTo;
      if (from && to) {
        filtered = filtered.filter(r => r.date && r.date >= from && r.date <= to);
      }
    }
    return filtered;
  }, [records, filters]);

  const filteredExpenses = useMemo(() => {
    let filtered = expenses;
    if (filters.dateRange !== "all" || filters.dateFrom || filters.dateTo) {
      const from = filters.dateFrom || getDateRangeValues(filters.dateRange).dateFrom;
      const to = filters.dateTo || getDateRangeValues(filters.dateRange).dateTo;
      if (from && to) {
        filtered = filtered.filter(e => e.payment_date && e.payment_date >= from && e.payment_date <= to);
      }
    }
    if (filters.categoryFilter !== "all") {
      filtered = filtered.filter(e => e.line_items?.some(li => li.category_name === filters.categoryFilter));
    }
    return filtered;
  }, [expenses, filters]);

  // ── KPIs ──
  const localRevenue = useMemo(() => filteredRecords.reduce((s, r) => s + (r.total || 0), 0), [filteredRecords]);
  const localExpenses = useMemo(() => filteredExpenses.reduce((s, e) => s + (e.total || 0), 0), [filteredExpenses]);
  const totalRevenue = qbPLTotals ? qbPLTotals.totalIncome : localRevenue;
  const totalExpenses = qbPLTotals ? qbPLTotals.totalExpenses : localExpenses;
  const profit = qbPLTotals ? qbPLTotals.netIncome : (totalRevenue - totalExpenses);
  const profitMargin = totalRevenue ? ((profit / totalRevenue) * 100).toFixed(1) : 0;
  
  const totalOrders = filteredRecords.length;
  const avgOrderValue = totalOrders ? totalRevenue / totalOrders : 0;

  const uniqueClients = useMemo(() => {
    const names = new Set(filteredRecords.map(r => r.customer_name).filter(Boolean));
    return names.size;
  }, [filteredRecords]);

  // Get unique expense categories
  const expenseCategories = useMemo(() => {
    const cats = new Set();
    expenses.forEach(e => {
      e.line_items?.forEach(li => {
        if (li.category_name) cats.add(li.category_name);
      });
    });
    return Array.from(cats).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [expenses]);

  // ── Orders by status ──
  const byStatus = useMemo(() => {
    const map = {};
    filteredRecords.forEach(r => {
      const s = r.status || "Completed";
      map[s] = (map[s] || 0) + 1;
    });
    return Object.entries(map).map(([name, count]) => ({ name, count }));
  }, [filteredRecords]);

  // ── Top clients by total order value ──
  const topClients = useMemo(() => {
    const map = {};
    filteredRecords.forEach(r => {
      const name = r.customer_name || "Unknown";
      if (!map[name]) map[name] = { name, total: 0, orders: 0 };
      map[name].total += r.total || 0;
      map[name].orders += 1;
    });
    return Object.values(map)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [filteredRecords]);

  // ── Broker performance summary ──
  const brokerSummary = useMemo(() => {
    const map = {};
    filteredRecords.forEach(r => {
      if (!r.broker_id) return;
      const id = r.broker_id;
      if (!map[id]) map[id] = { broker: id, total: 0, orders: 0 };
      map[id].total += r.total || 0;
      map[id].orders += 1;
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [filteredRecords]);

  // ── Native shop stats (no QB required) ──
  const nativeStats = useMemo(() => {
    const dateFrom = filters.dateFrom || getDateRangeValues(filters.dateRange).dateFrom;
    const dateTo = filters.dateTo || getDateRangeValues(filters.dateRange).dateTo;
    return computeNativeStats({
      quotes: allQuotes,
      orders: allOrders,
      invoices: allInvoices,
      customers: allCustomers,
      expenses,
      archived: records,
      dateFrom: filters.dateRange === "all" ? null : dateFrom,
      dateTo: filters.dateRange === "all" ? null : dateTo,
    });
  }, [allQuotes, allOrders, allInvoices, allCustomers, expenses, records, filters.dateRange, filters.dateFrom, filters.dateTo]);

  // ── Expenses by category ──
  const expensesByCategory = useMemo(() => {
    const map = {};
    filteredExpenses.forEach(e => {
      e.line_items?.forEach(li => {
        const cat = li.category_name || "Other";
        map[cat] = (map[cat] || 0) + (li.amount || 0);
      });
    });
    return Object.entries(map)
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [filteredExpenses]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400 text-sm">
        Loading performance data…
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Shop Performance</h2>
          <p className="text-sm text-slate-500 mt-0.5">Revenue, expenses, and profit analysis with filtering.</p>
        </div>
        <div className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${
          qbConnected
            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
            : "bg-slate-50 dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700"
        }`}>
          {qbConnected ? "Synced from QuickBooks" : "Local data"}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-700 overflow-hidden">
        <button
          onClick={() => setFiltersExpanded(!filtersExpanded)}
          className="w-full flex items-center justify-between px-5 py-3 hover:bg-slate-50 dark:bg-slate-800 transition"
        >
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-700">Filters</span>
            {(filters.dateRange !== "all" || filters.categoryFilter !== "all" || filters.dateFrom || filters.dateTo) && (
              <span className="text-xs font-bold bg-indigo-600 text-white px-2 py-0.5 rounded-full">
                {[filters.dateRange !== "all" ? 1 : 0, filters.categoryFilter !== "all" ? 1 : 0, filters.dateFrom ? 1 : 0, filters.dateTo ? 1 : 0].reduce((a, b) => a + b, 0)}
              </span>
            )}
          </div>
          {filtersExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </button>

        {filtersExpanded && (
          <div className="border-t border-slate-200 dark:border-slate-700 px-5 py-4 bg-slate-50 dark:bg-slate-800">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-semibold text-slate-600 uppercase tracking-widest mb-1.5 block">Date</label>
                <Select value={filters.dateRange} onValueChange={(val) => setFilters({ ...filters, dateRange: val, ...getDateRangeValues(val) })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Time</SelectItem>
                    <SelectItem value="today">Today</SelectItem>
                    <SelectItem value="yesterday">Yesterday</SelectItem>
                    <SelectItem value="thisWeek">This Week</SelectItem>
                    <SelectItem value="lastWeek">Last Week</SelectItem>
                    <SelectItem value="thisMonth">This Month</SelectItem>
                    <SelectItem value="lastMonth">Last Month</SelectItem>
                    <SelectItem value="last3Months">Last 3 Months</SelectItem>
                    <SelectItem value="last6Months">Last 6 Months</SelectItem>
                    <SelectItem value="last12Months">Last 12 Months</SelectItem>
                    <SelectItem value="lastYear">Last Year</SelectItem>
                    <SelectItem value="thisYear">This Year</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-600 uppercase tracking-widest mb-1.5 block">Expense Category</label>
                <Select value={filters.categoryFilter} onValueChange={(val) => setFilters({ ...filters, categoryFilter: val })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {expenseCategories.map(cat => (
                      <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="md:col-span-1">
                <label className="text-xs font-semibold text-slate-600 uppercase tracking-widest mb-1.5 block">Custom Date Range</label>
                <div className="flex gap-2 text-xs">
                  <input
                    type="date"
                    value={filters.dateFrom}
                    onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
                    className="flex-1 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  />
                  <input
                    type="date"
                    value={filters.dateTo}
                    onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
                    className="flex-1 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  />
                </div>
              </div>
            </div>

            {(filters.dateRange !== "all" || filters.categoryFilter !== "all" || filters.dateFrom || filters.dateTo) && (
              <button
                onClick={() => setFilters({ dateRange: "all", dateFrom: "", dateTo: "", categoryFilter: "all" })}
                className="mt-4 text-xs font-semibold text-indigo-600 hover:text-indigo-700"
              >
                Clear all filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* Native shop stats — always shown, works without QuickBooks */}
      <NativeStatsPanel stats={nativeStats} />

      {/* QB-augmented KPI cards (only meaningful when QB is connected;
          revenue/expenses/profit will fall back to the archived ShopPerformance
          + Expense rows otherwise, which under-counts in-progress work). */}
      {qbConnected && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <StatCard icon={ShoppingBag} label="Total Orders" value={totalOrders} color="indigo" />
          <StatCard icon={DollarSign} label="Total Revenue (QB)" value={fmtMoney(totalRevenue)} color="emerald" />
          <StatCard icon={TrendingDown} label="Total Expenses (QB)" value={fmtMoney(totalExpenses)} color="amber" />
          <StatCard icon={TrendingUp} label="Profit/Loss (QB)" value={fmtMoney(profit)} color={profit >= 0 ? "emerald" : "rose"} sub={`${profitMargin}% margin`} />
          <StatCard icon={Users} label="Total Clients (period)" value={uniqueClients} color="amber" />
        </div>
      )}

      {/* QuickBooks Reports */}
      {qbConnected && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-700 p-6 space-y-5">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-indigo-600" />
            <h3 className="text-base font-bold text-slate-800 dark:text-slate-200">QuickBooks Reports</h3>
          </div>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-48">
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Report</label>
              <select
                value={selectedReport}
                onChange={(e) => setSelectedReport(e.target.value)}
                className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              >
                {QB_REPORTS.map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">From</label>
              <input type="date" value={reportStartDate} onChange={(e) => setReportStartDate(e.target.value)}
                className="text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">To</label>
              <input type="date" value={reportEndDate} onChange={(e) => setReportEndDate(e.target.value)}
                className="text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            </div>
            <button
              onClick={() => fetchQbReport(selectedReport, reportStartDate, reportEndDate)}
              disabled={qbReportLoading}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-sm font-semibold px-4 py-2 rounded-xl transition"
            >
              <RefreshCw className={`w-4 h-4 ${qbReportLoading ? "animate-spin" : ""}`} />
              {qbReportLoading ? "Loading…" : "Run Report"}
            </button>
          </div>

          {qbReportError && (
            <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              Reports are not yet available — Intuit typically enables full API access within a few days of app approval.
              <a href="https://app.qbo.intuit.com/app/reports" target="_blank" rel="noopener noreferrer"
                className="ml-2 inline-flex items-center gap-1 font-semibold text-indigo-600 hover:underline">
                Open reports in QuickBooks <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}

          {qbReport && (() => {
            const header = qbReport.Header ?? {};
            const columns = qbReport.Columns?.Column ?? [];
            const rows = parseReportRows(qbReport.Rows);
            const summary = qbReport.Summary?.ColData ?? [];
            return (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-slate-800 dark:text-slate-200">{header.ReportName}</div>
                    {header.StartPeriod && <div className="text-xs text-slate-400">{header.StartPeriod} — {header.EndPeriod}</div>}
                  </div>
                  <a href="https://app.qbo.intuit.com/app/reports" target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 border border-indigo-200 px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition">
                    <ExternalLink className="w-3.5 h-3.5" /> Open in QuickBooks
                  </a>
                </div>
                <div className="space-y-0.5 max-h-[500px] overflow-y-auto">
                  {rows.map((row, i) => (
                    <div key={i}
                      className={`grid items-center py-1.5 text-sm rounded-lg px-2 ${
                        row.type === "header" ? "font-bold text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-slate-800 mt-2"
                        : row.type === "total" ? "font-bold text-slate-900 dark:text-slate-100 border-t border-slate-200 dark:border-slate-700 mt-1"
                        : "text-slate-600 hover:bg-slate-50 dark:bg-slate-800"}`}
                      style={{ gridTemplateColumns: `1fr ${row.cols.map(() => "120px").join(" ")}`, paddingLeft: `${(row.depth * 16) + 8}px` }}
                    >
                      <span className="truncate">{row.label}</span>
                      {row.cols.map((col, ci) => (
                        <span key={ci} className="text-right font-mono tabular-nums">
                          {col.value && !isNaN(parseFloat(col.value)) ? fmtMoney(parseFloat(col.value)) : col.value ?? ""}
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
                {summary.length > 0 && summary[0]?.value && (
                  <div className="grid items-center py-2.5 px-3 bg-indigo-50 border border-indigo-100 rounded-xl font-bold text-indigo-900 text-sm"
                    style={{ gridTemplateColumns: `1fr ${summary.slice(1).map(() => "120px").join(" ")}` }}>
                    <span>{summary[0].value}</span>
                    {summary.slice(1).map((col, ci) => (
                      <span key={ci} className="text-right font-mono tabular-nums">
                        {col.value && !isNaN(parseFloat(col.value)) ? fmtMoney(parseFloat(col.value)) : col.value ?? ""}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-6">
        {/* Orders by Status */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-700 p-6">
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-200 mb-4">Orders by Status</h3>
          {byStatus.length === 0 ? (
            <div className="text-slate-400 text-sm py-8 text-center">No data yet.</div>
          ) : (
            <div className="space-y-3">
              {byStatus.map(({ name, count }) => (
                <div key={name} className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-700">{name}</span>
                  <div className="flex items-center gap-3">
                    <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-indigo-500 rounded-full"
                        style={{ width: `${totalOrders ? (count / totalOrders) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="text-sm font-bold text-slate-800 dark:text-slate-200 w-5 text-right">{count}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Expenses by Category */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-700 p-6">
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-200 mb-4">Expenses by Category</h3>
          {expensesByCategory.length === 0 ? (
            <div className="text-slate-400 text-sm py-8 text-center">No expenses recorded yet.</div>
          ) : (
            <div className="space-y-3">
              {expensesByCategory.map(({ name, amount }) => (
                <div key={name} className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-700">{name}</span>
                  <span className="text-sm font-bold text-slate-800 dark:text-slate-200">{fmtMoney(amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Broker Performance Summary */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-700 p-6">
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-200 mb-4">Broker Performance</h3>
          {brokerSummary.length === 0 ? (
            <div className="text-slate-400 text-sm py-8 text-center">No broker orders recorded yet.</div>
          ) : (
            <div className="space-y-3">
              {brokerSummary.map(b => (
                <div key={b.broker} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">{b.broker}</div>
                    <div className="text-xs text-slate-400">{b.orders} order{b.orders !== 1 ? "s" : ""}</div>
                  </div>
                  <div className="text-sm font-bold text-emerald-600 shrink-0">{fmtMoney(b.total)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Top Clients */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-700 p-6">
        <h3 className="text-base font-bold text-slate-800 dark:text-slate-200 mb-4">Top Clients by Revenue</h3>
        {topClients.length === 0 ? (
          <div className="text-slate-400 text-sm py-8 text-center">No data yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-700">
                  <th className="text-left py-2 text-xs font-semibold text-slate-400 uppercase tracking-widest">#</th>
                  <th className="text-left py-2 text-xs font-semibold text-slate-400 uppercase tracking-widest">Customer</th>
                  <th className="text-right py-2 text-xs font-semibold text-slate-400 uppercase tracking-widest">Orders</th>
                  <th className="text-right py-2 text-xs font-semibold text-slate-400 uppercase tracking-widest">Total Revenue</th>
                </tr>
              </thead>
              <tbody>
                {topClients.map((c, i) => (
                  <tr key={c.name} className="border-b border-slate-50">
                    <td className="py-3 text-slate-300 font-bold">{i + 1}</td>
                    <td className="py-3 font-semibold text-slate-800 dark:text-slate-200">{c.name}</td>
                    <td className="py-3 text-right text-slate-500">{c.orders}</td>
                    <td className="py-3 text-right font-bold text-slate-900 dark:text-slate-100">{fmtMoney(c.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Job Costing */}
      {jobCostOrders.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-700 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700">
            <h3 className="text-base font-bold text-slate-800 dark:text-slate-200">Job Costing</h3>
            <p className="text-xs text-slate-400 mt-0.5">Orders with actual costs tracked — quoted vs actual profitability</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase">Order</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase">Customer</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase">Revenue</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase">Material</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase">Labor</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase">Profit</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase">Margin</th>
                </tr>
              </thead>
              <tbody>
                {jobCostOrders.map(o => {
                  const rev = o.total || 0;
                  const mat = o.actual_cost || 0;
                  const lab = o.actual_labor_cost || 0;
                  const profit = rev - mat - lab;
                  const margin = rev > 0 ? ((profit / rev) * 100).toFixed(1) : 0;
                  return (
                    <tr key={o.id} className="border-b border-slate-50 dark:border-slate-800">
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-400">{o.order_id}</td>
                      <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300">{o.customer_name}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-slate-800 dark:text-slate-200">{fmtMoney(rev)}</td>
                      <td className="px-4 py-2.5 text-right text-slate-500">−{fmtMoney(mat)}</td>
                      <td className="px-4 py-2.5 text-right text-slate-500">−{fmtMoney(lab)}</td>
                      <td className={`px-4 py-2.5 text-right font-bold ${profit >= 0 ? "text-emerald-600" : "text-red-600"}`}>{fmtMoney(profit)}</td>
                      <td className={`px-4 py-2.5 text-right text-xs font-semibold ${parseFloat(margin) >= 30 ? "text-emerald-600" : parseFloat(margin) >= 15 ? "text-amber-600" : "text-red-600"}`}>{margin}%</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700">
                  {(() => {
                    const totRev = jobCostOrders.reduce((s, o) => s + (o.total || 0), 0);
                    const totMat = jobCostOrders.reduce((s, o) => s + (o.actual_cost || 0), 0);
                    const totLab = jobCostOrders.reduce((s, o) => s + (o.actual_labor_cost || 0), 0);
                    const totProfit = totRev - totMat - totLab;
                    const totMargin = totRev > 0 ? ((totProfit / totRev) * 100).toFixed(1) : 0;
                    return (
                      <>
                        <td className="px-4 py-3 font-bold text-slate-700 dark:text-slate-300" colSpan={2}>Totals ({jobCostOrders.length} jobs)</td>
                        <td className="px-4 py-3 text-right font-bold text-slate-800 dark:text-slate-200">{fmtMoney(totRev)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-500">−{fmtMoney(totMat)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-500">−{fmtMoney(totLab)}</td>
                        <td className={`px-4 py-3 text-right font-bold ${totProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}>{fmtMoney(totProfit)}</td>
                        <td className={`px-4 py-3 text-right font-bold ${parseFloat(totMargin) >= 30 ? "text-emerald-600" : parseFloat(totMargin) >= 15 ? "text-amber-600" : "text-red-600"}`}>{totMargin}%</td>
                      </>
                    );
                  })()}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* QuickBooks Invoices */}
      {qbConnected && records.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-700 p-6">
          <div className="flex items-center gap-2 mb-4">
            <FileText className="w-5 h-5 text-indigo-600" />
            <h3 className="text-base font-bold text-slate-800 dark:text-slate-200">QuickBooks Invoices</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-700">
                  <th className="text-left py-2 text-xs font-semibold text-slate-400 uppercase tracking-widest">Invoice #</th>
                  <th className="text-left py-2 text-xs font-semibold text-slate-400 uppercase tracking-widest">Date</th>
                  <th className="text-left py-2 text-xs font-semibold text-slate-400 uppercase tracking-widest">Customer</th>
                  <th className="text-right py-2 text-xs font-semibold text-slate-400 uppercase tracking-widest">Amount</th>
                  <th className="text-right py-2 text-xs font-semibold text-slate-400 uppercase tracking-widest">Balance</th>
                  <th className="text-right py-2 text-xs font-semibold text-slate-400 uppercase tracking-widest">Status</th>
                </tr>
              </thead>
              <tbody>
                {[...records].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).slice(0, 50).map((inv) => (
                  <tr key={inv.id} className="border-b border-slate-50 hover:bg-slate-50 dark:bg-slate-800">
                    <td className="py-3 text-slate-500 font-mono">{inv.invoice_id || inv.id}</td>
                    <td className="py-3 text-slate-600">{inv.date}</td>
                    <td className="py-3 font-medium text-slate-800 dark:text-slate-200">{inv.customer_name}</td>
                    <td className="py-3 text-right font-bold text-slate-900 dark:text-slate-100">{fmtMoney(inv.total)}</td>
                    <td className="py-3 text-right text-slate-500">{fmtMoney(inv.balance ?? 0)}</td>
                    <td className="py-3 text-right">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        inv.paid
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-amber-50 text-amber-700"
                      }`}>
                        {inv.paid ? "Paid" : "Outstanding"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}