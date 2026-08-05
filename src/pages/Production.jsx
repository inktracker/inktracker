import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { base44, supabase } from "@/api/supabaseClient";
import { CalendarGridSkeleton } from "@/components/shared/Skeletons";
import { O_STATUSES, fmtDate, fmtMoney, getOrderDisplayClient, getOrderDisplayJobTitle } from "../components/shared/pricing";
import { runOrderCompletion } from "@/lib/orders/runOrderCompletion";
import Badge from "../components/shared/Badge";
import { addDaysISO, relativeDueLabel, getOrderActionHint, selectOverdueOrders } from "@/lib/calendar/agendaHints";
import { buildPointEvents } from "@/lib/calendar/pointEvents";
import { normalizePresses, normalizeAssignedPress } from "@/lib/presses/normalizePresses";
import {
  dayIndex as schedulerDayIndex,
  spanDays as schedulerSpanDays,
  placementsForPress as schedulerPlacementsForPress,
  hoursOnPressDay as schedulerHoursOnPressDay,
} from "@/lib/scheduler/schedulerHelpers";
import OrderDetailModal from "../components/orders/OrderDetailModal";
import OrderNotesIcon, { orderNotesTooltip } from "../components/orders/OrderNotesIcon";
import { canSeeMoney } from "@/lib/managerPermissions";
import InvoiceDetailModal from "../components/invoices/InvoiceDetailModal";
import ACOrderModal from "../components/orders/ACOrderModal";
import AdvancedFilters from "../components/AdvancedFilters";
import OrderScheduleRow from "../components/calendar/OrderScheduleRow";
import { ChevronLeft, ChevronRight, CalendarDays, List, LayoutGrid } from "lucide-react";
import { todayInShopTz, nowInShopTz } from "@/lib/shopTimezone";
import { localDateStr } from "@/lib/dateRangeUtils";
import { useBillingGate } from "@/lib/billing-gate";
import { notify } from "@/lib/notify";
import { revertQuoteOnOrderDelete } from "@/lib/orders/revertQuoteOnOrderDelete";
import { resolveQuoteLink, QUOTE_LINK_KIND } from "@/lib/quotes/resolveQuoteLink";
import { resolveJobLabel } from "@/lib/calendar/resolveJobLabel";
import { shopScope } from "@/lib/shopScope";

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
  // Press-run chips: the SCHEDULE surfacing on the calendar (scheduled_date
  // + assigned_press from the Press Schedule view). Distinct hue so a
  // planned press day reads differently from the Printing pipeline step.
  "Press Run":    "bg-cyan-50 border-cyan-400 text-cyan-800",
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

