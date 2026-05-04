// Native shop stats panel — works without QuickBooks. Fed by
// computeNativeStats() in @/lib/nativeStats. Shows current-state metrics
// (pipeline, outstanding) alongside in-period metrics (revenue, conversion).

import {
  TrendingUp, TrendingDown, DollarSign, FileText, Receipt, ShoppingBag,
  Users, Repeat, Layers,
} from "lucide-react";
import { fmtMoney } from "@/components/shared/pricing";

function pct(n, digits = 0) {
  if (n == null) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

function StatTile({ icon: Icon, label, value, sub, color = "indigo" }) {
  const colors = {
    indigo:  "bg-indigo-50 text-indigo-600",
    emerald: "bg-emerald-50 text-emerald-600",
    amber:   "bg-amber-50 text-amber-600",
    rose:    "bg-rose-50 text-rose-600",
    slate:   "bg-slate-100 text-slate-600",
    violet:  "bg-violet-50 text-violet-600",
  };
  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-700 p-4 flex items-start gap-3">
      <div className={`p-2 rounded-xl ${colors[color] || colors.indigo}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xl font-bold text-slate-900 dark:text-slate-100 truncate">{value}</div>
        <div className="text-xs font-semibold text-slate-500">{label}</div>
        {sub && <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

export default function NativeStatsPanel({ stats }) {
  if (!stats) return null;

  const {
    revenue, completedCount, aov,
    activePipeline, activePipelineCount,
    quotePipelineValue, quotePipelineCount,
    outstanding, outstandingCount,
    conversionRate, conversionSentCount, conversionConvertedCount,
    newCustomers, repeatRate, repeatCustomersCount, customersWithAnyOrder,
    topCustomers, activeStatusList,
    expensesTotal, grossProfit, profitMargin,
  } = stats;

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-200">Shop Snapshot</h3>
          <p className="text-xs text-slate-500">Computed from your quotes, orders, and invoices — no QuickBooks needed.</p>
        </div>
      </div>

      {/* Current state — not date-bound */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatTile
          icon={ShoppingBag} color="indigo"
          label="Active orders"
          value={fmtMoney(activePipeline)}
          sub={`${activePipelineCount} in production`}
        />
        <StatTile
          icon={FileText} color="violet"
          label="Quote pipeline"
          value={fmtMoney(quotePipelineValue)}
          sub={`${quotePipelineCount} sent, awaiting response`}
        />
        <StatTile
          icon={Receipt} color="amber"
          label="Outstanding"
          value={fmtMoney(outstanding)}
          sub={`${outstandingCount} unpaid invoice${outstandingCount === 1 ? "" : "s"}`}
        />
      </div>

      {/* In-period metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile
          icon={DollarSign} color="emerald"
          label="Revenue (period)"
          value={fmtMoney(revenue)}
          sub={`${completedCount} completed order${completedCount === 1 ? "" : "s"}`}
        />
        <StatTile
          icon={TrendingDown} color="amber"
          label="Expenses (period)"
          value={fmtMoney(expensesTotal)}
        />
        <StatTile
          icon={TrendingUp} color={grossProfit >= 0 ? "emerald" : "rose"}
          label="Gross profit"
          value={fmtMoney(grossProfit)}
          sub={profitMargin != null ? `${pct(profitMargin, 1)} margin` : "—"}
        />
        <StatTile
          icon={Layers} color="slate"
          label="Avg. order value"
          value={fmtMoney(aov)}
        />
      </div>

      {/* Conversion + customers */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatTile
          icon={TrendingUp} color="emerald"
          label="Quote conversion"
          value={pct(conversionRate, 0)}
          sub={`${conversionConvertedCount} of ${conversionSentCount} sent quotes`}
        />
        <StatTile
          icon={Users} color="indigo"
          label="New customers"
          value={String(newCustomers)}
          sub="this period"
        />
        <StatTile
          icon={Repeat} color="violet"
          label="Repeat customer %"
          value={pct(repeatRate, 0)}
          sub={`${repeatCustomersCount} of ${customersWithAnyOrder} ordered more than once`}
        />
      </div>

      {/* Side-by-side: active orders by status, top customers */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-700 p-5">
          <h4 className="text-sm font-bold text-slate-700 mb-3">Active orders by status</h4>
          {activeStatusList.length === 0 ? (
            <p className="text-xs text-slate-400 italic">Nothing in production right now.</p>
          ) : (
            <ul className="space-y-1.5">
              {activeStatusList.map((row) => (
                <li key={row.status} className="flex justify-between text-sm">
                  <span className="text-slate-600">{row.status}</span>
                  <span className="font-bold text-slate-800">{row.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-700 p-5">
          <h4 className="text-sm font-bold text-slate-700 mb-3">Top customers (period)</h4>
          {topCustomers.length === 0 ? (
            <p className="text-xs text-slate-400 italic">No completed orders in this period yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {topCustomers.map((row) => (
                <li key={row.name} className="flex justify-between text-sm">
                  <span className="text-slate-600 truncate mr-2">{row.name}</span>
                  <span className="font-bold text-slate-800 shrink-0">{fmtMoney(row.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
