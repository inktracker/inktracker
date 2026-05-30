import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { base44, supabase } from "@/api/supabaseClient";
import { O_STATUSES, fmtDate, fmtMoney, getOrderDisplayClient, getOrderDisplayJobTitle } from "../components/shared/pricing";
import { buildOrderCompletionPlan } from "@/lib/orders/completeOrder";
import Badge from "../components/shared/Badge";
import { addDaysISO, relativeDueLabel, getOrderActionHint } from "@/lib/calendar/agendaHints";
import OrderDetailModal from "../components/orders/OrderDetailModal";
import InvoiceDetailModal from "../components/invoices/InvoiceDetailModal";
import ACOrderModal from "../components/orders/ACOrderModal";
import AdvancedFilters from "../components/AdvancedFilters";
import OrderScheduleRow from "../components/calendar/OrderScheduleRow";
import { ChevronLeft, ChevronRight, CalendarDays, List } from "lucide-react";
import { todayInShopTz, nowInShopTz } from "@/lib/shopTimezone";
import { useBillingGate } from "@/lib/billing-gate";
import { notify } from "@/lib/notify";
import { notifyBrokerOfShopAction } from "@/lib/broker/notifyBrokerOfShopAction";
import { handleBrokerOrderDeletion } from "@/lib/orders/handleBrokerOrderDeletion";

// Mirrors STATUS_COLORS in src/pages/Calendar.jsx — each step gets a
// visually distinct hue so the production board reads as a progress
// map at a glance. Keep these in sync if you change either side.
const STATUS_COLORS = {
  // Quote lifecycle (before the order exists)
  "Quote Sent":     "bg-sky-50 border-sky-300 text-sky-700",
  "Quote Approved": "bg-teal-50 border-teal-300 text-teal-700",
  // Production pipeline
  "Art Approval": "bg-violet-50 border-violet-300 text-violet-700",
  "Order Goods":  "bg-orange-50 border-orange-300 text-orange-800",
  "Pre-Press":    "bg-amber-50 border-amber-300 text-amber-800",
  "Printing":     "bg-indigo-50 border-indigo-300 text-indigo-700",
  "Completed":    "bg-emerald-100 border-emerald-400 text-emerald-800 font-semibold",
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

// "Today" and "now" resolve against the shop's configured timezone (falls
// back to the browser tz if no shop tz is set). The previous implementation
// captured the browser tz at module load — broke for employees logging in
// from a different state than the shop is in.
function todayStr() {
  return todayInShopTz();
}

function nowLocal() {
  return nowInShopTz();
}

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December"
];
const DAY_LABELS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

// Same resolver as Calendar.jsx — company always wins, whether it lives
// on the linked customer record or as a denormalized field on the
// quote/order itself (quotes write `company` from the order wizard).
// Falls through to a person's name only when no company is on file.
function getCompanyName(rec, customers) {
  const cust = customers[rec?.customer_id];
  const company =
    (typeof cust?.company === "string" && cust.company.trim()) ||
    (typeof rec?.company === "string" && rec.company.trim()) ||
    "";
  if (company) return company;
  if (cust?.name) return cust.name;
  if (rec?.customer_name) return rec.customer_name;
  return "—";
}

