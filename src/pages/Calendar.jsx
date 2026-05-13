import { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/supabaseClient";
import { O_STATUSES } from "../components/shared/pricing";
import OrderDetailModal from "../components/orders/OrderDetailModal";
import InvoiceDetailModal from "../components/invoices/InvoiceDetailModal";
import { ChevronLeft, ChevronRight, CalendarDays, List } from "lucide-react";
import OrderScheduleRow from "../components/calendar/OrderScheduleRow";
import EmptyState from "../components/shared/EmptyState";
import { todayInShopTz } from "@/lib/shopTimezone";

// Calendar status colors. Mirrors O_STATUSES — 5 stages.
const STATUS_COLORS = {
  "Art Approval": "bg-slate-100 border-slate-300 text-slate-700",
  "Order Goods":  "bg-orange-50 border-orange-300 text-orange-800",
  "Pre-Press":    "bg-yellow-50 border-yellow-300 text-yellow-800",
  "Printing":     "bg-blue-50 border-blue-300 text-blue-800",
  "Completed":    "bg-teal-50 border-teal-300 text-teal-700",
};

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year, month) {
  return new Date(year, month, 1).getDay();
}

function toDateStr(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// Resolves against the shop's configured timezone (falls back to browser
// tz when unset). The old toISOString() variant always returned UTC date,
// which is wrong for any shop west of London past 5pm local.
function todayStr() {
  return todayInShopTz();
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

export default function Calendar() {
  const today = todayStr();
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth());
  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState({});
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState(null);
  const [viewingInvoice, setViewingInvoice] = useState(null);
  const [view, setView] = useState("month");
  const [dragOverDate, setDragOverDate] = useState(null);
  const [user, setUser] = useState(null);
  const [expandedDates, setExpandedDates] = useState({});

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

  // Point events: single-date chips keyed by date
  const pointEvents = useMemo(() => {
    const map = {};
    orders.forEach((o) => {
      const stepDates = o.step_dates || {};
      O_STATUSES.forEach((step) => {
        const val = stepDates[step];
        if (val && typeof val === "string") {
          if (!map[val]) map[val] = [];
          map[val].push({ order: o, step, isDue: false });
        }
      });
      // Add "Order Goods" chip if order_date exists
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

  // Printing events as point events (single date)
  const printingEvents = useMemo(() => {
    const map = {};
    orders.forEach((o) => {
      const val = o.step_dates?.["Printing"];
      if (!val) return;
      if (typeof val === "object" && val.start) {
        if (!map[val.start]) map[val.start] = [];
        map[val.start].push({ order: o, step: "Printing", isDue: false });
      } else if (typeof val === "string") {
        if (!map[val]) map[val] = [];
        map[val].push({ order: o, step: "Printing", isDue: false });
      }
    });
    return map;
  }, [orders]);

  const ordersNoDueDate = useMemo(() => orders.filter((o) => !o.due_date), [orders]);

  const allActiveOrders = useMemo(() => {
    const withDue = orders.filter((o) => o.due_date).sort((a, b) => a.due_date.localeCompare(b.due_date));
    const noDue = orders.filter((o) => !o.due_date);
    return [...withDue, ...noDue];
  }, [orders]);

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  }
  function goToday() {
    const n = new Date();
    setYear(n.getFullYear());
    setMonth(n.getMonth());
  }

  async function handleUpdateStepDate(orderId, step, newDate) {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;
    const stepDates = { ...(order.step_dates || {}), [step]: newDate || undefined };
    if (!newDate) delete stepDates[step];
    const updated = await base44.entities.Order.update(orderId, { step_dates: stepDates });
    setOrders((prev) => prev.map((o) => (o.id === orderId ? updated : o)));
    setEditingStep(null);
  }

  async function handleUpdateDueDate(orderId, newDate) {
    const updated = await base44.entities.Order.update(orderId, { due_date: newDate || null });
    setOrders((prev) => prev.map((o) => (o.id === orderId ? updated : o)));
    setEditingStep(null);
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

  async function handleDelete(id) {
    if (!window.confirm("Delete this order?")) return;
    await base44.entities.Order.delete(id);
    setOrders((prev) => prev.filter((o) => o.id !== id));
    setViewing(null);
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
      extras: order.extras || {}, discount: order.discount || 0, tax_rate: order.tax_rate || 0,
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

  async function handleTogglePaid(order) {
    const newPaid = !order.paid;
    const updated = await base44.entities.Order.update(order.id, {
      paid: newPaid,
      paid_date: newPaid ? new Date().toISOString().split("T")[0] : null,
    });
    setOrders((prev) => prev.map((o) => (o.id === order.id ? updated : o)));
    setViewing(updated);
  }

  function handleDragStart(e, order) {
    e.dataTransfer.setData("orderId", order.id);
  }
  function handleDrop(e, dateStr) {
    e.preventDefault();
    const orderId = e.dataTransfer.getData("orderId");
    if (orderId) handleUpdateDueDate(orderId, dateStr);
    setDragOverDate(null);
  }
  function handleDragOver(e, dateStr) {
    e.preventDefault();
    setDragOverDate(dateStr);
  }

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  // Split cells into weeks for span rendering
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const listOrders = useMemo(() => {
    return [...orders]
      .filter((o) => o.due_date)
      .sort((a, b) => a.due_date.localeCompare(b.due_date));
  }, [orders]);

  const companyName = (o) => getCompanyName(o, customers);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Production Calendar</h2>
          <p className="text-slate-400 text-sm mt-0.5">Due dates auto-filled from quotes • Schedule each step • Drag to reschedule</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setView(v => v === "month" ? "list" : "month")}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 border border-slate-200 rounded-xl hover:bg-slate-50 transition"
          >
            {view === "month" ? <List className="w-4 h-4" /> : <CalendarDays className="w-4 h-4" />}
            {view === "month" ? "List View" : "Calendar View"}
          </button>
        </div>
      </div>

      {view === "month" && (
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
      )}

      {loading ? (
        <div className="py-20 text-center text-slate-300 text-sm">Loading…</div>
      ) : view === "month" ? (
        <>
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
            {/* Day headers */}
            <div className="grid grid-cols-7 border-b border-slate-100">
              {DAY_LABELS.map((d) => (
                <div key={d} className="py-2 text-center text-xs font-semibold text-slate-400 uppercase tracking-widest">{d}</div>
              ))}
            </div>

            {/* Week rows */}
            {weeks.map((week, wIdx) => (
              <div key={wIdx} className="relative">
                  {/* Day cells */}
                  <div className="grid grid-cols-7 divide-x divide-y divide-slate-100">
                    {week.map((day, dIdx) => {
                       if (!day) return <div key={`empty-${wIdx}-${dIdx}`} className="min-h-[110px] bg-slate-50/50" />;
                       const dateStr = toDateStr(year, month, day);
                       const isToday = dateStr === today;
                        const pointList = pointEvents[dateStr] || [];
                        const printList = printingEvents[dateStr] || [];
                        const allEvents = [...pointList, ...printList];
                        const isDragOver = dragOverDate === dateStr;

                        return (
                         <div
                           key={dateStr}
                           className={`min-h-[110px] p-1.5 flex flex-col transition ${isDragOver ? "bg-indigo-50 ring-2 ring-inset ring-indigo-400" : "hover:bg-slate-50"}`}
                           onDrop={(e) => handleDrop(e, dateStr)}
                           onDragOver={(e) => handleDragOver(e, dateStr)}
                           onDragLeave={() => setDragOverDate(null)}
                         >
                           <div className={`text-xs font-bold mb-2 w-6 h-6 flex items-center justify-center rounded-full ${isToday ? "bg-indigo-600 text-white" : "text-slate-400"}`}>
                             {day}
                           </div>
                           <div className="flex flex-col gap-1 flex-1 overflow-y-auto">
                             {allEvents.map((ev, idx) => (
                               <div
                                 key={`${ev.order.id}-${ev.step}-${idx}`}
                                 draggable
                                 onDragStart={(e) => handleDragStart(e, ev.order)}
                                 onClick={() => setViewing(ev.order)}
                                 className={`w-full text-[10px] font-semibold px-1.5 py-0.5 rounded border cursor-grab active:cursor-grabbing whitespace-nowrap overflow-hidden text-ellipsis ${
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
                           </div>
                         </div>
                      );
                      })}
                      </div>
                      </div>
                      )
                      )}
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
      ) : (
        <div className="space-y-4">
          {allActiveOrders.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm">
              <EmptyState type="orders" />
            </div>
          ) : (
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
        </div>
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
          onShowInvoice={(invoice) => setViewingInvoice(invoice)}
        />
      )}

      {viewingInvoice && (
        <InvoiceDetailModal
          invoice={viewingInvoice}
          customer={null}
          onClose={() => setViewingInvoice(null)}
          onMarkPaid={() => {}}
          onDelete={() => {}}
        />
      )}
    </div>
  );
}