// Shared resolver lives in @/lib/calendar/resolveJobLabel — same one
// Calendar.jsx uses. Handles broker-vs-direct so all chips on a
// broker job render with the broker's name, never the end client.
const getCompanyName = (rec, customers) => resolveJobLabel(rec, customers);

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
  // Default to the table view on mobile — the calendar grid is too
  // cramped on narrow screens and the table is the actionable view
  // (sort, filter, advance status). Desktop still opens on calendar
  // since the month overview is the higher-density view there.
  const [viewMode, setViewMode] = useState(() =>
    (typeof window !== "undefined" && window.matchMedia?.("(max-width: 767px)").matches)
      ? "table"
      : "calendar"
  );
  const [filter, setFilter] = useState("All");
  const [originFilter, setOriginFilter] = useState("All");
  // Hide finished work so the table focuses on what still needs doing.
  const [hideCompleted, setHideCompleted] = useState(false);
  const [advFilters, setAdvFilters] = useState({});
  const [dragOverDate, setDragOverDate] = useState(null);
  const [user, setUser] = useState(null);
  // Shop record — needed for the press scheduler's lane list
  // (`shop.presses` is the configured press names from Account →
  // Presses). Soft-failing: if the shop row isn't there, the scheduler
  // renders an empty-state nudging the user to set up presses.
  const [shop, setShop] = useState(null);
  // Press-scheduler state: which week is visible (Monday = week start),
  // and which order is being dragged. Holding the drag target in state
  // (not just the dataTransfer payload) is what makes the lane highlight
  // when the drag is over it.
  const [scheduleWeekStart, setScheduleWeekStart] = useState(() => {
    const d = new Date();
    const dow = d.getDay(); // 0 = Sunday
    // Monday-start weeks. JS Sunday=0, so a Sunday-on-load lands on
    // the prior Monday (dow=0 → -6, else 1-dow).
    d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
    // localDateStr, not toISOString — the UTC date is tomorrow after
    // ~5pm Pacific, which started the week strip on Tuesday.
    return localDateStr(d);
  });
  const [draggingOrderId, setDraggingOrderId] = useState(null);
  const [dragOverKey, setDragOverKey] = useState(null);
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
        const [o, c, q, pos, shops] = await Promise.all([
          base44.entities.Order.filter({ shop_owner: shopScope(u) }, "-created_date", 200),
          base44.entities.Customer.filter({ shop_owner: shopScope(u) }),
          // All quotes — independent of conversion status. Lets a sent or
          // approved quote appear on the calendar before there's an order.
          base44.entities.Quote.filter({ shop_owner: shopScope(u) }, "-created_date", 500).catch(() => []),
          // POs that originated from one of this shop's orders. Drives
          // OrderDetailModal's tri-state Order from AS Colour button.
          // Soft-fails so a missing column / RLS issue doesn't break the page.
          base44.entities.PurchaseOrder.filter({ shop_owner: shopScope(u) }).catch(() => []),
          base44.entities.Shop.filter({ owner_email: u.email }).catch(() => []),
        ]);
        setShop((shops || [])[0] || null);
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

  // Extracted to lib/calendar/pointEvents.js (unit-tested there). Key rule:
  // a Completed order renders ONE "Completed" chip, sourced from
  // completed_date — step_dates["Completed"] used to add a second one.
  // The "Hide Completed" toggle (shared with the table view) also clears
  // finished work off the calendar — a Completed order drops all its chips
  // (its green completed chip AND any historical step chips) so the grid
  // shows only active work. Quote chips are unaffected.
  const pointEvents = useMemo(
    () => buildPointEvents(
      hideCompleted ? orders.filter((o) => o.status !== "Completed") : orders,
      quotes,
    ),
    [orders, quotes, hideCompleted],
  );

  const allActiveOrders = useMemo(() => {
    const active = orders.filter((o) => o.status !== "Completed");
    const withDue = active.filter((o) => o.due_date).sort((a, b) => a.due_date.localeCompare(b.due_date));
    const noDue = active.filter((o) => !o.due_date);
    return [...withDue, ...noDue];
  }, [orders]);

  // Table view filtering
  let filteredTable = filter === "All" ? orders : orders.filter((o) => o.status === filter);
  if (hideCompleted) filteredTable = filteredTable.filter((o) => o.status !== "Completed");
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
    const payload = { step_dates: stepDates };
    // On a Completed order, the calendar's "Completed" chip is sourced from
    // completed_date (buildPointEvents), not step_dates — so moving that chip
    // must move completed_date too or the drag silently does nothing and the
    // Dashboard/revenue windows keep the old date. Never CLEAR completed_date
    // here: status stays "Completed" and stats require the stamp.
    if (step === "Completed" && order.status === "Completed" && newDate) {
      payload.completed_date = newDate;
    }
    try {
      const updated = await base44.entities.Order.update(orderId, payload);
      setOrders((prev) => prev.map((o) => (o.id === orderId ? updated : o)));
    } catch (err) {
      notify.error("Couldn't save that schedule date", err);
    }
  }

  async function handleUpdateDueDate(orderId, newDate) {
    try {
      const updated = await base44.entities.Order.update(orderId, { due_date: newDate || null });
      setOrders((prev) => prev.map((o) => (o.id === orderId ? updated : o)));
    } catch (err) {
      notify.error("Couldn't update the due date", err);
    }
  }

  async function handleAdvance(id) {
    const order = orders.find((o) => o.id === id);
    const idx = O_STATUSES.indexOf(order.status);
    if (idx < 0 || idx >= O_STATUSES.length - 1) return;
    const nextStatus = O_STATUSES[idx + 1];
    // When advancing INTO Completed, also stamp completed_date.
    // Calendar's green chip requires BOTH status==="Completed" AND
    // completed_date — without the stamp the order silently
    // disappears from the calendar.
    const payload = { status: nextStatus };
    if (nextStatus === "Completed" && !order.completed_date) {
      payload.completed_date = todayInShopTz();
    }
    try {
      const updated = await base44.entities.Order.update(id, payload);
      setOrders((prev) => prev.map((o) => (o.id === id ? updated : o)));
      // Modal lifecycle: keep the order modal open while the operator
      // walks through the production pipeline (Art Approval → Order
      // Goods → Pre-Press → Printing). Closing on every click made
      // them lose their place. But the FINAL transition to "Completed"
      // ends the work on this card — close the modal so they return
      // to the production queue and pick up the next job.
      if (viewing?.id === id) {
        if (nextStatus === "Completed") setViewing(null);
        else setViewing(updated);
      }
    } catch (err) {
      notify.error("Couldn't update the order status", err);
    }
  }

  async function handleRevert(id) {
    const order = orders.find((o) => o.id === id);
    const idx = O_STATUSES.indexOf(order.status);
    if (idx <= 0) return;
    try {
      const updated = await base44.entities.Order.update(id, { status: O_STATUSES[idx - 1] });
      setOrders((prev) => prev.map((o) => (o.id === id ? updated : o)));
      if (viewing?.id === id) setViewing(updated);
    } catch (err) {
      notify.error("Couldn't move the order back a step", err);
    }
  }

  async function handleComplete(order) {
    if (billingGate("complete orders")) return;
    try {
      const updated = await runOrderCompletion({ order, user, base44 });
      setOrders((prev) => prev.map((o) => (o.id === order.id ? updated : o)));
      // Keep the modal open on the just-completed order so its action bar can
      // reveal Create Invoice → Send. Only updates if this order is being viewed.
      setViewing((prev) => (prev && prev.id === order.id ? updated : prev));
    } catch (err) {
      notify.error("Couldn't complete the order", err);
    }
  }

  async function handleDelete(id) {
    const order = orders.find((o) => o.id === id);
    // Completed orders are preserved on purpose: a BEFORE DELETE trigger
    // refuses the delete so their invoices never dangle (a bug that once
    // orphaned every completed invoice). Firing the delete anyway just
    // throws a check-constraint error the user can't act on — so explain
    // the "why" and the way out up front instead.
    if (order?.status === "Completed") {
      notify.info(
        "Completed orders are kept on file",
        "This order is marked Completed, so it stays as a historical record and its invoice remains linked. To remove it, move it back a step first (Revert), then delete.",
      );
      return;
    }
    // Honest confirm copy: an order made from a quote isn't lost — the quote is
    // restored (to the broker for broker jobs, else to your Quotes list).
    const msg = !order?.quote_id
      ? "Delete this order?"
      : (order?.broker_id || order?.broker_email)
        ? "Delete this order?\n\nIts quote goes back to the broker, so nothing is lost."
        : "Delete this order?\n\nIts originating quote returns to your Quotes list, so nothing is lost.";
    if (!window.confirm(msg)) return;
    try {
      await base44.entities.Order.delete(id);
    } catch (err) {
      notify.error("Couldn't delete the order", err);
      return;
    }
    setOrders((prev) => prev.filter((o) => o.id !== id));
    setViewing(null);

    // Restore the originating quote: regular orders return to Quotes as
    // "Approved"; broker orders go back to the broker (+ ShopActionFeed ping).
    revertQuoteOnOrderDelete(order);
  }

  async function handleTogglePaid(order) {
    const newPaid = !order.paid;
    let updated;
    try {
      updated = await base44.entities.Order.update(order.id, {
        paid: newPaid,
        paid_date: newPaid ? todayInShopTz() : null,
      });
    } catch (err) {
      notify.error(`Couldn't mark the order ${newPaid ? "paid" : "unpaid"}`, err);
      return;
    }
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
        try {
          const updated = await base44.entities.Order.update(orderId, { date: dateStr });
          setOrders((prev) => prev.map((o) => (o.id === orderId ? updated : o)));
        } catch (err) {
          notify.error("Couldn't move that order on the calendar", err);
        }
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

  // ── Press scheduler handlers ──────────────────────────────────────
  // Native HTML5 DnD; identical pattern to the calendar above so the
  // surrounding UX is consistent. Cell key is `${press}|${date}`. The
  // Unscheduled pool uses key `unscheduled` and a sentinel "drop"
  // payload that clears both fields.
  async function handleScheduleAssign(orderId, press, startDate, endDate) {
    if (!orderId) return;
    try {
      const safeEnd = endDate && endDate >= startDate ? endDate : startDate;
      const updated = await base44.entities.Order.update(orderId, {
        assigned_press: press,
        scheduled_date: startDate,
        scheduled_end_date: safeEnd,
      });
      setOrders(prev => prev.map(o => (o.id === updated.id ? updated : o)));
    } catch (err) {
      notify.error("Couldn't schedule that order", err);
    }
  }

  async function handleScheduleResize(orderId, newEnd) {
    if (!orderId) return;
    const o = orders.find(x => x.id === orderId);
    if (!o?.scheduled_date) return;
    // Clamp end so it never precedes start — matches the DB CHECK.
    const safeEnd = newEnd < o.scheduled_date ? o.scheduled_date : newEnd;
    try {
      const updated = await base44.entities.Order.update(orderId, {
        scheduled_end_date: safeEnd,
      });
      setOrders(prev => prev.map(x => (x.id === updated.id ? updated : x)));
    } catch (err) {
      notify.error("Couldn't resize that schedule", err);
    }
  }

  async function handleScheduleUnassign(orderId) {
    if (!orderId) return;
    try {
      const updated = await base44.entities.Order.update(orderId, {
        scheduled_date: null,
        scheduled_end_date: null,
      });
      setOrders(prev => prev.map(o => (o.id === updated.id ? updated : o)));
    } catch (err) {
      notify.error("Couldn't unschedule that order", err);
    }
  }

  function shiftScheduleWeek(deltaDays) {
    const d = new Date(scheduleWeekStart);
    d.setDate(d.getDate() + deltaDays);
    setScheduleWeekStart(d.toISOString().split("T")[0]);
  }

  function scheduleWeekDays() {
    const days = [];
    const base = new Date(scheduleWeekStart);
    for (let i = 0; i < 7; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      days.push(d.toISOString().split("T")[0]);
    }
    return days;
  }

  async function handleBulkStatusUpdate() {
    if (!bulkStatus || selectedIds.size === 0) return;
    // Bulk "Completed" must run the full completion flow, not a bare
    // status write: a bare write skips completed_date (order vanishes
    // from the calendar and revenue stats) and skips invoice /
    // performance-row creation entirely.
    if (bulkStatus === "Completed" && billingGate("complete orders")) return;
    const ids = [...selectedIds];
    const updatedById = {};
    const failed = [];
    for (const id of ids) {
      const order = orders.find((o) => o.id === id);
      if (!order) continue;
      try {
        if (bulkStatus === "Completed") {
          updatedById[id] = order.status === "Completed"
            ? order
            : await runOrderCompletion({ order, user, base44 });
        } else {
          updatedById[id] = await base44.entities.Order.update(id, { status: bulkStatus });
        }
      } catch (e) {
        console.error("Bulk status update failed:", e);
        failed.push(order.order_id || order.customer_name || id);
      }
    }
    setOrders((prev) => prev.map((o) => updatedById[o.id] || o));
    setSelectedIds(new Set());
    setBulkStatus("");
    if (failed.length > 0) {
      notify.error(
        `Updated ${ids.length - failed.length} of ${ids.length} orders`,
        `These didn't update: ${failed.join(", ")}. They were left unchanged — try them individually.`,
      );
    }
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
  // Each cell is { day, year, month, inMonth } so leading and trailing
  // slots render the actual adjacent-month dates (dimmed) instead of
  // empty grey blocks. Same fix Calendar.jsx got — Production has its
  // own grid implementation that also needed the change.
  const cells = [];
  const prevM = month === 0 ? 11 : month - 1;
  const prevY = month === 0 ? year - 1 : year;
  const daysInPrev = getDaysInMonth(prevY, prevM);
  for (let i = firstDay - 1; i >= 0; i--) {
    cells.push({ day: daysInPrev - i, year: prevY, month: prevM, inMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, year, month, inMonth: true });
  }
  const nextM = month === 11 ? 0 : month + 1;
  const nextY = month === 11 ? year + 1 : year;
  let trail = 1;
  while (cells.length % 7 !== 0) {
    cells.push({ day: trail++, year: nextY, month: nextM, inMonth: false });
  }
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const companyName = (o) => getCompanyName(o, customers);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Production</h2>
          <p className="text-slate-500 text-sm mt-0.5">View and manage orders in calendar or table view</p>
        </div>
        <div className="flex gap-2">
          {[
            { id: "calendar", icon: CalendarDays, label: "Calendar" },
            { id: "schedule", icon: LayoutGrid, label: "Press Schedule" },
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
          <div className="flex gap-2 items-center">
            {["All", "Internal", "Broker"].map((o) => (
              <button
                key={o}
                onClick={() => setOriginFilter(o)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition ${originFilter === o ? "bg-slate-800 text-white border-slate-800" : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-400"}`}
              >
                {o}
              </button>
            ))}
            <button
              onClick={() => setHideCompleted((v) => !v)}
              className={`ml-auto text-xs font-semibold px-3 py-1.5 rounded-full border transition ${hideCompleted ? "bg-emerald-600 text-white border-emerald-600" : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-500 hover:border-emerald-300"}`}
              title="Hide orders marked Completed so you only see active work"
            >
              {hideCompleted ? "Show Completed" : "Hide Completed"}
            </button>
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
                className="text-sm text-slate-500 hover:text-slate-600 transition ml-auto"
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
                      <th key={h} className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-widest">
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
                        <td className="px-3 py-3.5 font-mono text-xs text-slate-500">{o.order_id}</td>
                        <td className="px-3 py-3.5">
                          <div className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                            {getOrderDisplayClient(o, customers[o.customer_id])}
                            <OrderNotesIcon order={o} />
                          </div>
                          {getOrderDisplayJobTitle(o, customers[o.customer_id]) && (
                            <div className="text-xs text-slate-500 mt-0.5">
                              Job: {getOrderDisplayJobTitle(o, customers[o.customer_id])}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-3.5">
                          {o.due_date ? (
                            <span className={`text-sm ${isOverdue ? "text-red-600 font-bold" : "text-slate-500"}`}>
                              {fmtDate(o.due_date)}
                              {isOverdue && <span className="ml-1 text-[10px] text-red-500 font-semibold">LATE</span>}
                            </span>
                          ) : <span className="text-xs text-slate-300">—</span>}
                        </td>
                        <td className="px-3 py-3.5">
                          {normalizeAssignedPress(o.assigned_press) ? (
                            <div>
                              <span className="text-[11px] font-semibold text-green-700 bg-green-50 border border-green-100 px-2 py-0.5 rounded-full">{normalizeAssignedPress(o.assigned_press)}</span>
                              {/* Unification: the table now reflects the SCHEDULE
                                  (when this order runs), not just the due date. */}
                              {o.scheduled_date && (
                                <div className="text-[10px] text-slate-500 mt-1">runs {fmtDate(o.scheduled_date)}</div>
                              )}
                            </div>
                          ) : <span className="text-xs text-slate-300">—</span>}
                        </td>
                        <td className="px-3 py-3.5"><Badge s={o.status} /></td>
                        <td className="px-3 py-3.5 text-right text-teal-400 text-xs font-semibold">View →</td>
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
                        <div className="font-mono text-xs text-slate-500">{o.order_id}</div>
                        <div className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                          {getOrderDisplayClient(o, customers[o.customer_id])}
                          <OrderNotesIcon order={o} />
                        </div>
                        {getOrderDisplayJobTitle(o, customers[o.customer_id]) && (
                          <div className="text-xs text-slate-500 mt-0.5">
                            Job: {getOrderDisplayJobTitle(o, customers[o.customer_id])}
                          </div>
                        )}
                      </div>
                      <Badge s={o.status} />
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-500 gap-3">
                      <span>Due: {o.due_date ? fmtDate(o.due_date) : "—"}</span>
                      {canSeeMoney(user) && <span className="font-bold text-slate-800 dark:text-slate-200">{fmtMoney(o.total || 0)}</span>}
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
            <button
              onClick={() => setHideCompleted((v) => !v)}
              className={`ml-auto text-xs font-semibold px-3 py-1.5 rounded-full border transition ${hideCompleted ? "bg-emerald-600 text-white border-emerald-600" : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-500 hover:border-emerald-300"}`}
              title="Hide orders marked Completed so the calendar shows only active work"
            >
              {hideCompleted ? "Show Completed" : "Hide Completed"}
            </button>
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
              { label: "Press Run",      cls: STATUS_COLORS["Press Run"] },
              { label: "Due",            cls: "bg-rose-50 border-rose-300 text-rose-700" },
              { label: "Completed",      cls: STATUS_COLORS["Completed"] },
            ].filter((item) => !(hideCompleted && item.label === "Completed")).map((item) => (
              <span key={item.label} className={`px-1.5 py-0.5 rounded border ${item.cls}`}>
                {item.label}
              </span>
            ))}
          </div>

          {loading ? (
            <CalendarGridSkeleton />
          ) : (
            <>
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-sm">
                <div className="grid grid-cols-7 border-b border-slate-100 dark:border-slate-700">
                  {DAY_LABELS.map((d) => (
                    <div key={d} className="py-2 text-center text-xs font-semibold text-slate-500 uppercase tracking-widest">{d}</div>
                  ))}
                </div>

                {weeks.map((week, wIdx) => {
                   return (
                     <div key={wIdx} className="relative">
                       <div className="grid grid-cols-7 divide-x divide-y divide-slate-100">
                         {week.map((cell, dIdx) => {
                           // cell is always populated — adjacent-month
                           // slots carry their own year/month so dateStr
                           // resolves correctly and chips for the
                           // bordering days still render.
                           const { day, year: cellY, month: cellM, inMonth } = cell;
                           const dateStr = toDateStr(cellY, cellM, day);
                           const isToday = dateStr === today;
                           const events = pointEvents[dateStr] || [];
                           const isDragOver = dragOverDate === dateStr;

                          return (
                            <div
                              key={dateStr}
                              className={`min-h-[110px] p-1.5 flex flex-col transition cursor-pointer ${
                                isDragOver
                                  ? "bg-teal-50 ring-2 ring-inset ring-teal-400"
                                  : selectedDate === dateStr
                                    ? "bg-teal-50/60"
                                    // Adjacent-month cells: subtle gray wash so the
                                    // current month still reads as primary. Same
                                    // interactivity (click + drop) as in-month cells.
                                    : inMonth
                                      ? "hover:bg-slate-50 dark:bg-slate-800"
                                      : "bg-slate-50/40 hover:bg-slate-50 dark:bg-slate-800/40"
                              }`}
                              onClick={() => setSelectedDate(dateStr)}
                              onDrop={(e) => handleDrop(e, dateStr)}
                              onDragOver={(e) => handleDragOver(e, dateStr)}
                              onDragLeave={() => setDragOverDate(null)}
                              title="Click to see the day's agenda"
                            >
                              <div className={`text-xs font-bold mb-1 w-6 h-6 flex items-center justify-center rounded-full ${
                                isToday
                                  ? "bg-teal-600 text-white"
                                  : inMonth ? "text-slate-500" : "text-slate-300"
                              }`}>
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
                                          // Same resolution as Calendar — converted quotes
                                          // open the order modal; /Quotes is the fallback
                                          // only for genuinely unconverted rows.
                                          const r = resolveQuoteLink(ev.quote, orders);
                                          if (r.kind === QUOTE_LINK_KIND.OPEN_ORDER) setViewing(r.order);
                                          else if (r.kind === QUOTE_LINK_KIND.NAVIGATE_ORDERS) navigate("/Orders");
                                          else navigate(`/Quotes?id=${r.quoteId}`);
                                        } else {
                                          setViewing(ev.order);
                                        }
                                      }}
                                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${isQuoteEvent ? "cursor-pointer" : "cursor-grab"} truncate ${chipClass}`}
                                      // Month chips are too small for the notes icon —
                                      // surface job notes via the hover tooltip instead.
                                      title={`${subjectName} — ${ev.step}${ev.press ? ` on ${ev.press}` : ""}${orderNotesTooltip(subject) ? `\nNotes: ${orderNotesTooltip(subject)}` : ""}`}
                                    >
                                      {subjectName}
                                      <span className="opacity-60 ml-1">· {ev.press ? ev.press : ev.step}</span>
                                    </div>
                                  );
                                })}
                                {events.length > 4 && (
                                  <div className="text-[10px] text-slate-500 font-semibold px-1">+{events.length - 4} more</div>
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

      {viewMode === "schedule" && (() => {
        const presses = normalizePresses(shop?.presses);
        if (presses.length === 0) {
          return (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-700 p-8 text-center">
              <LayoutGrid className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">No presses configured yet</div>
              <p className="text-sm text-slate-500 mb-4">Add your presses on the Account page to start scheduling.</p>
              <button
                onClick={() => navigate("/Account")}
                className="text-xs font-bold uppercase tracking-wider px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white transition"
              >
                Go to Account → Presses
              </button>
            </div>
          );
        }

        const days = scheduleWeekDays();
        const dayLabel = (iso) => {
          const d = new Date(iso + "T00:00:00");
          return d.toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" });
        };
        const isToday = (iso) => iso === today;
        const PRESS_CAPACITY_HOURS = 8;
        const ROW_HEIGHT_PX = 36;       // chip + spacing
        const ROW_PADDING_PX = 8;       // top padding inside the lane
        const FOOTER_HEIGHT_PX = 16;    // capacity badges sit below stacked chips

        // Active (non-Completed) orders the scheduler considers.
        const scheduleableOrders = orders.filter(o => o.status !== "Completed");
        // Unscheduled = either no scheduled_date OR no assigned_press.
        const unscheduled = scheduleableOrders
          .filter(o => !o.scheduled_date || !o.assigned_press)
          .sort((a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999"));

        // Multi-day helpers live in src/lib/scheduler/schedulerHelpers.
        // Re-bound here as locals so the closure-captured weekStart
        // doesn't have to be threaded through every call site below.
        const weekStart = days[0];
        const spanDays = schedulerSpanDays;
        const placementsForPress = (pressName) =>
          schedulerPlacementsForPress(scheduleableOrders, pressName, weekStart, 7);
        const hoursOnPressDay = (pressName, day) =>
          schedulerHoursOnPressDay(scheduleableOrders, pressName, day);
        // dayIndex isn't used directly in this scope anymore, but
        // expose it via a thin wrapper in case a future widget needs
        // it without re-importing.
         
        const dayIndex = (iso) => schedulerDayIndex(iso, weekStart);

        // ── DnD payload helpers ───────────────────────────────────────
        // text/plain carries the orderId as a fallback.
        // application/json carries { orderId, mode, spanDays? } so the
        // drop target can preserve duration on move (and skip duration
        // logic on resize).
        function handleChipDragStart(e, order, mode) {
          const payload = { orderId: order.id, mode };
          if (mode === "move") payload.spanDays = spanDays(order);
          e.dataTransfer.setData("text/plain", order.id);
          e.dataTransfer.setData("application/json", JSON.stringify(payload));
          e.dataTransfer.effectAllowed = "move";
          setDraggingOrderId(order.id);
        }
        function handleChipDragEnd() {
          setDraggingOrderId(null);
          setDragOverKey(null);
        }
        function handleCellDragOver(e, key) {
          e.preventDefault();
          if (key !== dragOverKey) setDragOverKey(key);
        }
        function readPayload(e) {
          let payload = {};
          try { payload = JSON.parse(e.dataTransfer.getData("application/json") || "{}"); } catch {}
          const orderId = payload.orderId || e.dataTransfer.getData("text/plain");
          return { orderId, mode: payload.mode, spanDays: payload.spanDays };
        }
        function handleCellDrop(e, press, day) {
          e.preventDefault();
          const { orderId, mode, spanDays: span } = readPayload(e);
          setDragOverKey(null);
          setDraggingOrderId(null);
          if (!orderId) return;
          if (mode === "resize") {
            handleScheduleResize(orderId, day);
          } else {
            const dur = Math.max(1, span || 1);
            const endDate = addDaysISO(day, dur - 1);
            handleScheduleAssign(orderId, press, day, endDate);
          }
        }
        function handleUnscheduledDrop(e) {
          e.preventDefault();
          const { orderId, mode } = readPayload(e);
          setDragOverKey(null);
          setDraggingOrderId(null);
          // A resize drag dropped on the pool is meaningless — ignore
          // so the user doesn't accidentally unschedule when reaching
          // for the wrong target.
          if (orderId && mode !== "resize") handleScheduleUnassign(orderId);
        }

        // ── Chip render ───────────────────────────────────────────────
        function OrderChip({ order, clippedLeft, clippedRight }) {
          const client = companyName(order);
          const hrs = Number(order.estimated_hours) || 0;
          const total = spanDays(order);
          return (
            <div
              draggable
              onDragStart={(e) => handleChipDragStart(e, order, "move")}
              onDragEnd={handleChipDragEnd}
              onClick={() => setViewing(order)}
              className={`group relative select-none cursor-grab active:cursor-grabbing bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg px-2 py-1 text-[11px] leading-tight transition h-[32px] flex items-center ${draggingOrderId === order.id ? "opacity-50" : ""} ${clippedLeft ? "rounded-l-none border-l-0" : ""} ${clippedRight ? "rounded-r-none border-r-0" : ""}`}
              title={`${order.order_id || ""} · ${client}\nDue ${fmtDate(order.due_date)}${total > 1 ? ` · ${total}-day span` : ""}${orderNotesTooltip(order) ? `\nNotes: ${orderNotesTooltip(order)}` : ""}`}
            >
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-teal-900 truncate flex items-center gap-1">
                  <span className="truncate">{client}</span>
                  <OrderNotesIcon order={order} className="!text-amber-600" />
                </div>
                <div className="text-teal-700/80 flex items-center justify-between gap-2 text-[10px]">
                  {/* Unification: due-date pressure INSIDE the schedule view,
                      so the scheduler can re-prioritize a lane without
                      flipping to the calendar/table. Red = overdue,
                      amber = due within 3 days. */}
                  {(() => {
                    const isLate = order.due_date && order.due_date < today && order.status !== "Completed";
                    const dueLbl = order.due_date ? relativeDueLabel(order.due_date, today) : "";
                    const soon = /Due (today|tomorrow|in [1-3] days)$/.test(dueLbl);
                    return (
                      <span className={`truncate ${isLate ? "text-red-600 font-bold" : soon ? "text-amber-700 font-semibold" : ""}`}>
                        {dueLbl || order.order_id || "—"}
                      </span>
                    );
                  })()}
                  {hrs > 0 && <span className="font-semibold tabular-nums">{hrs}h</span>}
                </div>
              </div>
              {/* Right-edge resize handle. Its own draggable so the
                  outer chip's onDragStart doesn't fire — HTML5 DnD
                  dispatches dragstart on the deepest draggable. */}
              {!clippedRight && (
                <div
                  draggable
                  onDragStart={(e) => { e.stopPropagation(); handleChipDragStart(e, order, "resize"); }}
                  onDragEnd={handleChipDragEnd}
                  onClick={(e) => e.stopPropagation()}
                  className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize bg-teal-300/0 hover:bg-teal-300/40 rounded-r-lg"
                  title="Drag to resize span"
                />
              )}
            </div>
          );
        }

        return (
          <div className="space-y-4">
            {/* Week navigation */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => shiftScheduleWeek(-7)}
                className="p-2 rounded-xl hover:bg-slate-100 border border-slate-200 dark:border-slate-700 transition"
              >
                <ChevronLeft className="w-4 h-4 text-slate-600" />
              </button>
              <button
                onClick={() => {
                  const d = new Date();
                  const dow = d.getDay();
                  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
                  setScheduleWeekStart(localDateStr(d));
                }}
                className="text-sm font-semibold text-teal-600 hover:underline"
              >
                This week
              </button>
              <button
                onClick={() => shiftScheduleWeek(7)}
                className="p-2 rounded-xl hover:bg-slate-100 border border-slate-200 dark:border-slate-700 transition"
              >
                <ChevronRight className="w-4 h-4 text-slate-600" />
              </button>
              <span className="text-sm font-semibold text-slate-700">
                Week of {dayLabel(days[0])} – {dayLabel(days[6])}
              </span>
            </div>

            {/* Unscheduled pool */}
            <div
              onDragOver={(e) => handleCellDragOver(e, "unscheduled")}
              onDrop={handleUnscheduledDrop}
              className={`bg-white dark:bg-slate-900 rounded-2xl border-2 border-dashed p-3 transition ${dragOverKey === "unscheduled" ? "border-amber-400 bg-amber-50/40" : "border-slate-200 dark:border-slate-700"}`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
                  Unscheduled · {unscheduled.length}
                </div>
                <div className="text-[11px] text-slate-500">Drag onto a press lane to schedule</div>
              </div>
              {unscheduled.length === 0 ? (
                <div className="text-xs text-slate-500 italic px-1 py-1">Everything's scheduled.</div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {unscheduled.map(o => (
                    <div key={o.id} className="w-44">
                      <OrderChip order={o} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Press × day overlay grid */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-700 overflow-x-auto">
              <div className="min-w-[1100px]">
                {/* Header */}
                <div className="grid bg-slate-50 dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 sticky top-0" style={{ gridTemplateColumns: "140px repeat(7, minmax(0, 1fr))" }}>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 px-3 py-2">Press</div>
                  {days.map(d => (
                    <div
                      key={d}
                      className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-2 border-l border-slate-100 dark:border-slate-700 ${isToday(d) ? "text-teal-700 bg-teal-50" : "text-slate-500"}`}
                    >
                      {dayLabel(d)}
                    </div>
                  ))}
                </div>

                {/* Lanes */}
                {presses.map(press => {
                  const { items, maxStack } = placementsForPress(press.name);
                  const laneHeight = Math.max(60, ROW_PADDING_PX * 2 + (maxStack || 1) * ROW_HEIGHT_PX + FOOTER_HEIGHT_PX);
                  return (
                    <div
                      key={press.name}
                      className="grid border-t border-slate-100 dark:border-slate-700"
                      style={{ gridTemplateColumns: "140px repeat(7, minmax(0, 1fr))" }}
                    >
                      {/* Lane label */}
                      <div className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-200 bg-slate-50/60 dark:bg-slate-800/40 text-xs">
                        <div className="truncate">{press.name}</div>
                        {press.colors ? (
                          <div className="text-[10px] font-bold uppercase tracking-wider text-teal-700 bg-teal-100/70 inline-block rounded px-1.5 py-0.5 mt-1">
                            {press.colors}-color
                          </div>
                        ) : (
                          <div className="text-[10px] text-slate-500 mt-1">Set colors on Account</div>
                        )}
                      </div>

                      {/* Background day cells + overlay chips. We
                          render this as col-span 7 so chips can
                          absolutely position by left/width
                          percentage. */}
                      <div className="relative" style={{ gridColumn: "2 / span 7", height: laneHeight }}>
                        {/* Background day cells (drop targets) */}
                        <div className="absolute inset-0 grid" style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}>
                          {days.map(d => {
                            const k = `${press.name}|${d}`;
                            const over = dragOverKey === k;
                            const hrs = hoursOnPressDay(press.name, d);
                            const cap = press.colors && hrs > 0 ? PRESS_CAPACITY_HOURS : PRESS_CAPACITY_HOURS;
                            const overCap = hrs > cap;
                            const over80 = hrs > cap * 0.8 && !overCap;
                            return (
                              <div
                                key={d}
                                onDragOver={(e) => handleCellDragOver(e, k)}
                                onDrop={(e) => handleCellDrop(e, press.name, d)}
                                className={`border-l border-slate-100 dark:border-slate-700 transition relative ${over ? "bg-teal-50/60" : isToday(d) ? "bg-teal-50/20" : ""}`}
                              >
                                {hrs > 0 && (
                                  <div className={`absolute bottom-1 left-1.5 text-[10px] font-semibold tabular-nums ${overCap ? "text-rose-600" : over80 ? "text-amber-600" : "text-slate-500"}`}>
                                    {hrs}/{cap}h
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {/* Overlay chips, positioned by percentage so
                            they span multiple background cells. */}
                        {items.map(p => {
                          const span = p.endCol - p.startCol + 1;
                          const leftPct = (p.startCol / 7) * 100;
                          const widthPct = (span / 7) * 100;
                          return (
                            <div
                              key={p.order.id}
                              className="absolute"
                              style={{
                                left: `calc(${leftPct}% + 4px)`,
                                width: `calc(${widthPct}% - 8px)`,
                                top: ROW_PADDING_PX + p.stackIdx * ROW_HEIGHT_PX,
                                height: ROW_HEIGHT_PX - 4,
                              }}
                            >
                              <OrderChip
                                order={p.order}
                                clippedLeft={p.clippedLeft}
                                clippedRight={p.clippedRight}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="text-[11px] text-slate-500 leading-snug">
              Capacity assumes {PRESS_CAPACITY_HOURS} hrs/day per press. Multi-day jobs split their estimated hours evenly across the span. Drag the right edge of a chip to extend the span; drag the body to move it. Click a chip to open the order.
            </div>
          </div>
        );
      })()}


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

        // OVERDUE — past-due, still-open orders. Anchored to ACTUAL today
        // (not the clicked day) so they persist in the agenda every day
        // until finished, which is the whole point: "if there are past due
        // jobs it should show up until it's done." Listed first (most
        // urgent) and excluded from the other sections so nothing double-lists.
        const overdue = selectOverdueOrders(orders, today, seen);
        const overdueSeen = new Set([...seen, ...overdue.map((o) => o.id)]);

        // DUE SOON — orders due after the selected day, within the
        // 14-day window, not completed, and not already shown above.
        const dueSoon = orders
          .filter((o) => {
            if (overdueSeen.has(o.id)) return false;
            if (o.status === "Completed") return false;
            if (!o.due_date) return false;
            const due = String(o.due_date).slice(0, 10);
            return due > selectedDate && due <= dueSoonEnd;
          })
          .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));

        const inWorks = [...overdue, ...scheduled, ...dueSoon];

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
                  <div className="text-xs font-semibold uppercase tracking-widest text-slate-500">Agenda</div>
                  <h3 className="text-lg font-bold text-slate-900 mt-0.5">{fmtDateLong(selectedDate)}</h3>
                  <div className="text-xs mt-0.5">
                    {overdue.length === 0 && scheduled.length === 0 && dueSoon.length === 0
                      ? <span className="text-slate-500">Nothing overdue, scheduled, or due in the next 14 days.</span>
                      : (
                        <span className="text-slate-500">
                          {overdue.length > 0 && <span className="text-red-600 font-semibold">{overdue.length} overdue</span>}
                          {overdue.length > 0 && (scheduled.length > 0 || dueSoon.length > 0) && " · "}
                          {scheduled.length > 0 && `${scheduled.length} scheduled`}
                          {scheduled.length > 0 && dueSoon.length > 0 && " · "}
                          {dueSoon.length > 0 && `${dueSoon.length} due in the next 14 days`}
                        </span>
                      )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedDate(null)}
                  className="text-slate-500 hover:text-slate-700 text-lg leading-none px-2"
                  aria-label="Close agenda"
                >
                  ×
                </button>
              </div>

              <div className="p-5 space-y-5">
                {inWorks.length === 0 && (
                  <div className="text-sm text-slate-500 italic text-center py-10">
                    Nothing overdue, scheduled, or due in the next 14 days.
                  </div>
                )}

                {[
                  { key: "overdue",   title: "Overdue",         rows: overdue   },
                  { key: "scheduled", title: "Scheduled today", rows: scheduled },
                  { key: "dueSoon",   title: "Due soon",        rows: dueSoon   },
                ].map(({ key, title, rows }) => rows.length === 0 ? null : (
                  <div key={key}>
                    <div className={`text-[10px] font-bold uppercase tracking-[0.18em] mb-2 ${key === "overdue" ? "text-red-600" : "text-slate-500"}`}>
                      {title} <span className={`ml-1 ${key === "overdue" ? "text-red-300" : "text-slate-300"}`}>{rows.length}</span>
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
                        // Overdue rows count from REAL today ("Overdue N days");
                        // due-soon rows count from the clicked day ("Due in N days").
                        const dueRel = end
                          ? (key === "overdue" ? relativeDueLabel(end, today)
                            : key === "dueSoon" ? relativeDueLabel(end, selectedDate)
                            : "")
                          : "";
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
                              <div className="text-xs text-slate-500 mt-0.5 truncate">
                                {o.order_id}
                                {dueRel && <span className={`ml-2 ${key === "overdue" ? "text-red-600 font-semibold" : ""}`}>· {dueRel}</span>}
                                {!dueRel && end && <span className="ml-2">· Due {end}</span>}
                              </div>
                              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                                <Badge s={o.status} />
                                <OrderNotesIcon order={o} />
                                {key === "overdue" && (
                                  <span className="text-[10px] font-semibold uppercase tracking-widest bg-red-50 text-red-700 border border-red-200 px-1.5 py-0.5 rounded">
                                    Past due
                                  </span>
                                )}
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
          onUpdated={(u) => setOrders((prev) => prev.map((o) => (o.id === u.id ? { ...o, ...u } : o)))}
        />
      )}

      {viewingInvoice && (
        <InvoiceDetailModal
          invoice={viewingInvoice}
          customer={null}
          onClose={() => setViewingInvoice(null)}
          // No onMarkPaid/onDelete on purpose — money actions with QB-sync
          // semantics live on the Invoices page; stub handlers here rendered
          // buttons that silently did nothing. The modal hides both when the
          // handlers are absent.
          // After a successful Send: close the order modal too. The
          // operator just shipped the deliverable; they want to return
          // to the production queue, not get stranded on the order
          // card again.
          onSendSuccess={() => setViewing(null)}
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