export default function Production() {
  const navigate = useNavigate();
  const today = todayStr();
  const [year, setYear] = useState(() => nowLocal().year);
  const [month, setMonth] = useState(() => nowLocal().month);
  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState({});
  // All quotes for the shop (most recent 500). Used to build "Quote Sent"
  // and "Quote Approved" chips on the calendar — these are independent of
  // whether the quote has been converted to an order yet. A freshly-sent
  // quote appears as a violet chip on its sent_date even before there's an
  // order.
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState(null);
  const [acOrderTarget, setAcOrderTarget] = useState(null);
  // Map of order.id → PO row (the PO created from that order, if any).
  // Drives the OrderDetailModal's tri-state Order from AS Colour button.
  const [poByOrderId, setPoByOrderId] = useState({});
  // Nested invoice preview when the user clicks "Preview Invoice"
  // on the OrderDetailModal for an already-invoiced order.
  const [viewingInvoice, setViewingInvoice] = useState(null);
  const [viewMode, setViewMode] = useState("calendar");
  const [filter, setFilter] = useState("All");
  const [originFilter, setOriginFilter] = useState("All");
  const [advFilters, setAdvFilters] = useState({});
  const [dragOverDate, setDragOverDate] = useState(null);
  const [user, setUser] = useState(null);
  const { gate: billingGate } = useBillingGate(user);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkStatus, setBulkStatus] = useState("");
  // Day clicked in the calendar → opens the agenda panel showing all jobs
  // in-the-works on that date (created ≤ date ≤ due).
  const [selectedDate, setSelectedDate] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const u = await base44.auth.me();
        setUser(u);
        const [o, c, q, pos] = await Promise.all([
          base44.entities.Order.filter({ shop_owner: u.email }, "-created_date", 200),
          base44.entities.Customer.filter({ shop_owner: u.email }),
          // All quotes — independent of conversion status. Lets a sent or
          // approved quote appear on the calendar before there's an order.
          base44.entities.Quote.filter({ shop_owner: u.email }, "-created_date", 500).catch(() => []),
          // POs that originated from one of this shop's orders. Drives
          // OrderDetailModal's tri-state Order from AS Colour button.
          // Soft-fails so a missing column / RLS issue doesn't break the page.
          base44.entities.PurchaseOrder.filter({ shop_owner: u.email }).catch(() => []),
        ]);
        setOrders(o || []);
        const map = {};
        (c || []).forEach((cust) => (map[cust.id] = cust));
        setCustomers(map);
        setQuotes(q || []);
        // Last-write-wins per source_order_id; if a shop genuinely has
        // multiple POs for the same order, the latest one drives the
        // button state (cleanest single-PO assumption for v1).
        const poMap = {};
        for (const po of pos || []) {
          if (po.source_order_id) poMap[po.source_order_id] = po;
        }
        setPoByOrderId(poMap);
      } catch (err) {
        notify.error("Couldn't load production schedule", err);
      } finally {
        setLoading(false);
      }
    }
    load();

    // Real-time: update orders when employees make progress
    const channel = supabase.channel("production-orders")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders" }, (payload) => {
        const updated = payload.new;
        setOrders(prev => prev.map(o => o.id === updated.id ? { ...o, ...updated } : o));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
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
      // Completed orders get a green chip on completed_date so the
      // calendar serves as a historical "what shipped when" record even
      // when an order had no scheduled steps.
      if (o.status === "Completed" && o.completed_date) {
        if (!map[o.completed_date]) map[o.completed_date] = [];
        map[o.completed_date].push({ order: o, step: "Completed", isDue: false });
      }
      // Completed orders don't get a red "Due" chip — the job is done.
      if (o.due_date && o.status !== "Completed") {
        if (!map[o.due_date]) map[o.due_date] = [];
        map[o.due_date].push({ order: o, step: "Due", isDue: true });
      }

    });

    // Quote lifecycle chips — pushed directly from quote rows, not joined
    // via order. A quote that's been sent but not converted still shows up.
    // Date strings normalized to YYYY-MM-DD (client_approved_at is full ISO).
    quotes.forEach((q) => {
      if (q.sent_date) {
        const d = String(q.sent_date).slice(0, 10);
        if (!map[d]) map[d] = [];
        map[d].push({ kind: "quote", quote: q, step: "Quote Sent", isDue: false });
      }
      if (q.client_approved_at) {
        const d = String(q.client_approved_at).slice(0, 10);
        if (!map[d]) map[d] = [];
        map[d].push({ kind: "quote", quote: q, step: "Quote Approved", isDue: false });
      }
    });

    return map;
  }, [orders, quotes]);

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
    if (billingGate("complete orders")) return;
    // Completion = transition, never destruction. (20260516 trigger
    // refuses DELETE on Completed orders — that's the platform-level
    // backstop.)
    //
    // Pre-fetch any existing invoice for this job to prevent the
    // duplicate Joe hit on 2026-05-12: SendQuoteModal had already
    // pushed the quote to QB and pulled an invoice row back
    // (invoice_id = quote_id), and this handler was about to create
    // a SECOND row. Now we link the existing invoice to the order
    // instead of duplicating.
    //
    // Match by either invoice_id = order.quote_id (Send-Quote path)
    // OR order_id = order.order_id (a previous in-flight completion
    // that landed an INV-* row).
    const td = new Date().toISOString().split("T")[0];

    let existingInvoice = null;
    try {
      const byOrderId = await base44.entities.Invoice.filter({
        shop_owner: user.email,
        order_id: order.order_id,
      });
      if (byOrderId.length > 0) {
        existingInvoice = byOrderId[0];
      } else if (order.quote_id) {
        const byQuoteId = await base44.entities.Invoice.filter({
          shop_owner: user.email,
          invoice_id: order.quote_id,
        });
        if (byQuoteId.length > 0) existingInvoice = byQuoteId[0];
      }
      // Third fallback: orders converted before PR#45 lack order.quote_id.
      // Walk Quote.converted_order_id → quote_id to recover the link.
      // Works for broker quotes (always preserved) and for any future
      // quote conversion once PR#45 is in.
      if (!existingInvoice) {
        const originatingQuotes = await base44.entities.Quote.filter({
          shop_owner: user.email,
          converted_order_id: order.order_id,
        });
        const qId = originatingQuotes?.[0]?.quote_id;
        if (qId) {
          const byReversedQuoteId = await base44.entities.Invoice.filter({
            shop_owner: user.email,
            invoice_id: qId,
          });
          if (byReversedQuoteId.length > 0) existingInvoice = byReversedQuoteId[0];
        }
      }
    } catch (err) {
      console.error("[handleComplete] failed to look up existing invoice:", err);
      // Continue without — the DB unique index from
      // 20260519_invoices_no_duplicates.sql is the last-line backstop
      // and will refuse a duplicate insert.
    }

    const plan = buildOrderCompletionPlan(order, {
      today: td,
      shopOwner: user.email,
      existingInvoice,
    });

    if (plan.invoiceLink) {
      // Existing invoice — link to this order, don't create a new row.
      await base44.entities.Invoice.update(plan.invoiceLink.id, plan.invoiceLink.patch);
    } else if (plan.invoiceCreate) {
      await base44.entities.Invoice.create(plan.invoiceCreate);
    }

    if (plan.brokerPerformanceCreate) {
      await base44.entities.BrokerPerformance.create(plan.brokerPerformanceCreate);
    }
    await base44.entities.ShopPerformance.create(plan.shopPerformanceCreate);
    const updated = await base44.entities.Order.update(plan.orderUpdate.id, plan.orderUpdate.patch);
    setOrders((prev) => prev.map((o) => (o.id === order.id ? updated : o)));
    setViewing(null);

    // Notify the broker (if this was a broker order). Best-effort.
    // The helper looks at broker_id / broker_name / broker_company /
    // customer_name / id directly on the row, so the order object works
    // without re-shaping. Item label falls back to the order_id so the
    // feed entry reads "completed your order — ORD-2026-XXXX".
    notifyBrokerOfShopAction({
      quote: { ...updated, quote_id: updated.order_id || updated.quote_id },
      action: "shop_completed_order",
      shopEmail: user?.email,
    });
  }

  async function handleDelete(id) {
    if (!window.confirm("Delete this order?")) return;
    const order = orders.find((o) => o.id === id);
    await base44.entities.Order.delete(id);
    setOrders((prev) => prev.filter((o) => o.id !== id));
    setViewing(null);

    // If the deleted order originated from a broker quote, roll the quote
    // back to "Client Approved" and notify the broker via ShopActionFeed.
    handleBrokerOrderDeletion(order);
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
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Production</h2>
          <p className="text-slate-400 text-sm mt-0.5">View and manage orders in calendar or table view</p>
        </div>
        <div className="flex gap-2">
          {[
            { id: "calendar", icon: CalendarDays, label: "Calendar" },
            { id: "table", icon: List, label: "Table" },
          ].map(v => (
            <button key={v.id} onClick={() => setViewMode(v.id)}
              className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl transition ${viewMode === v.id ? "bg-teal-600 text-white" : "border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:bg-slate-800 text-slate-600"}`}>
              <v.icon className="w-4 h-4" /> {v.label}
            </button>
          ))}
        </div>
      </div>

      {viewMode === "table" && (
        <>
          <div className="flex gap-2 flex-wrap">
            {["All", ...O_STATUSES].map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition ${filter === s ? "bg-teal-600 text-white border-teal-600" : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-500 hover:border-teal-300"}`}
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
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition ${originFilter === o ? "bg-slate-800 text-white border-slate-800" : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-400"}`}
              >
                {o}
              </button>
            ))}
          </div>
          <AdvancedFilters filters={advFilters} onFilterChange={handleAdvFilterChange} filterOptions={advFilterOptions} />

          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 bg-teal-50 border border-teal-200 rounded-xl px-4 py-2.5">
              <span className="text-sm font-semibold text-teal-700">{selectedIds.size} selected</span>
              <select
                value={bulkStatus}
                onChange={(e) => setBulkStatus(e.target.value)}
                className="text-sm border border-teal-200 rounded-lg px-2 py-1 bg-white dark:bg-slate-900 text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-400"
              >
                <option value="">Set status…</option>
                {O_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <button
                onClick={handleBulkStatusUpdate}
                disabled={!bulkStatus}
                className="text-sm font-semibold px-3 py-1 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-40 transition"
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

          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                    <th className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={filteredTable.length > 0 && selectedIds.size === filteredTable.length}
                        onChange={toggleSelectAll}
                        className="w-4 h-4 rounded border-slate-300 text-teal-600 cursor-pointer"
                      />
                    </th>
                    {["Order ID", "Customer", "Due", "Press", "Status", ""].map((h) => (
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
                    const isChecked = selectedIds.has(o.id);
                    const isOverdue = o.due_date && o.due_date < today && o.status !== "Completed";
                    return (
                      <tr
                        key={o.id}
                        className={`border-b border-slate-50 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer transition ${isChecked ? "bg-teal-50/50" : ""} ${isOverdue ? "bg-red-50/50 dark:bg-red-950/20" : ""}`}
                        onClick={() => setViewing(o)}
                      >
                        <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleSelectOne(o.id)}
                            className="w-4 h-4 rounded border-slate-300 text-teal-600 cursor-pointer"
                          />
                        </td>
                        <td className="px-5 py-3.5 font-mono text-xs text-slate-400">{o.order_id}</td>
                        <td className="px-5 py-3.5">
                          <div className="font-semibold text-slate-800 dark:text-slate-200">
                            {getOrderDisplayClient(o, customers[o.customer_id])}
                          </div>
                          {getOrderDisplayJobTitle(o, customers[o.customer_id]) && (
                            <div className="text-xs text-slate-400 mt-0.5">
                              Job: {getOrderDisplayJobTitle(o, customers[o.customer_id])}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          {o.due_date ? (
                            <span className={`text-sm ${isOverdue ? "text-red-600 font-bold" : "text-slate-500"}`}>
                              {fmtDate(o.due_date)}
                              {isOverdue && <span className="ml-1 text-[10px] text-red-500 font-semibold">LATE</span>}
                            </span>
                          ) : <span className="text-xs text-slate-300">—</span>}
                        </td>
                        <td className="px-5 py-3.5">
                          {o.assigned_press ? (
                            <span className="text-[11px] font-semibold text-green-700 bg-green-50 border border-green-100 px-2 py-0.5 rounded-full">{o.assigned_press}</span>
                          ) : <span className="text-xs text-slate-300">—</span>}
                        </td>
                        <td className="px-5 py-3.5"><Badge s={o.status} /></td>
                        <td className="px-5 py-3.5 text-right text-teal-400 text-xs font-semibold">View →</td>
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
                  <div key={o.id} className="p-4 border-b border-slate-50 hover:bg-slate-50 dark:bg-slate-800 cursor-pointer transition" onClick={() => setViewing(o)}>
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <div className="font-mono text-xs text-slate-400">{o.order_id}</div>
                        <div className="font-semibold text-slate-800 dark:text-slate-200">{getOrderDisplayClient(o, customers[o.customer_id])}</div>
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
                      <span className="font-bold text-slate-800 dark:text-slate-200">{fmtMoney(o.total || 0)}</span>
                    </div>
                    {artworkCount > 0 && (
                      <div className="mt-2">
                        <span className="text-[11px] font-semibold text-teal-700 bg-teal-50 border border-teal-100 px-2 py-1 rounded-full">
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
            <button onClick={prevMonth} className="p-2 rounded-xl hover:bg-slate-100 border border-slate-200 dark:border-slate-700 transition">
              <ChevronLeft className="w-4 h-4 text-slate-600" />
            </button>
            <button onClick={goToday} className="text-sm font-semibold text-teal-600 hover:underline">Today</button>
            <button onClick={nextMonth} className="p-2 rounded-xl hover:bg-slate-100 border border-slate-200 dark:border-slate-700 transition">
              <ChevronRight className="w-4 h-4 text-slate-600" />
            </button>
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 ml-2">{MONTH_NAMES[month]} {year}</h3>
          </div>

          {/* Chip legend — quick visual key so users can decode colors without
              hovering for tooltips. Grouped: quote lifecycle first, then
              production pipeline, then due/complete. */}
          <div className="flex flex-wrap items-center gap-1.5 mb-3 text-[10px] font-semibold">
            {[
              { label: "Quote Sent",     cls: STATUS_COLORS["Quote Sent"] },
              { label: "Quote Approved", cls: STATUS_COLORS["Quote Approved"] },
              { label: "Order Goods",    cls: STATUS_COLORS["Order Goods"] },
              { label: "Pre-Press",      cls: STATUS_COLORS["Pre-Press"] },
              { label: "Printing",       cls: STATUS_COLORS["Printing"] },
              { label: "Due",            cls: "bg-rose-50 border-rose-300 text-rose-700" },
              { label: "Completed",      cls: STATUS_COLORS["Completed"] },
            ].map((item) => (
              <span key={item.label} className={`px-1.5 py-0.5 rounded border ${item.cls}`}>
                {item.label}
              </span>
            ))}
          </div>

          {loading ? (
            <div className="py-20 text-center text-slate-300 text-sm">Loading…</div>
          ) : (
            <>
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-sm">
                <div className="grid grid-cols-7 border-b border-slate-100 dark:border-slate-700">
                  {DAY_LABELS.map((d) => (
                    <div key={d} className="py-2 text-center text-xs font-semibold text-slate-400 uppercase tracking-widest">{d}</div>
                  ))}
                </div>

                {weeks.map((week, wIdx) => {
                   return (
                     <div key={wIdx} className="relative">
                       <div className="grid grid-cols-7 divide-x divide-y divide-slate-100">
                         {week.map((day, dIdx) => {
                           if (!day) return <div key={`empty-${wIdx}-${dIdx}`} className="min-h-[110px] bg-slate-50 dark:bg-slate-800/50" />;
                           const dateStr = toDateStr(year, month, day);
                           const isToday = dateStr === today;
                           const events = pointEvents[dateStr] || [];
                           const isDragOver = dragOverDate === dateStr;

                          return (
                            <div
                              key={dateStr}
                              className={`min-h-[110px] p-1.5 flex flex-col transition cursor-pointer ${isDragOver ? "bg-teal-50 ring-2 ring-inset ring-teal-400" : selectedDate === dateStr ? "bg-teal-50/60" : "hover:bg-slate-50 dark:bg-slate-800"}`}
                              onClick={() => setSelectedDate(dateStr)}
                              onDrop={(e) => handleDrop(e, dateStr)}
                              onDragOver={(e) => handleDragOver(e, dateStr)}
                              onDragLeave={() => setDragOverDate(null)}
                              title="Click to see the day's agenda"
                            >
                              <div className={`text-xs font-bold mb-1 w-6 h-6 flex items-center justify-center rounded-full ${isToday ? "bg-teal-600 text-white" : "text-slate-400"}`}>
                                {day}
                              </div>
                              <div className="space-y-0.5 flex-1 overflow-hidden">
                                {events.slice(0, 4).map((ev, idx) => {
                                  // Once an order is Completed, all of its chips
                                  // render in emerald. Step label is preserved so
                                  // the user still sees which step was plotted
                                  // (e.g. "Pre-Press" in green = "this step was
                                  // scheduled and the whole order is now done").
                                  // Quote chips are exempt — they're not order
                                  // pipeline steps, they're history, so they
                                  // keep their violet/green hue regardless.
                                  // Quote-kind events click through to /Quotes
                                  // (no order exists yet, or the user wants to
                                  // see the source quote). Order-kind events
                                  // open the OrderDetailModal inline.
                                  const isQuoteEvent = ev.kind === "quote";
                                  const subject = isQuoteEvent ? ev.quote : ev.order;
                                  const subjectName = isQuoteEvent
                                    ? getCompanyName(ev.quote, customers)
                                    : companyName(ev.order);
                                  // Each chip keeps its own step color even
                                  // on completed orders — mirrors the fix
                                  // in src/pages/Calendar.jsx. Previously
                                  // an "Order Goods" chip on a completed
                                  // order recolored to emerald, which read
                                  // as a step-color bug.
                                  const chipClass = ev.isDue
                                    ? "bg-rose-50 border-rose-300 text-rose-700"
                                    : STATUS_COLORS[ev.step] || "bg-slate-100 border-slate-200 dark:border-slate-700 text-slate-600";
                                  return (
                                    <div
                                      key={`${subject.id}-${ev.step}-${idx}`}
                                      draggable={!isQuoteEvent}
                                      onDragStart={isQuoteEvent ? undefined : (e) => {
                                        e.dataTransfer.effectAllowed = "move";
                                        e.dataTransfer.setData("orderId", ev.order.id);
                                        e.dataTransfer.setData("step", ev.step);
                                      }}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (isQuoteEvent) {
                                          navigate(`/Quotes?id=${ev.quote.id}`);
                                        } else {
                                          setViewing(ev.order);
                                        }
                                      }}
                                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${isQuoteEvent ? "cursor-pointer" : "cursor-grab"} truncate ${chipClass}`}
                                      title={`${subjectName} — ${ev.step}`}
                                    >
                                      {subjectName}
                                      <span className="opacity-60 ml-1">· {ev.step}</span>
                                    </div>
                                  );
                                })}
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
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-sm">
                  <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
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


      {/* Agenda side panel — planning view, not a literal mirror of the
          day cell. Two sections:
            (1) SCHEDULED — orders whose chip lands on this day
            (2) DUE SOON  — orders due within the next 14 days (so an
                operator clicking "today" sees what needs to happen this
                week, not just what's already scheduled)
          Each item carries a next-action hint derived from order state
          so the agenda answers "what should I be doing on this day".
          Mirrors src/pages/Calendar.jsx — keep both in sync. */}
      {selectedDate && (() => {
        const DUE_SOON_DAYS = 14;
        const dueSoonEnd = addDaysISO(selectedDate, DUE_SOON_DAYS);

        // SCHEDULED — orders with a chip on the selected day.
        const dayEvents = pointEvents[selectedDate] || [];
        const seen = new Set();
        const scheduled = [];
        for (const ev of dayEvents) {
          if (ev.kind === "quote") continue;
          const subject = ev.order;
          if (!subject?.id || seen.has(subject.id)) continue;
          seen.add(subject.id);
          scheduled.push(subject);
        }

        // DUE SOON — orders due after the selected day, within the
        // 14-day window, not completed, and not already in scheduled.
        const dueSoon = orders
          .filter((o) => {
            if (seen.has(o.id)) return false;
            if (o.status === "Completed") return false;
            if (!o.due_date) return false;
            const due = String(o.due_date).slice(0, 10);
            return due > selectedDate && due <= dueSoonEnd;
          })
          .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));

        const inWorks = [...scheduled, ...dueSoon];

        const fmtDateLong = (s) => {
          const [yr, mo, dy] = String(s).split("-").map(Number);
          if (!yr) return s;
          const d = new Date(yr, mo - 1, dy);
          return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
        };

        return (
          <div
            className="fixed inset-0 z-50 bg-slate-900/40 flex justify-end"
            onMouseDown={() => setSelectedDate(null)}
          >
            <div
              className="bg-white w-full max-w-md h-full overflow-y-auto shadow-2xl"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="sticky top-0 bg-white border-b border-slate-100 px-5 py-4 flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-widest text-slate-400">Agenda</div>
                  <h3 className="text-lg font-bold text-slate-900 mt-0.5">{fmtDateLong(selectedDate)}</h3>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {scheduled.length === 0 && dueSoon.length === 0
                      ? "Nothing scheduled or due in the next 14 days."
                      : (
                        <>
                          {scheduled.length > 0 && `${scheduled.length} scheduled`}
                          {scheduled.length > 0 && dueSoon.length > 0 && " · "}
                          {dueSoon.length > 0 && `${dueSoon.length} due in the next 14 days`}
                        </>
                      )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedDate(null)}
                  className="text-slate-400 hover:text-slate-700 text-lg leading-none px-2"
                  aria-label="Close agenda"
                >
                  ×
                </button>
              </div>

              <div className="p-5 space-y-5">
                {inWorks.length === 0 && (
                  <div className="text-sm text-slate-400 italic text-center py-10">
                    Nothing scheduled and nothing due in the next 14 days.
                  </div>
                )}

                {[
                  { key: "scheduled", title: "Scheduled today", rows: scheduled },
                  { key: "dueSoon",   title: "Due soon",        rows: dueSoon   },
                ].map(({ key, title, rows }) => rows.length === 0 ? null : (
                  <div key={key}>
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 mb-2">
                      {title} <span className="text-slate-300 ml-1">{rows.length}</span>
                    </div>
                    <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
                      {rows.map((o) => {
                        const start = String(o.date || "").slice(0, 10);
                        const end = o.due_date ? String(o.due_date).slice(0, 10) : null;
                        const isStartDay = start === selectedDate;
                        const isDueDay = end === selectedDate;
                        const isCompletedDay =
                          o.status === "Completed" &&
                          o.completed_date &&
                          String(o.completed_date).slice(0, 10) === selectedDate;
                        const dueRel = key === "dueSoon" && end ? relativeDueLabel(end, selectedDate) : "";
                        const actionHint = getOrderActionHint(o);
                        return (
                          <button
                            key={o.id}
                            type="button"
                            onClick={() => {
                              setViewing(o);
                              setSelectedDate(null);
                            }}
                            className="w-full text-left px-4 py-3 hover:bg-slate-50 transition flex items-start justify-between gap-3"
                          >
                            <div className="min-w-0">
                              <div className="font-semibold text-slate-800 text-sm truncate">
                                {companyName(o)}
                              </div>
                              <div className="text-xs text-slate-400 mt-0.5 truncate">
                                {o.order_id}
                                {dueRel && <span className="ml-2">· {dueRel}</span>}
                                {!dueRel && end && <span className="ml-2">· Due {end}</span>}
                              </div>
                              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                                <Badge s={o.status} />
                                {actionHint && (
                                  <span className="text-[10px] font-semibold uppercase tracking-widest bg-orange-50 text-orange-700 border border-orange-200 px-1.5 py-0.5 rounded">
                                    {actionHint}
                                  </span>
                                )}
                                {isStartDay && (
                                  <span className="text-[10px] font-semibold uppercase tracking-widest bg-teal-50 text-teal-700 border border-teal-200 px-1.5 py-0.5 rounded">
                                    Created today
                                  </span>
                                )}
                                {isDueDay && o.status !== "Completed" && (
                                  <span className="text-[10px] font-semibold uppercase tracking-widest bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded">
                                    Due today
                                  </span>
                                )}
                                {isCompletedDay && (
                                  <span className="text-[10px] font-semibold uppercase tracking-widest bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded">
                                    Completed today
                                  </span>
                                )}
                              </div>
                            </div>
                            <ChevronRight className="w-4 h-4 text-slate-300 shrink-0 mt-1" />
                        </button>
                      );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {viewing && (
        <OrderDetailModal
          order={orders.find((x) => x.id === viewing.id) || viewing}
          customer={customers[viewing.customer_id]}
          onClose={() => setViewing(null)}
          onAdvance={handleAdvance}
          onRevert={handleRevert}
          onComplete={handleComplete}
          onDelete={handleDelete}
          onTogglePaid={handleTogglePaid}
          onOrderFromAC={(order) => setAcOrderTarget(order)}
          sourcePO={poByOrderId[viewing.id]}
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

      {acOrderTarget && (
        <ACOrderModal
          order={acOrderTarget}
          user={user}
          onClose={() => setAcOrderTarget(null)}
          onPOCreated={(po) => {
            setPoByOrderId((prev) => ({ ...prev, [acOrderTarget.id]: po }));
          }}
        />
      )}
    </div>
  );
}