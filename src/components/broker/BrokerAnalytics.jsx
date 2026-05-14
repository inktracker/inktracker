import { useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { TrendingUp, FileText, CheckCircle2, DollarSign } from "lucide-react";
import { calcQuoteTotals, BROKER_MARKUP, fmtMoney } from "../shared/pricing";
import { filterByPeriod, pipelineCounts, performanceMetrics } from "@/lib/broker/analytics";

const STATUS_COLORS = {
  Draft:    "#94a3b8",
  Pending:  "#f59e0b",
  Approved: "#10b981",
  Declined: "#f87171",
};

const PERIODS = [
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
  { label: "Last 12 months", days: 365 },
  { label: "All time", days: null },
];

export default function BrokerAnalytics({ quotes }) {
  const [period, setPeriod] = useState(90);

  const filteredQuotes = useMemo(() => filterByPeriod(quotes, period), [quotes, period]);

  // Pipeline bar chart data (colors are UI-only, added post-hoc).
  const pipelineData = useMemo(
    () => pipelineCounts(filteredQuotes).map((bucket) => ({
      ...bucket,
      color: STATUS_COLORS[bucket.status],
    })),
    [filteredQuotes],
  );

  // Performance metrics — broker-priced totals via BROKER_MARKUP.
  const metrics = useMemo(
    () => performanceMetrics(filteredQuotes, (q) => calcQuoteTotals(q, BROKER_MARKUP)),
    [filteredQuotes],
  );

  return (
    <div className="space-y-4">
      {/* Period selector */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-slate-800">Performance Overview</h2>
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
          {PERIODS.map(p => (
            <button
              key={p.label}
              onClick={() => setPeriod(p.days)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition ${
                period === p.days
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 bg-indigo-100 rounded-lg flex items-center justify-center">
              <FileText className="w-4 h-4 text-indigo-600" />
            </div>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Total Quotes</span>
          </div>
          <div className="text-2xl font-bold text-slate-900">{metrics.total}</div>
          <div className="text-xs text-slate-400 mt-0.5">{metrics.approved} approved</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 bg-emerald-100 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-emerald-600" />
            </div>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Conversion</span>
          </div>
          <div className="text-2xl font-bold text-slate-900">{metrics.conversionRate}%</div>
          <div className="text-xs text-slate-400 mt-0.5">quotes → approved</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 bg-amber-100 rounded-lg flex items-center justify-center">
              <DollarSign className="w-4 h-4 text-amber-600" />
            </div>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Avg. Value</span>
          </div>
          <div className="text-2xl font-bold text-slate-900">{fmtMoney(metrics.avgValue)}</div>
          <div className="text-xs text-slate-400 mt-0.5">per quote</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 bg-violet-100 rounded-lg flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4 text-violet-600" />
            </div>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Total Value</span>
          </div>
          <div className="text-2xl font-bold text-slate-900">{fmtMoney(metrics.totalValue)}</div>
          <div className="text-xs text-slate-400 mt-0.5">all quotes</div>
        </div>
      </div>

      {/* Pipeline chart */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5">
        <div className="text-sm font-bold text-slate-700 mb-4">Quote Pipeline by Status</div>
        {filteredQuotes.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-slate-400 text-sm">No quotes in this period.</div>
        ) : (
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={pipelineData} barSize={40} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <XAxis dataKey="status" tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <Tooltip
                cursor={{ fill: "#f1f5f9" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload;
                  return (
                    <div className="bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-lg text-sm">
                      <span className="font-semibold text-slate-800">{d.status}</span>
                      <span className="ml-2 text-slate-500">{d.count} quote{d.count !== 1 ? "s" : ""}</span>
                    </div>
                  );
                }}
              />
              <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                {pipelineData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}

        {/* Legend */}
        <div className="flex flex-wrap gap-3 mt-3 border-t border-slate-100 pt-3">
          {pipelineData.map(d => (
            <div key={d.status} className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
              <span className="text-xs text-slate-500 font-medium">{d.status} ({d.count})</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}