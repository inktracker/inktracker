import { useState, useEffect, useMemo } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import { O_STATUSES, fmtDate, fmtMoney, getOrderDisplayClient, getOrderDisplayJobTitle, sortSizeEntries } from "../components/shared/pricing";
import { buildOrderCompletionPlan } from "@/lib/orders/completeOrder";
import Badge from "../components/shared/Badge";
import OrderDetailModal from "../components/orders/OrderDetailModal";
import InvoiceDetailModal from "../components/invoices/InvoiceDetailModal";
import SSOrderModal from "../components/orders/SSOrderModal";
import AdvancedFilters from "../components/AdvancedFilters";
import OrderScheduleRow from "../components/calendar/OrderScheduleRow";
import { ChevronLeft, ChevronRight, CalendarDays, List, Hammer, Send, CheckCircle2, Clock, AlertTriangle } from "lucide-react";
import { todayInShopTz, nowInShopTz } from "@/lib/shopTimezone";

// FLOOR_STEPS used to have its own slightly-different status list
// (with "Quality Check" / "Packing" labels not present anywhere else
// in the codebase). Consolidated to O_STATUSES on 2026-05-12 so the
// production view, order detail modal, and broker analytics all
// walk the same pipeline. See O_STATUSES doc for the rationale.
const FLOOR_STEPS = O_STATUSES;

// Per-stage default tasks for the shop-floor checklist. The old
// Finishing / Quality Check / Packing entries collapsed into
// Printing on 2026-05-12 — same simplification as O_STATUSES.
const FLOOR_TASKS = {
  "Art Approval": ["Receive artwork", "Review file specs", "Send proof to customer", "Get approval"],
  "Order Goods":  ["Check inventory", "Place blank order", "Confirm delivery date", "Receive goods"],
  "Pre-Press":    ["Burn screens", "Set up registration", "Mix ink colors", "Color match (if needed)"],
  "Printing": [
    "Mount screens on press",
    "Run test prints",
    "Get test approval",
    "Run full batch",
    "Flash/cure prints",
    "Quality inspect",
    "Fold & tag",
    "Count pieces",
    "Bag/box order",
    "Stage for pickup/shipping",
  ],
};

