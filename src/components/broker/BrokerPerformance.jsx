import { useMemo, useState } from "react";
import { TrendingUp, DollarSign, Package } from "lucide-react";
import {
  calcQuoteTotals,
  fmtMoney,
  fmtDate,
  BROKER_MARKUP,
  STANDARD_MARKUP,
} from "../shared/pricing";
import { getDateRangeValues } from "@/lib/dateRangeUtils";

function StatCard({ icon: Icon, label, value, sub, color = "indigo" }) {
  const colors = {
    indigo: "bg-indigo-50 text-indigo-600",
    emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    rose: "bg-rose-50 text-rose-600",
  };
  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5 flex items-start gap-4">
      <div className={`p-2.5 rounded-xl ${colors[color]}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <div className="text-2xl font-bold text-slate-900">{value}</div>
        <div className="text-sm font-semibold text-slate-500">{label}</div>
        {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

export default function BrokerPerformance({ orders = [] }) {
  const [dateRange, setDateRange] = useState("thisMonth");
  const { dateFrom, dateTo } = getDateRangeValues(dateRange);

  const filtered = useMemo(() => {
    if (!dateFrom || !dateTo) return orders;
    return orders.filter((o) => o.date && o.date >= dateFrom && o.date <= dateTo);
  }, [orders, dateFrom, dateTo]);

  const rows = useMemo(() => {
    return filtered.map((o) => {
      // Broker's wholesale cost (what they paid the shop)
      const brokerTotals = calcQuoteTotals(o, BROKER_MARKUP);
      // Client-facing revenue: honors per-line clientPpp overrides,
      // falls back to STANDARD_MARKUP when no override is set.
      const clientTotals = calcQuoteTotals(o, STANDARD_MARKUP);
      const cost = Number(brokerTotals.total) || 0;
      const revenue = Number(clientTotals.total) || 0;
      const profit = revenue - cost;
      const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
      return { order: o, cost, revenue, profit, margin };
    });
  }, [filtered]);

  const totals = rows.reduce(
    (acc, r) => ({
      count: acc.count + 1,
      cost: acc.cost + r.cost,
      revenue: acc.revenue + r.revenue,
      profit: acc.profit + r.profit,
    }),
    { count: 0, cost: 0, revenue: 0, profit: 0 }
  );
  const avgMargin = totals.revenue > 0 ? (totals.profit / totals.revenue) * 100 : 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Performance</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Your revenue, cost, and profit on completed orders.
          </p>
        </div>

        <div className="flex gap-2 items-center">
          <label className="text-xs font-semibold text-slate-500">Range</label>
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
          >
            <option value="all">All Time</option>
            <option value="today">Today</option>
            <option value="thisWeek">This Week</option>
            <option value="thisMonth">This Month</option>
            <option value="lastMonth">Last Month</option>
            <option value="last3Months">Last 3 Months</option>
            <option value="thisYear">This Year</option>
            <option value="lastYear">Last Year</option>
          </select>
        </div>
      </div>

      <div className="grid gap-4 grid-cols-1 md:grid-cols-4">
        <StatCard icon={Package} label="Orders" value={totals.count} color="indigo" />
        <StatCard
          icon={DollarSign}
          label="Client Revenue"
          value={fmtMoney(totals.revenue)}
          sub="What your clients paid"
          color="emerald"
        />
        <StatCard
          icon={DollarSign}
          label="Your Cost"
          value={fmtMoney(totals.cost)}
          sub="What you paid the shop"
          color="amber"
        />
        <StatCard
          icon={TrendingUp}
          label="Profit"
          value={fmtMoney(totals.profit)}
          sub={`${avgMargin.toFixed(1)}% margin`}
          color={totals.profit >= 0 ? "emerald" : "rose"}
        />
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <div className="text-sm font-bold text-slate-800">Orders in range</div>
          <div className="text-xs text-slate-400">
            {totals.count} {totals.count === 1 ? "order" : "orders"}
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-400">
            No orders in this date range.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500 uppercase tracking-wide">
                  <th className="px-4 py-2.5 text-left font-semibold">Order</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Date</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Client</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Revenue</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Cost</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Profit</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Margin</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ order, cost, revenue, profit, margin }) => (
                  <tr key={order.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{order.order_id}</td>
                    <td className="px-4 py-2.5 text-slate-500">{fmtDate(order.date)}</td>
                    <td className="px-4 py-2.5 text-slate-700">
                      {order.broker_client_name || order.customer_name || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-emerald-700">{fmtMoney(revenue)}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500">{fmtMoney(cost)}</td>
                    <td className={`px-4 py-2.5 text-right font-bold ${profit >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
                      {fmtMoney(profit)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-500 text-xs">
                      {margin.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
