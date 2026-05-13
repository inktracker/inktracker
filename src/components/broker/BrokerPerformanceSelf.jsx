import { useMemo, useState, useEffect } from "react";
import { base44 } from "@/api/supabaseClient";
import { fmtMoney } from "../shared/pricing";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Package, DollarSign, TrendingUp, CheckCircle2, Clock, Layers } from "lucide-react";

// Bucket the 5-stage O_STATUSES pipeline (Art Approval → Order Goods
// → Pre-Press → Printing → Completed) into three analytics buckets.
// Pre-Press lives in "pending" because that's still pre-production
// planning; Printing is the only active production stage now that
// Finishing and QC were collapsed into it.
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

export default function BrokerPerformanceSelf({ orders, brokerEmail }) {
  const [persistedRecords, setPersistedRecords] = useState([]);

  useEffect(() => {
    if (!brokerEmail) return;
    base44.entities.BrokerPerformance.filter({ broker_id: brokerEmail }, "-date", 500)
      .then(setPersistedRecords)
      .catch(() => {});
  }, [brokerEmail]);

  // Combine live orders + persisted completed records (deduplicate by order_id)
  const liveOrderIds = new Set(orders.map(o => o.order_id).filter(Boolean));
  const historicalOnly = persistedRecords.filter(r => !liveOrderIds.has(r.order_id));
  // For historical records, treat as "completed" status for classification
  const historicalAsOrders = historicalOnly.map(r => ({ ...r, status: "Completed" }));
  const allOrders = [...orders, ...historicalAsOrders];

  const totalRevenue = allOrders.reduce((s, o) => s + (o.total || 0), 0);
  const avgOrderValue = allOrders.length ? totalRevenue / allOrders.length : 0;
  const pending = orders.filter(o => classifyStatus(o.status) === "pending").length;
  const production = orders.filter(o => classifyStatus(o.status) === "production").length;
  const completed = allOrders.filter(o => classifyStatus(o.status) === "completed").length;
  const monthlyData = useMemo(() => getMonthlyData(allOrders), [allOrders]);

  const completionRate = allOrders.length ? Math.round((completed / allOrders.length) * 100) : 0;

  return (
    <div className="space-y-5">
      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <Package className="w-4 h-4 text-indigo-500" />
            <div className="text-xs font-semibold text-indigo-500 uppercase tracking-widest">Total Orders</div>
          </div>
          <div className="text-2xl font-bold text-indigo-700">{allOrders.length}</div>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign className="w-4 h-4 text-emerald-500" />
            <div className="text-xs font-semibold text-emerald-500 uppercase tracking-widest">Revenue Generated</div>
          </div>
          <div className="text-2xl font-bold text-emerald-700">{fmtMoney(totalRevenue)}</div>
        </div>
        <div className="bg-violet-50 border border-violet-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="w-4 h-4 text-violet-500" />
            <div className="text-xs font-semibold text-violet-500 uppercase tracking-widest">Avg. Order Value</div>
          </div>
          <div className="text-2xl font-bold text-violet-700">{fmtMoney(avgOrderValue)}</div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 className="w-4 h-4 text-amber-500" />
            <div className="text-xs font-semibold text-amber-500 uppercase tracking-widest">Completion Rate</div>
          </div>
          <div className="text-2xl font-bold text-amber-700">{completionRate}%</div>
        </div>
      </div>

      {/* Status breakdown */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5">
        <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
          <Layers className="w-4 h-4" /> Order Status Breakdown
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center">
            <div className="text-3xl font-bold text-yellow-600">{pending}</div>
            <div className="flex items-center justify-center gap-1 mt-1">
              <Clock className="w-3 h-3 text-yellow-500" />
              <span className="text-xs font-semibold text-yellow-600">Pending</span>
            </div>
            <div className="text-xs text-slate-400 mt-0.5">Art Approval / Pre-Press</div>
          </div>
          <div className="text-center border-x border-slate-100">
            <div className="text-3xl font-bold text-blue-600">{production}</div>
            <div className="flex items-center justify-center gap-1 mt-1">
              <Package className="w-3 h-3 text-blue-500" />
              <span className="text-xs font-semibold text-blue-600">In Production</span>
            </div>
            <div className="text-xs text-slate-400 mt-0.5">Printing</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-emerald-600">{completed}</div>
            <div className="flex items-center justify-center gap-1 mt-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-500" />
              <span className="text-xs font-semibold text-emerald-600">Completed</span>
            </div>
            <div className="text-xs text-slate-400 mt-0.5">Pickup / Done</div>
          </div>
        </div>

        {/* Progress bar */}
        {allOrders.length > 0 && (
          <div className="mt-4 flex h-3 rounded-full overflow-hidden gap-px">
            {pending > 0 && (
              <div className="bg-yellow-400 transition-all" style={{ width: `${(pending / allOrders.length) * 100}%` }} />
            )}
            {production > 0 && (
              <div className="bg-blue-500 transition-all" style={{ width: `${(production / allOrders.length) * 100}%` }} />
            )}
            {completed > 0 && (
              <div className="bg-emerald-500 transition-all" style={{ width: `${(completed / allOrders.length) * 100}%` }} />
            )}
          </div>
        )}
      </div>

      {/* Monthly trend chart */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5">
        <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
          <TrendingUp className="w-4 h-4" /> Monthly Activity (Last 12 Months)
        </div>
        {monthlyData.length === 0 ? (
          <div className="text-sm text-slate-400 text-center py-10">
            No order history yet — your activity will appear here as you submit orders.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={monthlyData} margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="right" orientation="right" tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(val, name) => name === "Revenue" ? fmtMoney(val) : val} />
              <Legend />
              <Bar yAxisId="left" dataKey="orders" name="Orders" fill="#6366f1" radius={[4, 4, 0, 0]} />
              <Bar yAxisId="right" dataKey="revenue" name="Revenue" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Motivational nudge */}
      {allOrders.length === 0 && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-6 text-center">
          <TrendingUp className="w-10 h-10 text-indigo-300 mx-auto mb-2" />
          <div className="font-semibold text-indigo-800">Your performance dashboard is ready!</div>
          <div className="text-sm text-indigo-600 mt-1">Submit your first order and watch your stats grow.</div>
        </div>
      )}
    </div>
  );
}