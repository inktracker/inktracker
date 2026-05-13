import { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/supabaseClient";
import { fmtMoney } from "../shared/pricing";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { TrendingUp, Package, DollarSign, ChevronDown, ChevronUp } from "lucide-react";

// Mirror of BrokerPerformanceSelf — buckets the slim 5-stage pipeline
// into pending / production / completed for analytics rollup.
const ORDER_STATUSES_PENDING    = ["Art Approval", "Order Goods", "Pre-Press"];
const ORDER_STATUSES_PRODUCTION = ["Printing"];
const ORDER_STATUSES_COMPLETE   = ["Completed"];

function classifyStatus(status) {
  if (ORDER_STATUSES_PENDING.includes(status)) return "pending";
  if (ORDER_STATUSES_PRODUCTION.includes(status)) return "production";
  if (ORDER_STATUSES_COMPLETE.includes(status)) return "completed";
  return "pending";
}

function getMonthlyData(orders) {
  const map = {};
  orders.forEach(o => {
    const d = o.date || o.created_date?.split("T")[0];
    if (!d) return;
    const key = d.slice(0, 7); // YYYY-MM
    if (!map[key]) map[key] = { month: key, orders: 0, revenue: 0 };
    map[key].orders += 1;
    map[key].revenue += o.total || 0;
  });
  return Object.values(map)
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-12)
    .map(m => ({ ...m, month: m.month.slice(5) + "/" + m.month.slice(2, 4) }));
}

function BrokerRow({ broker, orders }) {
  const [expanded, setExpanded] = useState(false);
  const brokerOrders = orders.filter(o => o.broker_id === broker.email);
  const totalRevenue = brokerOrders.reduce((s, o) => s + (o.total || 0), 0);
  const avgOrderValue = brokerOrders.length ? totalRevenue / brokerOrders.length : 0;
  const pending = brokerOrders.filter(o => classifyStatus(o.status) === "pending").length;
  const production = brokerOrders.filter(o => classifyStatus(o.status) === "production").length;
  const completed = brokerOrders.filter(o => classifyStatus(o.status) === "completed").length;
  const monthlyData = useMemo(() => getMonthlyData(brokerOrders), [brokerOrders]);

  return (
    <>
      <tr
        className="border-b border-slate-100 hover:bg-slate-50 transition cursor-pointer"
        onClick={() => setExpanded(e => !e)}
      >
        <td className="px-4 py-3">
          <div className="font-semibold text-slate-800 text-sm">{broker.display_name || broker.full_name || broker.email}</div>
          <div className="text-xs text-slate-400">{broker.email}</div>
        </td>
        <td className="px-4 py-3 text-sm text-slate-600">{broker.company_name || "—"}</td>
        <td className="px-4 py-3 text-sm text-slate-500 text-xs">{(broker.assigned_shops || []).join(", ") || "—"}</td>
        <td className="px-4 py-3 font-bold text-slate-800 text-center">{brokerOrders.length}</td>
        <td className="px-4 py-3 font-semibold text-indigo-700">{fmtMoney(totalRevenue)}</td>
        <td className="px-4 py-3 text-sm text-slate-600">{fmtMoney(avgOrderValue)}</td>
        <td className="px-4 py-3">
          <div className="flex gap-1.5 flex-wrap">
            <span className="text-xs font-semibold bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">{pending} Pending</span>
            <span className="text-xs font-semibold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{production} In Prod</span>
            <span className="text-xs font-semibold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">{completed} Done</span>
          </div>
        </td>
        <td className="px-4 py-3 text-slate-400">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-slate-50 border-b border-slate-200">
          <td colSpan={8} className="px-6 py-5">
            {monthlyData.length === 0 ? (
              <div className="text-sm text-slate-400 text-center py-6">No order history yet.</div>
            ) : (
              <div>
                <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Monthly Activity (Last 12 Months)</div>
                <ResponsiveContainer width="100%" height={180}>
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
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export default function BrokerPerformanceAdmin({ shopOwner }) {
  const [brokers, setBrokers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [allUsers, allOrders] = await Promise.all([
        base44.entities.User.list(),
        base44.entities.Order.filter({ shop_owner: shopOwner }, "-created_date", 500),
      ]);
      setBrokers(allUsers.filter(u => u.role === "broker"));
      setOrders(allOrders.filter(o => o.broker_id));
      setLoading(false);
    }
    load();
  }, [shopOwner]);

  const totalRevenue = orders.reduce((s, o) => s + (o.total || 0), 0);
  const totalOrders = orders.length;

  if (loading) return <div className="text-sm text-slate-400">Loading performance data…</div>;

  return (
    <div className="space-y-5">
      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 flex items-center gap-3">
          <Package className="w-8 h-8 text-indigo-400" />
          <div>
            <div className="text-xs font-semibold text-indigo-500 uppercase tracking-widest">Total Broker Orders</div>
            <div className="text-2xl font-bold text-indigo-700">{totalOrders}</div>
          </div>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center gap-3">
          <DollarSign className="w-8 h-8 text-emerald-400" />
          <div>
            <div className="text-xs font-semibold text-emerald-500 uppercase tracking-widest">Total Revenue</div>
            <div className="text-2xl font-bold text-emerald-700">{fmtMoney(totalRevenue)}</div>
          </div>
        </div>
        <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 flex items-center gap-3">
          <TrendingUp className="w-8 h-8 text-violet-400" />
          <div>
            <div className="text-xs font-semibold text-violet-500 uppercase tracking-widest">Active Brokers</div>
            <div className="text-2xl font-bold text-violet-700">{brokers.length}</div>
          </div>
        </div>
      </div>

      {/* Broker table */}
      {brokers.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl py-16 text-center text-slate-400 text-sm">
          No brokers assigned yet.
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                {["Broker", "Company", "Assigned Shop", "Orders", "Revenue", "Avg. Order", "Status Breakdown", ""].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-widest">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {brokers.map(broker => (
                <BrokerRow key={broker.id} broker={broker} orders={orders} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}