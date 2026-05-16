import { useState, useMemo } from "react";
import {
  fmtMoney,
  fmtDate,
  calcQuoteTotals,
  BROKER_MARKUP,
  STANDARD_MARKUP,
} from "../shared/pricing";
import {
  FileText,
  DollarSign,
  TrendingUp,
  CheckCircle2,
  Search,
  ChevronRight,
  X,
  Download,
  Calendar,
  User,
  Hash,
  ArrowUpRight,
  Package,
  Clock,
} from "lucide-react";
import { exportQuoteToPDF } from "../shared/pdfExport";
import ModalBackdrop from "../shared/ModalBackdrop";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

import { buildMonthlyChart } from "@/lib/broker/invoicesAggregation";
import {
  assembleCompletedJobs,
  filterJobsByDate,
  filterJobsBySearch,
  sortJobs,
  computeJobKpis,
} from "@/lib/broker/brokerJobs";

function JobDetailDrawer({ job, onClose }) {
  const brokerTotals = job._brokerTotal || 0;
  const clientTotals = job._clientTotal || 0;

  return (
    <ModalBackdrop onClose={onClose} z="z-50" bg="bg-slate-900/50" layout="slide-right">
      <div className="bg-white w-full max-w-lg h-full overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50 sticky top-0 z-10">
          <div>
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
              {job.order_id || job.quote_id || "Job"}
            </div>
            <div className="font-bold text-slate-900 text-lg">
              {job.customer_name || "—"}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700">
              <CheckCircle2 className="w-3 h-3" /> Completed
            </span>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* Meta grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
              <div className="flex items-center gap-1.5 mb-0.5">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                <div className="text-xs text-slate-400 font-semibold uppercase tracking-wide">Job Date</div>
              </div>
              <div className="font-semibold text-slate-800">{fmtDate(job.date)}</div>
            </div>
            <div className="bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
              <div className="flex items-center gap-1.5 mb-0.5">
                <Hash className="w-3.5 h-3.5 text-slate-400" />
                <div className="text-xs text-slate-400 font-semibold uppercase tracking-wide">Job ID</div>
              </div>
              <div className="font-semibold text-slate-800 font-mono text-sm">{job.order_id || job.quote_id || "—"}</div>
            </div>
            {job.due_date && (
              <div className="bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  <div className="text-xs text-slate-400 font-semibold uppercase tracking-wide">Due / In-Hands</div>
                </div>
                <div className="font-semibold text-slate-800">{fmtDate(job.due_date)}</div>
              </div>
            )}
            {job.customer_name && (
              <div className="bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <User className="w-3.5 h-3.5 text-slate-400" />
                  <div className="text-xs text-slate-400 font-semibold uppercase tracking-wide">Client</div>
                </div>
                <div className="font-semibold text-slate-800">{job.customer_name}</div>
              </div>
            )}
          </div>

          {/* Line items */}
          {(job.line_items || []).length > 0 && (
            <div>
              <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Line Items</div>
              <div className="space-y-2">
                {job.line_items.map((li, i) => {
                  const qty = Object.values(li.sizes || {}).reduce((s, v) => s + (parseInt(v) || 0), 0);
                  return (
                    <div key={li.id || i} className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-semibold text-slate-800 text-sm">{li.style || "Garment"}</div>
                          {li.brand && <div className="text-xs text-slate-400">{li.brand}</div>}
                          {li.garmentColor && <div className="text-xs text-slate-400">{li.garmentColor}</div>}
                        </div>
                        <div className="text-xs font-semibold text-slate-600 bg-slate-200 rounded-full px-2 py-0.5">Qty: {qty}</div>
                      </div>
                      {(li.imprints || []).filter((imp) => imp.colors > 0).map((imp, j) => (
                        <div key={j} className="mt-1.5 text-xs text-slate-500 flex flex-wrap gap-2">
                          <span className="font-semibold text-slate-700">{imp.location}</span>
                          <span>·</span>
                          <span>{imp.colors} color{imp.colors !== 1 ? "s" : ""}</span>
                          <span>·</span>
                          <span>{imp.technique}</span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {job.notes && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
              <span className="font-semibold">Notes: </span>{job.notes}
            </div>
          )}

          {/* Financials */}
          <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-2">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">Financials</div>
            <div className="flex justify-between font-bold text-slate-900 text-lg">
              <span>Your Broker Price</span>
              <span>{fmtMoney(brokerTotals)}</span>
            </div>
            <div className="flex justify-between text-sm text-violet-600 font-semibold border-t border-slate-200 pt-2">
              <span>Client Total</span>
              <span>{fmtMoney(clientTotals)}</span>
            </div>
            {clientTotals > brokerTotals && (
              <div className="flex justify-between text-sm text-emerald-600 font-semibold">
                <span>Your Margin</span>
                <span>+{fmtMoney(clientTotals - brokerTotals)}</span>
              </div>
            )}
          </div>

          {/* Downloads */}
          {job._rawQuote && (
            <div>
              <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Downloads</div>
              <div className="flex gap-2">
                <button
                  onClick={() => exportQuoteToPDF(job._rawQuote, "", "", "", "", "", "shop")}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-semibold border border-slate-200 text-slate-600 py-2 rounded-xl hover:bg-slate-100 transition"
                >
                  <Download className="w-3.5 h-3.5" /> Shop Form
                </button>
                <button
                  onClick={() => exportQuoteToPDF(job._rawQuote, "", "", "", "", "", "client")}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-semibold border border-slate-200 text-slate-600 py-2 rounded-xl hover:bg-slate-100 transition"
                >
                  <Download className="w-3.5 h-3.5" /> Client Form
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 pb-6">
          <button
            onClick={onClose}
            className="w-full border border-slate-200 text-slate-600 text-sm font-semibold py-2 rounded-xl hover:bg-slate-100 transition"
          >
            Close
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

export default function BrokerInvoicesTab({ orders, quotes, brokerEmail }) {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("date_desc");
  const [selectedJob, setSelectedJob] = useState(null);
  const [dateFilter, setDateFilter] = useState("all");

  // Build completed jobs list from orders + converted quotes.
  // (The order pipeline was slimmed to 5 stages on 2026-05-12 —
  // "Ready for Pickup" is gone; everything done is now just
  // "Completed".)
  const completedJobs = useMemo(
    () => assembleCompletedJobs(orders, quotes, {
      calcBroker: (q) => calcQuoteTotals(q, BROKER_MARKUP),
      calcClient: (q) => calcQuoteTotals(q, STANDARD_MARKUP),
    }),
    [orders, quotes],
  );

  // Stats
  const { totalRevenue, totalMargin, avgJobValue } = useMemo(
    () => computeJobKpis(completedJobs),
    [completedJobs],
  );
  const monthlyData = useMemo(() => buildMonthlyChart(completedJobs), [completedJobs]);

  // Filter by date range
  const dateFilteredJobs = useMemo(
    () => filterJobsByDate(completedJobs, dateFilter),
    [completedJobs, dateFilter],
  );

  // Search + sort
  const displayJobs = useMemo(
    () => sortJobs(filterJobsBySearch(dateFilteredJobs, search), sortBy),
    [dateFilteredJobs, search, sortBy],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Invoices & Job History</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          A record of all your completed jobs with financials and downloadable forms.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <Package className="w-4 h-4 text-indigo-500" />
            <div className="text-xs font-semibold text-indigo-500 uppercase tracking-widest">Total Jobs</div>
          </div>
          <div className="text-2xl font-bold text-indigo-700">{completedJobs.length}</div>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign className="w-4 h-4 text-emerald-500" />
            <div className="text-xs font-semibold text-emerald-500 uppercase tracking-widest">Your Revenue</div>
          </div>
          <div className="text-2xl font-bold text-emerald-700">{fmtMoney(totalRevenue)}</div>
        </div>
        <div className="bg-violet-50 border border-violet-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="w-4 h-4 text-violet-500" />
            <div className="text-xs font-semibold text-violet-500 uppercase tracking-widest">Avg. Job Value</div>
          </div>
          <div className="text-2xl font-bold text-violet-700">{fmtMoney(avgJobValue)}</div>
        </div>
        <div className="bg-teal-50 border border-teal-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <ArrowUpRight className="w-4 h-4 text-teal-500" />
            <div className="text-xs font-semibold text-teal-500 uppercase tracking-widest">Total Margin</div>
          </div>
          <div className="text-2xl font-bold text-teal-700">{fmtMoney(totalMargin)}</div>
        </div>
      </div>

      {/* Chart */}
      {monthlyData.length > 1 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4" /> Revenue Trend (Last 12 Months)
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={monthlyData} margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(val) => fmtMoney(val)} labelFormatter={(l) => l} />
              <Area
                type="monotone"
                dataKey="revenue"
                name="Revenue"
                stroke="#6366f1"
                strokeWidth={2}
                fill="url(#revenueGrad)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Filters + Search */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by client or job ID…"
              className="w-full pl-9 pr-4 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>
          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
          >
            <option value="all">All Time</option>
            <option value="30d">Last 30 Days</option>
            <option value="90d">Last 90 Days</option>
            <option value="year">This Year</option>
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
          >
            <option value="date_desc">Newest First</option>
            <option value="date_asc">Oldest First</option>
            <option value="value_desc">Highest Value</option>
            <option value="value_asc">Lowest Value</option>
          </select>
        </div>

        {/* Job list */}
        {displayJobs.length === 0 ? (
          <div className="py-16 text-center">
            <FileText className="w-12 h-12 text-slate-200 mx-auto mb-3" />
            <p className="text-slate-400 text-sm font-medium">
              {completedJobs.length === 0
                ? "No completed jobs yet. Jobs will appear here once orders are finished."
                : "No results match your search."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {/* Header row */}
            <div className="hidden sm:grid grid-cols-12 gap-2 px-3 py-2 text-xs font-semibold text-slate-400 uppercase tracking-widest">
              <div className="col-span-4">Client</div>
              <div className="col-span-3">Job ID</div>
              <div className="col-span-2">Date</div>
              <div className="col-span-2 text-right">Your Price</div>
              <div className="col-span-1" />
            </div>

            {displayJobs.map((job) => (
              <button
                key={job.id}
                onClick={() => setSelectedJob(job)}
                className="w-full text-left px-3 py-3.5 hover:bg-slate-50 transition rounded-xl group"
              >
                {/* Mobile layout */}
                <div className="flex items-center justify-between sm:hidden">
                  <div>
                    <div className="font-semibold text-slate-800 text-sm">{job.customer_name || "—"}</div>
                    <div className="text-xs text-slate-400 mt-0.5">{job.order_id || job.quote_id} · {fmtDate(job.date)}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-800">{fmtMoney(job._brokerTotal)}</span>
                    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500" />
                  </div>
                </div>

                {/* Desktop layout */}
                <div className="hidden sm:grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-4">
                    <div className="font-semibold text-slate-800 text-sm truncate">{job.customer_name || "—"}</div>
                  </div>
                  <div className="col-span-3">
                    <div className="text-xs text-slate-500 font-mono">{job.order_id || job.quote_id || "—"}</div>
                  </div>
                  <div className="col-span-2">
                    <div className="text-sm text-slate-500">{fmtDate(job.date)}</div>
                  </div>
                  <div className="col-span-2 text-right">
                    <div className="font-bold text-slate-800">{fmtMoney(job._brokerTotal)}</div>
                    {job._clientTotal > job._brokerTotal && (
                      <div className="text-xs text-emerald-600 font-semibold">
                        +{fmtMoney(job._clientTotal - job._brokerTotal)} margin
                      </div>
                    )}
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition" />
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {displayJobs.length > 0 && (
          <div className="pt-2 border-t border-slate-100 flex justify-between items-center text-xs text-slate-400">
            <span>{displayJobs.length} job{displayJobs.length !== 1 ? "s" : ""}</span>
            <span className="font-semibold text-slate-600">
              Total: {fmtMoney(displayJobs.reduce((s, j) => s + j._brokerTotal, 0))}
            </span>
          </div>
        )}
      </div>

      {selectedJob && (
        <JobDetailDrawer job={selectedJob} onClose={() => setSelectedJob(null)} />
      )}
    </div>
  );
}