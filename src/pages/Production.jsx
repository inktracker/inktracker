import { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/supabaseClient";
import { O_STATUSES, fmtDate, fmtMoney, getOrderDisplayClient, getOrderDisplayJobTitle } from "../components/shared/pricing";
import Badge from "../components/shared/Badge";
import OrderDetailModal from "../components/orders/OrderDetailModal";
import SSOrderModal from "../components/orders/SSOrderModal";
import AdvancedFilters from "../components/AdvancedFilters";
import OrderScheduleRow from "../components/calendar/OrderScheduleRow";
import { ChevronLeft, ChevronRight, CalendarDays, List } from "lucide-react";

const STATUS_COLORS = {
  "Art Approval":     "bg-slate-100 border-slate-300 text-slate-700",
  "Order Goods":      "bg-amber-50 border-amber-300 text-amber-800",
  "Pre-Press":        "bg-yellow-50 border-yellow-300 text-yellow-800",
  "Printing":         "bg-blue-50 border-blue-300 text-blue-800",
  "Finishing":        "bg-purple-50 border-purple-300 text-purple-800",
  "QC":               "bg-orange-50 border-orange-300 text-orange-800",
  "Ready for Pickup": "bg-emerald-50 border-emerald-300 text-emerald-800",
  "Completed":        "bg-teal-50 border-teal-300 text-teal-700",
};

function getOrderArtworkCount(order) {
  const keys = new Set();
  (order?.selected_artwork || []).forEach((art) => {
    const key = art.id || art.url || art.name;
    if (key) keys.add(key);
  });
  (order?.line_items || []).forEach((li) => {
    (li.imprints || []).forEach((imp) => {
      const key = imp.artwork_id || imp.artwork_url || imp.artwork_name;
      if (key) keys.add(key);
    });
  });
  return keys.size;
}

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year, month) {
  return new Date(year, month, 1).getDay();
}

function toDateStr(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

function todayStr() {
  return new Date().toLocaleDateString("en-CA", { timeZone: LOCAL_TZ });
}

function nowLocal() {
  const str = new Date().toLocaleDateString("en-CA", { timeZone: LOCAL_TZ });
  const [y, m, d] = str.split("-").map(Number);
  return { year: y, month: m - 1 };
}

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December"
];
const DAY_LABELS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function getCompanyName(order, customers) {
  const cust = customers[order.customer_id];
  if (cust?.company?.trim()) return cust.company.trim();
  if (cust?.name) return cust.name;
  if (order.customer_name) return order.customer_name;
  return "—";
}