const FLOOR_COLORS = {
  "Art Approval": { bg: "bg-purple-500", light: "bg-purple-50 text-purple-700 border-purple-200" },
  "Order Goods":  { bg: "bg-amber-500",  light: "bg-amber-50 text-amber-700 border-amber-200" },
  "Pre-Press":    { bg: "bg-blue-500",   light: "bg-blue-50 text-blue-700 border-blue-200" },
  "Printing":     { bg: "bg-indigo-500", light: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  "Completed":    { bg: "bg-slate-400",  light: "bg-slate-50 text-slate-600 border-slate-200" },
};

const STATUS_COLORS = {
  "Art Approval": "bg-slate-100 border-slate-300 text-slate-700",
  "Order Goods":  "bg-amber-50 border-amber-300 text-amber-800",
  "Pre-Press":    "bg-yellow-50 border-yellow-300 text-yellow-800",
  "Printing":     "bg-blue-50 border-blue-300 text-blue-800",
  "Completed":    "bg-teal-50 border-teal-300 text-teal-700",
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
  // Nested invoice preview when the user clicks "Preview Invoice"
  // on the OrderDetailModal for an already-invoiced order.
  const [viewingInvoice, setViewingInvoice] = useState(null);
  const [viewMode, setViewMode] = useState("calendar");
  const [filter, setFilter] = useState("All");
  const [originFilter, setOriginFilter] = useState("All");
  const [advFilters, setAdvFilters] = useState({});
  const [dragOverDate, setDragOverDate] = useState(null);
  const [user, setUser] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkStatus, setBulkStatus] = useState("");
  // Floor view state
  const [floorSelected, setFloorSelected] = useState(null);
  const [floorNote, setFloorNote] = useState("");
  const [floorSending, setFloorSending] = useState(false);
  const [floorUpdating, setFloorUpdating] = useState(false);
  const [floorFilter, setFloorFilter] = useState("Active");

  useEffect(() => {
    async function load() {
      try {
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
      } catch (err) {
        console.error("Production load failed:", err);
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

  // Keep floorSelected in sync with real-time updates
  useEffect(() => {
    if (floorSelected) {
      const fresh = orders.find(o => o.id === floorSelected.id);
      if (fresh) setFloorSelected(fresh);
    }
  }, [orders]);

  // Floor view action functions
  async function floorUpdateStatus(order, newStatus) {
    setFloorUpdating(true);
    try {
      const stepNotes = { ...(order.step_notes || {}) };
      if (!stepNotes[newStatus]) stepNotes[newStatus] = [];
      stepNotes[newStatus].push({
        text: `Status changed to ${newStatus}`,
        by: user?.full_name || user?.email || "Admin",
        at: new Date().toISOString(),
      });
      const updated = await base44.entities.Order.update(order.id, { status: newStatus, step_notes: stepNotes });
      setOrders(prev => prev.map(o => o.id === order.id ? updated : o));
      setFloorSelected(updated);
    } catch (err) { alert("Update failed: " + err.message); }
    finally { setFloorUpdating(false); }
  }

  async function floorToggleTask(order, task) {
    try {
      const step = order.status || "Pre-Press";
      const checklist = { ...(order.checklist || {}) };
      if (!checklist[step]) checklist[step] = {};
      const wasDone = !!checklist[step][task];
      checklist[step][task] = wasDone ? null : { by: user?.full_name || user?.email || "Admin", at: new Date().toISOString() };
      const updated = await base44.entities.Order.update(order.id, { checklist });
      setOrders(prev => prev.map(o => o.id === order.id ? updated : o));
      setFloorSelected(updated);
    } catch (err) { alert("Failed: " + err.message); }
  }

  async function floorTogglePrint(order, liIdx, size, impIdx) {
    try {
      const checklist = { ...(order.checklist || {}) };
      const printProgress = { ...(checklist.print_progress || {}) };
      const key = `${liIdx}-${size}-${impIdx}`;
      printProgress[key] = printProgress[key] ? null : { by: user?.full_name || user?.email || "Admin", at: new Date().toISOString() };
      checklist.print_progress = printProgress;
      const updated = await base44.entities.Order.update(order.id, { checklist });
      setOrders(prev => prev.map(o => o.id === order.id ? updated : o));
      setFloorSelected(updated);
    } catch (err) { alert("Failed: " + err.message); }
  }

  async function floorSendNote(order) {
    if (!floorNote.trim()) return;
    setFloorSending(true);
    try {
      const stepNotes = { ...(order.step_notes || {}) };
      const step = order.status || "Pre-Press";
      if (!stepNotes[step]) stepNotes[step] = [];
      stepNotes[step].push({ text: floorNote.trim(), by: user?.full_name || user?.email || "Admin", at: new Date().toISOString() });
      const updated = await base44.entities.Order.update(order.id, { step_notes: stepNotes });
      setOrders(prev => prev.map(o => o.id === order.id ? updated : o));
      setFloorSelected(updated);
      setFloorNote("");
    } catch (err) { alert("Failed: " + err.message); }
    finally { setFloorSending(false); }
  }

  const floorGetQty = (order) => (order.line_items || []).reduce((sum, li) =>
    sum + Object.values(li.sizes || {}).reduce((s, v) => s + (parseInt(v) || 0), 0), 0);

  const floorIsOverdue = (order) => order.due_date && order.due_date < new Date().toISOString().split("T")[0] && order.status !== "Completed";

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
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Production</h2>
          <p className="text-slate-400 text-sm mt-0.5">View and manage orders in calendar or table view</p>
        </div>
        <div className="flex gap-2">
          {[
            { id: "calendar", icon: CalendarDays, label: "Calendar" },
            { id: "table", icon: List, label: "Table" },
            { id: "floor", icon: Hammer, label: "Floor" },
          ].map(v => (
            <button key={v.id} onClick={() => setViewMode(v.id)}
              className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl transition ${viewMode === v.id ? "bg-indigo-600 text-white" : "border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:bg-slate-800 text-slate-600"}`}>
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
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition ${filter === s ? "bg-indigo-600 text-white border-indigo-600" : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-500 hover:border-indigo-300"}`}
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
            <div className="flex items-center gap-3 bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-2.5">
              <span className="text-sm font-semibold text-indigo-700">{selectedIds.size} selected</span>
              <select
                value={bulkStatus}
                onChange={(e) => setBulkStatus(e.target.value)}
                className="text-sm border border-indigo-200 rounded-lg px-2 py-1 bg-white dark:bg-slate-900 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
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
                        className="w-4 h-4 rounded border-slate-300 text-indigo-600 cursor-pointer"
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
                        className={`border-b border-slate-50 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer transition ${isChecked ? "bg-indigo-50/50" : ""} ${isOverdue ? "bg-red-50/50 dark:bg-red-950/20" : ""}`}
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
                            <span className="text-[11px] font-semibold text-violet-700 bg-violet-50 border border-violet-100 px-2 py-0.5 rounded-full">{o.assigned_press}</span>
                          ) : <span className="text-xs text-slate-300">—</span>}
                        </td>
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
            <button onClick={prevMonth} className="p-2 rounded-xl hover:bg-slate-100 border border-slate-200 dark:border-slate-700 transition">
              <ChevronLeft className="w-4 h-4 text-slate-600" />
            </button>
            <button onClick={goToday} className="text-sm font-semibold text-indigo-600 hover:underline">Today</button>
            <button onClick={nextMonth} className="p-2 rounded-xl hover:bg-slate-100 border border-slate-200 dark:border-slate-700 transition">
              <ChevronRight className="w-4 h-4 text-slate-600" />
            </button>
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 ml-2">{MONTH_NAMES[month]} {year}</h3>
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
                              className={`min-h-[110px] p-1.5 flex flex-col transition ${isDragOver ? "bg-indigo-50 ring-2 ring-inset ring-indigo-400" : "hover:bg-slate-50 dark:bg-slate-800"}`}
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
                                        : STATUS_COLORS[ev.step] || "bg-slate-100 border-slate-200 dark:border-slate-700 text-slate-600"
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

      {viewMode === "floor" && (() => {
        const floorOrders = floorFilter === "Active"
          ? orders.filter(o => o.status !== "Completed" && o.status !== "Shipped")
          : floorFilter === "Completed"
            ? orders.filter(o => o.status === "Completed" || o.status === "Shipped")
            : orders;
        const sel = floorSelected;
        const currentStepIdx = sel ? FLOOR_STEPS.indexOf(sel.status || "Pre-Press") : -1;
        const nextStep = currentStepIdx >= 0 && currentStepIdx < FLOOR_STEPS.length - 1 ? FLOOR_STEPS[currentStepIdx + 1] : null;
        const prevStep = currentStepIdx > 0 ? FLOOR_STEPS[currentStepIdx - 1] : null;

        return (
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden" style={{ minHeight: "70vh" }}>
            {/* Filter tabs */}
            <div className="border-b border-slate-200 dark:border-slate-700 px-5 py-2 flex gap-1">
              {["Active", "All", "Completed"].map(f => (
                <button key={f} onClick={() => { setFloorFilter(f); setFloorSelected(null); }}
                  className={`text-sm font-semibold px-5 py-2 rounded-lg transition ${floorFilter === f ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-100"}`}>
                  {f} {f === "Active" && `(${orders.filter(o => o.status !== "Completed" && o.status !== "Shipped").length})`}
                </button>
              ))}
            </div>

            <div className="flex" style={{ minHeight: "65vh" }}>
              {/* Order list — collapses when a job is selected */}
              <div className={`${sel ? "hidden md:block md:w-14" : "md:w-96"} border-r border-slate-200 dark:border-slate-700 overflow-y-auto transition-all`} style={{ maxHeight: "70vh" }}>
                {!sel ? (
                  <>
                    {floorOrders.length === 0 && <div className="p-8 text-center text-slate-400 text-sm">No orders</div>}
                    {floorOrders.map(order => {
                      const overdue = floorIsOverdue(order);
                      const colors = FLOOR_COLORS[order.status] || FLOOR_COLORS["Pre-Press"];
                      return (
                        <button key={order.id} onClick={() => setFloorSelected(order)}
                          className={`w-full text-left px-5 py-4 border-b border-slate-100 dark:border-slate-700 transition hover:bg-slate-50 dark:hover:bg-slate-800 ${overdue ? "bg-red-50 dark:bg-red-950" : ""}`}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-bold text-slate-800 dark:text-slate-200">{companyName(order)}</span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${colors.light}`}>{order.status || "Pre-Press"}</span>
                          </div>
                          <div className="flex items-center justify-between text-xs text-slate-400">
                            <span>{order.order_id} · {floorGetQty(order)} pcs</span>
                            <span className={overdue ? "text-red-500 font-semibold" : ""}>{overdue && "LATE · "}Due {fmtDate(order.due_date)}</span>
                          </div>
                        </button>
                      );
                    })}
                  </>
                ) : (
                  /* Collapsed: vertical dots for each order */
                  <div className="flex flex-col items-center py-2 gap-1">
                    {floorOrders.map(order => {
                      const active = sel?.id === order.id;
                      const colors = FLOOR_COLORS[order.status] || FLOOR_COLORS["Pre-Press"];
                      return (
                        <button key={order.id} onClick={() => setFloorSelected(order)}
                          title={`${companyName(order)} — ${order.order_id}`}
                          className={`w-9 h-9 rounded-lg flex items-center justify-center text-[10px] font-bold transition ${active ? "bg-indigo-600 text-white" : `${colors.light} border hover:opacity-80`}`}>
                          {(companyName(order) || "?")[0]}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Order detail */}
              <div className="flex-1 overflow-y-auto" style={{ maxHeight: "70vh" }}>
                {!sel ? (
                  <div className="flex items-center justify-center h-full p-8">
                    <div className="text-center text-slate-300">
                      <Hammer className="w-16 h-16 mx-auto mb-3 opacity-30" />
                      <p className="text-lg font-semibold">Select an order</p>
                      <p className="text-sm">Click a job to see details and update progress</p>
                    </div>
                  </div>
                ) : (
                  <div className="p-5 space-y-4 max-w-2xl mx-auto">
                    <button onClick={() => setFloorSelected(null)} className="md:hidden text-sm text-indigo-600 font-semibold mb-2">&larr; Back to list</button>

                    {/* Header */}
                    <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">{companyName(sel)}</h2>
                          <p className="text-sm text-slate-400">{sel.order_id} · {floorGetQty(sel)} pieces</p>
                        </div>
                        {floorIsOverdue(sel) && (
                          <span className="flex items-center gap-1 text-xs font-bold text-red-600 bg-red-50 border border-red-200 px-2 py-1 rounded-full">
                            <AlertTriangle className="w-3 h-3" /> OVERDUE
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-sm text-slate-500">
                        {sel.due_date && <span className="flex items-center gap-1"><Clock className="w-4 h-4" /> Due {fmtDate(sel.due_date)}</span>}
                      </div>
                    </div>

                    {/* Status pipeline */}
                    <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
                      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Production Status</h3>
                      <div className="flex gap-1 mb-4">
                        {FLOOR_STEPS.map(step => {
                          const isCurrent = step === (sel.status || "Pre-Press");
                          const isDone = FLOOR_STEPS.indexOf(step) < FLOOR_STEPS.indexOf(sel.status || "Pre-Press");
                          const c = FLOOR_COLORS[step];
                          return <div key={step} className={`flex-1 h-2 rounded-full transition ${isCurrent ? c.bg : isDone ? c.bg + " opacity-40" : "bg-slate-200"}`} title={step} />;
                        })}
                      </div>
                      <div className="flex items-center justify-between">
                        <span className={`text-sm font-bold px-3 py-1.5 rounded-lg border ${FLOOR_COLORS[sel.status]?.light || "bg-slate-50"}`}>{sel.status || "Pre-Press"}</span>
                        <div className="flex gap-2">
                          {prevStep && (
                            <button onClick={() => floorUpdateStatus(sel, prevStep)} disabled={floorUpdating}
                              className="text-xs font-semibold text-slate-500 border border-slate-200 px-3 py-2 rounded-lg hover:bg-slate-50 transition disabled:opacity-50">&larr; {prevStep}</button>
                          )}
                          {nextStep && (
                            <button onClick={() => floorUpdateStatus(sel, nextStep)} disabled={floorUpdating}
                              className="flex items-center gap-1 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded-lg transition disabled:opacity-50">
                              {floorUpdating ? "..." : <>Move to {nextStep} <ChevronRight className="w-4 h-4" /></>}
                            </button>
                          )}
                          {!nextStep && sel.status === "Completed" && (
                            <span className="flex items-center gap-1 text-sm font-bold text-emerald-600"><CheckCircle2 className="w-5 h-5" /> Complete</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Checklist */}
                    {(() => {
                      const step = sel.status || "Pre-Press";
                      const tasks = FLOOR_TASKS[step] || [];
                      if (tasks.length === 0) return null;
                      const checklist = sel.checklist || {};
                      const stepChecks = checklist[step] || {};
                      const doneCount = tasks.filter(t => !!stepChecks[t]).length;
                      return (
                        <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
                          <div className="flex items-center justify-between mb-3">
                            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Checklist — {step}</h3>
                            <span className="text-xs font-bold text-indigo-600">{doneCount}/{tasks.length}</span>
                          </div>
                          <div className="flex gap-1 mb-4">
                            {tasks.map((_, i) => <div key={i} className={`flex-1 h-1.5 rounded-full ${i < doneCount ? "bg-emerald-400" : "bg-slate-200"}`} />)}
                          </div>
                          <div className="space-y-1">
                            {tasks.map(task => {
                              const done = !!stepChecks[task];
                              const info = stepChecks[task];
                              return (
                                <button key={task} onClick={() => floorToggleTask(sel, task)}
                                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition ${done ? "bg-emerald-50 border border-emerald-200" : "bg-white dark:bg-slate-900 hover:bg-slate-100 border border-transparent"}`}>
                                  <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center flex-shrink-0 transition ${done ? "bg-emerald-500 border-emerald-500" : "border-slate-300"}`}>
                                    {done && <CheckCircle2 className="w-4 h-4 text-white" />}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <span className={`text-sm font-medium ${done ? "text-emerald-700 line-through" : "text-slate-700 dark:text-slate-300"}`}>{task}</span>
                                    {done && info?.by && <p className="text-[10px] text-emerald-500 mt-0.5">{info.by} · {info.at ? new Date(info.at).toLocaleTimeString() : ""}</p>}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Job ticket with print tracking */}
                    <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
                      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Job Ticket</h3>
                      <div className="space-y-3">
                        {(sel.line_items || []).map((li, idx) => {
                          const qty = Object.values(li.sizes || {}).reduce((s, v) => s + (parseInt(v) || 0), 0);
                          const imprints = (li.imprints || []).filter(imp => (imp.colors || 0) > 0);
                          const printProgress = sel.checklist?.print_progress || {};
                          return (
                            <div key={idx} className="bg-white dark:bg-slate-900 rounded-xl p-4">
                              <div className="flex items-center justify-between mb-2">
                                <div className="font-bold text-slate-800 dark:text-slate-200">{li.brand ? `${li.brand} ` : ""}{li.style || "Item"}{li.garmentColor ? ` — ${li.garmentColor}` : ""}</div>
                                <span className="text-lg font-bold text-indigo-600">{qty}</span>
                              </div>
                              <div className="flex flex-wrap gap-2 mb-3">
                                {imprints.map((imp, ii) => (
                                  <span key={ii} className="text-xs font-semibold text-slate-500 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1">
                                    {imp.location} · {imp.colors}c · {imp.technique || "Screen Print"}
                                  </span>
                                ))}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {sortSizeEntries(Object.entries(li.sizes || {})).filter(([, v]) => parseInt(v) > 0).map(([size, count]) => {
                                  const totalPrints = imprints.length;
                                  const donePrints = imprints.filter((_, ii) => !!printProgress[`${idx}-${size}-${ii}`]).length;
                                  const allDone = totalPrints > 0 && donePrints === totalPrints;
                                  const partial = donePrints > 0 && !allDone;
                                  return (
                                    <div key={size} className="flex flex-col items-center">
                                      <button onClick={() => {
                                        if (allDone) { imprints.forEach((_, ii) => floorTogglePrint(sel, idx, size, ii)); }
                                        else { const ni = imprints.findIndex((_, ii) => !printProgress[`${idx}-${size}-${ii}`]); if (ni !== -1) floorTogglePrint(sel, idx, size, ni); }
                                      }} className={`text-sm rounded-xl px-4 py-2.5 font-bold border-2 transition ${allDone ? "bg-emerald-100 border-emerald-400 text-emerald-700" : partial ? "bg-amber-50 border-amber-300 text-amber-700" : "bg-white dark:bg-slate-900 border-slate-200 text-slate-700 hover:border-indigo-300"}`}>
                                        {size}: {count}{allDone && <span className="ml-1">✓</span>}
                                      </button>
                                      {totalPrints > 1 && (
                                        <div className="flex gap-0.5 mt-1">
                                          {imprints.map((imp, ii) => (
                                            <button key={ii} onClick={() => floorTogglePrint(sel, idx, size, ii)}
                                              title={`${imp.location}: ${printProgress[`${idx}-${size}-${ii}`] ? "Done" : "Not done"}`}
                                              className={`w-3 h-3 rounded-full transition ${printProgress[`${idx}-${size}-${ii}`] ? "bg-emerald-400" : "bg-slate-300 hover:bg-slate-400"}`} />
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Job notes */}
                    {sel.notes && (
                      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
                        <h3 className="text-xs font-bold text-amber-600 uppercase tracking-widest mb-2">Job Notes</h3>
                        <p className="text-sm text-amber-800 leading-relaxed">{sel.notes}</p>
                      </div>
                    )}

                    {/* Updates */}
                    {(() => {
                      const allNotes = [];
                      Object.entries(sel.step_notes || {}).forEach(([step, notes]) => {
                        (notes || []).forEach(n => allNotes.push({ ...n, step }));
                      });
                      allNotes.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
                      if (allNotes.length === 0) return null;
                      return (
                        <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
                          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Updates</h3>
                          <div className="space-y-2 max-h-60 overflow-y-auto">
                            {allNotes.map((n, i) => (
                              <div key={i} className="flex gap-3 text-sm">
                                <div className="w-2 h-2 rounded-full bg-indigo-400 mt-1.5 flex-shrink-0" />
                                <div>
                                  <p className="text-slate-700 dark:text-slate-300">{n.text}</p>
                                  <p className="text-xs text-slate-400">{n.by} · {n.step} · {n.at ? new Date(n.at).toLocaleString() : ""}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Add note */}
                    <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
                      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Add Update</h3>
                      <div className="flex gap-2">
                        <input value={floorNote} onChange={e => setFloorNote(e.target.value)}
                          onKeyDown={e => e.key === "Enter" && floorSendNote(sel)}
                          placeholder="Add a note or update..."
                          className="flex-1 text-sm border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-300 dark:bg-slate-900 dark:text-slate-200" />
                        <button onClick={() => floorSendNote(sel)} disabled={floorSending || !floorNote.trim()}
                          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-3 rounded-xl transition disabled:opacity-50">
                          <Send className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

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