export default function Production() {
  const today = todayStr();
  const [year, setYear] = useState(() => nowLocal().year);
  const [month, setMonth] = useState(() => nowLocal().month);
  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState({});
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState(null);
  const [ssOrderTarget, setSsOrderTarget] = useState(null);
  const [viewMode, setViewMode] = useState("calendar");
  const [filter, setFilter] = useState("All");
  const [originFilter, setOriginFilter] = useState("All");
  const [advFilters, setAdvFilters] = useState({});
  const [dragOverDate, setDragOverDate] = useState(null);
  const [user, setUser] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkStatus, setBulkStatus] = useState("");

  useEffect(() => {
    async function load() {
      const u = await base44.auth.me();
      setUser(u);
      const [o, c] = await Promise.all([
        base44.entities.Order.filter({ shop_owner: u.email }, "-created_date", 200),
        base44.entities.Customer.filter({ shop_owner: u.email }),
      ]);
      setOrders(o || []);
      const map = {};
      (c || []).forEach((cust) => (map[cust.id] = cust));
      setCustomers(map);
      setLoading(false);
    }
    load();
  }, []);

  const pointEvents = useMemo(() => {
    const map = {};
    orders.forEach((o) => {
      const stepDates = o.step_dates || {};
      O_STATUSES.forEach((step) => {
        const val = stepDates[step];
        if (!val) return;
        
        if (step === "Printing" && typeof val === "object" && val.start && val.end) {
          // Printing as date range: add point events for start and end dates
          [val.start, val.end].forEach((date) => {
            if (!map[date]) map[date] = [];
            map[date].push({ order: o, step, isDue: false });
          });
        } else if (typeof val === "string") {
          // Single date for any step
          if (!map[val]) map[val] = [];
          map[val].push({ order: o, step, isDue: false });
        }
      });
      if (o.date) {
        if (!map[o.date]) map[o.date] = [];
        map[o.date].push({ order: o, step: "Order Goods", isDue: false });
      }
      if (o.due_date) {
        if (!map[o.due_date]) map[o.due_date] = [];
        map[o.due_date].push({ order: o, step: "Due", isDue: true });
      }
    });
    return map;
  }, [orders]);

  const allActiveOrders = useMemo(() => {
    const active = orders.filter((o) => o.status !== "Completed");
    const withDue = active.filter((o) => o.due_date).sort((a, b) => a.due_date.localeCompare(b.due_date));
    const noDue = active.filter((o) => !o.due_date);
    return [...withDue, ...noDue];
  }, [orders]);

  // Table view filtering
  let filteredTable = filter === "All" ? orders : orders.filter((o) => o.status === filter);
  filteredTable = filteredTable.filter((o) => {
    if (originFilter === "Internal" && o.broker_id) return false;
    if (originFilter === "Broker" && !o.broker_id) return false;
    return true;
  });
  filteredTable = filteredTable.filter((o) => {
    if (advFilters.customer) {
      const customerSearch = advFilters.customer.toLowerCase();
      const haystack = [o.customer_name, o.broker_client_name, o.job_title]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(customerSearch)) return false;
    }
    if (advFilters.orderId && !o.order_id?.toLowerCase().includes(advFilters.orderId.toLowerCase())) return false;
    if (advFilters.minTotal && (o.total || 0) < parseFloat(advFilters.minTotal)) return false;
    if (advFilters.maxTotal && (o.total || 0) > parseFloat(advFilters.maxTotal)) return false;
    return true;
  });

  const advFilterOptions = [
    { key: "customer", label: "Customer / Job Title", type: "text" },
    { key: "orderId", label: "Order ID", type: "text" },
    { key: "minTotal", label: "Min Total", type: "text" },
    { key: "maxTotal", label: "Max Total", type: "text" },
  ];

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  }
  function goToday() {
    const { year: y, month: m } = nowLocal();
    setYear(y);
    setMonth(m);
  }

  async function handleUpdateStepDate(orderId, step, newDate) {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;
    const stepDates = { ...(order.step_dates || {}), [step]: newDate || undefined };
    if (!newDate) delete stepDates[step];
    const updated = await base44.entities.Order.update(orderId, { step_dates: stepDates });
    setOrders((prev) => prev.map((o) => (o.id === orderId ? updated : o)));
  }

  async function handleUpdateDueDate(orderId, newDate) {
    const updated = await base44.entities.Order.update(orderId, { due_date: newDate || null });
    setOrders((prev) => prev.map((o) => (o.id === orderId ? updated : o)));
  }

  async function handleAdvance(id) {
    const order = orders.find((o) => o.id === id);
    const idx = O_STATUSES.indexOf(order.status);
    if (idx >= 0 && idx < O_STATUSES.length - 1) {
      const updated = await base44.entities.Order.update(id, { status: O_STATUSES[idx + 1] });
      setOrders((prev) => prev.map((o) => (o.id === id ? updated : o)));
      if (viewing?.id === id) setViewing(updated);
    }
  }

  async function handleRevert(id) {
    const order = orders.find((o) => o.id === id);
    const idx = O_STATUSES.indexOf(order.status);
    if (idx > 0) {
      const updated = await base44.entities.Order.update(id, { status: O_STATUSES[idx - 1] });
      setOrders((prev) => prev.map((o) => (o.id === id ? updated : o)));
      if (viewing?.id === id) setViewing(updated);
    }
  }

  async function handleComplete(order) {
    const td = new Date().toISOString().split("T")[0];
    const inv_id = `INV-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase().slice(-5)}`;
    await base44.entities.Invoice.create({
      invoice_id: inv_id, shop_owner: user.email,
      order_id: order.order_id, customer_id: order.customer_id,
      customer_name: order.customer_name, date: td,
      due: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      subtotal: order.subtotal || 0, tax: order.tax || 0, total: order.total || 0,
      paid: false, status: "Sent", line_items: order.line_items || [],
      notes: order.notes || "", rush_rate: order.rush_rate || 0,
      extras: order.extras || {}, discount: order.discount || 0, tax_rate: order.tax_rate || 8.265,
    });
    if (order.broker_id) {
      await base44.entities.BrokerPerformance.create({
        broker_id: order.broker_id, shop_owner: user.email,
        order_id: order.order_id, customer_name: order.customer_name,
        date: td, total: order.total || 0,
      });
    }
    await base44.entities.ShopPerformance.create({
      shop_owner: user.email, order_id: order.order_id,
      customer_name: order.customer_name, customer_id: order.customer_id || "",
      broker_id: order.broker_id || "", date: td, total: order.total || 0, status: "Completed",
    });
    await base44.entities.Order.delete(order.id);
    setOrders((prev) => prev.filter((o) => o.id !== order.id));
    setViewing(null);
  }

  async function handleDelete(id) {
    if (!window.confirm("Delete this order?")) return;
    await base44.entities.Order.delete(id);
    setOrders((prev) => prev.filter((o) => o.id !== id));
    setViewing(null);
  }

  async function handleTogglePaid(order) {
    const newPaid = !order.paid;
    const updated = await base44.entities.Order.update(order.id, {
      paid: newPaid,
      paid_date: newPaid ? new Date().toISOString().split("T")[0] : null,
    });
    setOrders((prev) => prev.map((o) => (o.id === order.id ? updated : o)));
    setViewing(updated);
  }

  async function handleDrop(e, dateStr) {
    e.preventDefault();
    const orderId = e.dataTransfer.getData("orderId");
    const step = e.dataTransfer.getData("step");
    
    if (step === "Due") {
      if (orderId) handleUpdateDueDate(orderId, dateStr);
    } else if (step === "Order Goods") {
      // "Order Goods" maps to the order.date field
      if (orderId) {
        const updated = await base44.entities.Order.update(orderId, { date: dateStr });
        setOrders((prev) => prev.map((o) => (o.id === orderId ? updated : o)));
      }
    } else if (orderId && step) {
      if (orderId) handleUpdateStepDate(orderId, step, dateStr);
    }
    setDragOverDate(null);
  }
  function handleDragOver(e, dateStr) {
    e.preventDefault();
    setDragOverDate(dateStr);
  }

  async function handleBulkStatusUpdate() {
    if (!bulkStatus || selectedIds.size === 0) return;
    const ids = [...selectedIds];
    await Promise.all(ids.map((id) => base44.entities.Order.update(id, { status: bulkStatus })));
    setOrders((prev) =>
      prev.map((o) => (selectedIds.has(o.id) ? { ...o, status: bulkStatus } : o))
    );
    setSelectedIds(new Set());
    setBulkStatus("");
  }

  function toggleSelectAll() {
    if (selectedIds.size === filteredTable.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredTable.map((o) => o.id)));
    }
  }

  function toggleSelectOne(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const handleAdvFilterChange = (key, value) => {
    setAdvFilters((prev) => (value ? { ...prev, [key]: value } : { ...prev, [key]: undefined }));
  };

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const companyName = (o) => getCompanyName(o, customers);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Production</h2>
          <p className="text-slate-400 text-sm mt-0.5">View and manage orders in calendar or table view</p>
        </div>
        <button
          onClick={() => setViewMode(v => v === "calendar" ? "table" : "calendar")}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 border border-slate-200 rounded-xl hover:bg-slate-50 transition"
        >
          {viewMode === "calendar" ? <List className="w-4 h-4" /> : <CalendarDays className="w-4 h-4" />}
          {viewMode === "calendar" ? "Table View" : "Calendar View"}
        </button>
      </div>

      {viewMode === "table" && (
        <>
          <div className="flex gap-2 flex-wrap">
            {["All", ...O_STATUSES].map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition ${filter === s ? "bg-indigo-600 text-white border-indigo-600" : "bg-white border-slate-200 text-slate-500 hover:border-indigo-300"}`}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            {["All", "Internal", "Broker"].map((o) => (
              <button
                key={o}
                onClick={() => setOriginFilter(o)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition ${originFilter === o ? "bg-slate-800 text-white border-slate-800" : "bg-white border-slate-200 text-slate-500 hover:border-slate-400"}`}
              >
                {o}
              </button>
            ))}
          </div>
          <AdvancedFilters filters={advFilters} onFilterChange={handleAdvFilterChange} filterOptions={advFilterOptions} />

          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-2.5">
              <span className="text-sm font-semibold text-indigo-700">{selectedIds.size} selected</span>
              <select
                value={bulkStatus}
                onChange={(e) => setBulkStatus(e.target.value)}
                className="text-sm border border-indigo-200 rounded-lg px-2 py-1 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                <option value="">Set status…</option>
                {O_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <button
                onClick={handleBulkStatusUpdate}
                disabled={!bulkStatus}
                className="text-sm font-semibold px-3 py-1 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition"
              >
                Apply
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="text-sm text-slate-400 hover:text-slate-600 transition ml-auto"
              >
                Clear
              </button>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    <th className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={filteredTable.length > 0 && selectedIds.size === filteredTable.length}
                        onChange={toggleSelectAll}
                        className="w-4 h-4 rounded border-slate-300 text-indigo-600 cursor-pointer"
                      />
                    </th>
                    {["Order ID", "Customer", "Artwork", "Due", "Total", "Status", ""].map((h) => (
                      <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-widest">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr>
                      <td colSpan={7} className="px-5 py-8 text-center text-slate-300">Loading…</td>
                    </tr>
                  )}
                  {filteredTable.map((o) => {
                    const artworkCount = getOrderArtworkCount(o);
                    const isChecked = selectedIds.has(o.id);
                    return (
                      <tr
                        key={o.id}
                        className={`border-b border-slate-50 hover:bg-slate-50 cursor-pointer transition ${isChecked ? "bg-indigo-50/50" : ""}`}
                        onClick={() => setViewing(o)}
                      >
                        <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleSelectOne(o.id)}
                            className="w-4 h-4 rounded border-slate-300 text-indigo-600 cursor-pointer"
                          />
                        </td>
                        <td className="px-5 py-3.5 font-mono text-xs text-slate-400">{o.order_id}</td>
                        <td className="px-5 py-3.5">
                          <div className="font-semibold text-slate-800">
                            {getOrderDisplayClient(o, customers[o.customer_id])}
                          </div>
                          {getOrderDisplayJobTitle(o, customers[o.customer_id]) && (
                            <div className="text-xs text-slate-400 mt-0.5">
                              Job: {getOrderDisplayJobTitle(o, customers[o.customer_id])}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          {artworkCount > 0 ? (
                            <span className="text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded-full">
                              {artworkCount} file{artworkCount === 1 ? "" : "s"}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-slate-500">{o.due_date ? fmtDate(o.due_date) : "—"}</td>
                        <td className="px-5 py-3.5 font-bold text-slate-800">{fmtMoney(o.total || 0)}</td>
                        <td className="px-5 py-3.5"><Badge s={o.status} /></td>
                        <td className="px-5 py-3.5 text-right text-indigo-400 text-xs font-semibold">View →</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="md:hidden divide-y divide-slate-100">
              {loading && <div className="px-4 py-8 text-center text-slate-300">Loading…</div>}
              {filteredTable.map((o) => {
                const artworkCount = getOrderArtworkCount(o);
                return (
                  <div key={o.id} className="p-4 border-b border-slate-50 hover:bg-slate-50 cursor-pointer transition" onClick={() => setViewing(o)}>
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <div className="font-mono text-xs text-slate-400">{o.order_id}</div>
                        <div className="font-semibold text-slate-800">{getOrderDisplayClient(o, customers[o.customer_id])}</div>
                        {getOrderDisplayJobTitle(o, customers[o.customer_id]) && (
                          <div className="text-xs text-slate-400 mt-0.5">
                            Job: {getOrderDisplayJobTitle(o, customers[o.customer_id])}
                          </div>
                        )}
                      </div>
                      <Badge s={o.status} />
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-500 gap-3">
                      <span>Due: {o.due_date ? fmtDate(o.due_date) : "—"}</span>
                      <span className="font-bold text-slate-800">{fmtMoney(o.total || 0)}</span>
                    </div>
                    {artworkCount > 0 && (
                      <div className="mt-2">
                        <span className="text-[11px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-1 rounded-full">
                          {artworkCount} artwork file{artworkCount === 1 ? "" : "s"}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {viewMode === "calendar" && (
        <>
          <div className="flex items-center gap-3">
            <button onClick={prevMonth} className="p-2 rounded-xl hover:bg-slate-100 border border-slate-200 transition">
              <ChevronLeft className="w-4 h-4 text-slate-600" />
            </button>
            <button onClick={goToday} className="text-sm font-semibold text-indigo-600 hover:underline">Today</button>
            <button onClick={nextMonth} className="p-2 rounded-xl hover:bg-slate-100 border border-slate-200 transition">
              <ChevronRight className="w-4 h-4 text-slate-600" />
            </button>
            <h3 className="text-lg font-bold text-slate-900 ml-2">{MONTH_NAMES[month]} {year}</h3>
          </div>

          {loading ? (
            <div className="py-20 text-center text-slate-300 text-sm">Loading…</div>
          ) : (
            <>
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                <div className="grid grid-cols-7 border-b border-slate-100">
                  {DAY_LABELS.map((d) => (
                    <div key={d} className="py-2 text-center text-xs font-semibold text-slate-400 uppercase tracking-widest">{d}</div>
                  ))}
                </div>

                {weeks.map((week, wIdx) => {
                   return (
                     <div key={wIdx} className="relative">
                       <div className="grid grid-cols-7 divide-x divide-y divide-slate-100">
                         {week.map((day, dIdx) => {
                           if (!day) return <div key={`empty-${wIdx}-${dIdx}`} className="min-h-[110px] bg-slate-50/50" />;
                           const dateStr = toDateStr(year, month, day);
                           const isToday = dateStr === today;
                           const events = pointEvents[dateStr] || [];
                           const isDragOver = dragOverDate === dateStr;

                          return (
                            <div
                              key={dateStr}
                              className={`min-h-[110px] p-1.5 flex flex-col transition ${isDragOver ? "bg-indigo-50 ring-2 ring-inset ring-indigo-400" : "hover:bg-slate-50"}`}
                              onDrop={(e) => handleDrop(e, dateStr)}
                              onDragOver={(e) => handleDragOver(e, dateStr)}
                              onDragLeave={() => setDragOverDate(null)}
                            >
                              <div className={`text-xs font-bold mb-1 w-6 h-6 flex items-center justify-center rounded-full ${isToday ? "bg-indigo-600 text-white" : "text-slate-400"}`}>
                                {day}
                              </div>
                              <div className="space-y-0.5 flex-1 overflow-hidden">
                                {events.slice(0, 4).map((ev, idx) => (
                                  <div
                                    key={`${ev.order.id}-${ev.step}-${idx}`}
                                    draggable
                                    onDragStart={(e) => {
                                      e.dataTransfer.effectAllowed = "move";
                                      e.dataTransfer.setData("orderId", ev.order.id);
                                      e.dataTransfer.setData("step", ev.step);
                                    }}
                                    onClick={(e) => { e.stopPropagation(); setViewing(ev.order); }}
                                    className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border cursor-grab truncate ${
                                      ev.isDue
                                        ? "bg-rose-50 border-rose-300 text-rose-700"
                                        : STATUS_COLORS[ev.step] || "bg-slate-100 border-slate-200 text-slate-600"
                                    }`}
                                    title={`${companyName(ev.order)} — ${ev.step}`}
                                  >
                                    {companyName(ev.order)}
                                    <span className="opacity-60 ml-1">· {ev.step}</span>
                                  </div>
                                ))}
                                {events.length > 4 && (
                                  <div className="text-[10px] text-slate-400 font-semibold px-1">+{events.length - 4} more</div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      </div>
                  );
                })}
              </div>

              {allActiveOrders.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                  <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
                    <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">All Active Orders ({allActiveOrders.length}) — Click to expand & schedule</div>
                  </div>
                  {allActiveOrders.map((o) => (
                    <OrderScheduleRow
                      key={o.id}
                      order={o}
                      companyName={companyName(o)}
                      onUpdateStepDate={handleUpdateStepDate}
                      onUpdateDueDate={handleUpdateDueDate}
                      onView={setViewing}
                      today={today}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {viewing && (
        <OrderDetailModal
          order={orders.find((x) => x.id === viewing.id) || viewing}
          onClose={() => setViewing(null)}
          onAdvance={handleAdvance}
          onRevert={handleRevert}
          onComplete={handleComplete}
          onDelete={handleDelete}
          onTogglePaid={handleTogglePaid}
          onOrderFromSS={(order) => { setViewing(null); setSsOrderTarget(order); }}
        />
      )}

      {ssOrderTarget && (
        <SSOrderModal
          order={ssOrderTarget}
          onClose={() => setSsOrderTarget(null)}
          onOrderPlaced={() => setSsOrderTarget(null)}
        />
      )}
    </div>
  );
}