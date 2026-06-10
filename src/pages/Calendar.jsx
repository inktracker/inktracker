import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/supabaseClient";
import { CalendarGridSkeleton } from "@/components/shared/Skeletons";
import { O_STATUSES } from "../components/shared/pricing";
import { buildOrderCompletionPlan } from "@/lib/orders/completeOrder";
import OrderDetailModal from "../components/orders/OrderDetailModal";
import InvoiceDetailModal from "../components/invoices/InvoiceDetailModal";
import { ChevronLeft, ChevronRight, CalendarDays, List, Eye, EyeOff } from "lucide-react";
import OrderScheduleRow from "../components/calendar/OrderScheduleRow";
import EmptyState from "../components/shared/EmptyState";
import Badge from "../components/shared/Badge";
import { addDaysISO, relativeDueLabel, getOrderActionHint } from "@/lib/calendar/agendaHints";
import { resolveQuoteLink, QUOTE_LINK_KIND } from "@/lib/quotes/resolveQuoteLink";
import { todayInShopTz } from "@/lib/shopTimezone";
import { notify } from "@/lib/notify";
import { notifyBrokerOfShopAction } from "@/lib/broker/notifyBrokerOfShopAction";
import { handleBrokerOrderDeletion } from "@/lib/orders/handleBrokerOrderDeletion";
import { resolveJobLabel } from "@/lib/calendar/resolveJobLabel";

// Calendar status colors. Mirrors O_STATUSES — 5 stages — plus the
// pre-order quote lifecycle chips (Quote Sent, Quote Approved). Keep this
// list in sync with the identical map in src/pages/Production.jsx (the
// calendar view inside the Production page renders the same chips).
//
// Each step gets a visually distinct hue so the calendar reads as a
// progress map at a glance. Previously Quote Sent + Quote Approved
// shared green, so the operator couldn't tell at a glance whether a
// quote was awaiting approval or already approved.
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

// Shared resolver lives in @/lib/calendar/resolveJobLabel and now
// handles the broker-vs-direct distinction: broker quotes/orders
// surface the broker on shop-facing chips, NOT the end client.
const getCompanyName = (rec, customers) => resolveJobLabel(rec, customers);

export default function Calendar() {
  const navigate = useNavigate();
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
  // All quotes for the shop. Drives Quote Sent / Quote Approved chips —
  // independent of whether the quote has been converted to an order.
  const [quotes, setQuotes] = useState([]);
  // Set of step labels currently hidden from the grid. Clicking a legend
  // chip toggles whether that chip type is rendered on day cells. Empty
  // set = show everything (default).
  const [hiddenSteps, setHiddenSteps] = useState(() => new Set());
  // Completed jobs stay on the calendar in green by default — the
  // emerald chips serve as a "what shipped when" historical record.
  // Toggle to hide them when the current month gets too crowded.
  const [hideCompleted, setHideCompleted] = useState(false);
  // Day clicked in the grid → opens the agenda panel showing all jobs
  // in-the-works on that date (created ≤ date ≤ due/completed).
  const [selectedDate, setSelectedDate] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const u = await base44.auth.me();
        setUser(u);
        const [o, c, q] = await Promise.all([
          base44.entities.Order.filter({ shop_owner: u.email }, "-created_date", 200),
          base44.entities.Customer.filter({ shop_owner: u.email }),
          // All quotes — surfaces "Quote Sent" / "Quote Approved" chips even
          // before a quote is converted to an order.
          base44.entities.Quote.filter({ shop_owner: u.email }, "-created_date", 500).catch(() => []),
        ]);
        setOrders(o || []);
        const map = {};
        (c || []).forEach((cust) => (map[cust.id] = cust));
        setCustomers(map);
        setQuotes(q || []);
      } catch (err) {
        notify.error("Couldn't load calendar", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Point events: single-date chips keyed by date. Respects the
  // hideCompleted toggle and the per-step hiddenSteps filter so the
  // grid stays readable as a shop accumulates history.
  const pointEvents = useMemo(() => {
    const map = {};
    const push = (date, ev) => {
      if (hiddenSteps.has(ev.step)) return;
      if (!map[date]) map[date] = [];
      map[date].push(ev);
    };
    orders.forEach((o) => {
      if (hideCompleted && o.status === "Completed") return;
      const stepDates = o.step_dates || {};
      O_STATUSES.forEach((step) => {
        const val = stepDates[step];
        if (val && typeof val === "string") {
          push(val, { order: o, step, isDue: false });
        }
      });
      // Legacy fallback: older orders stored the Order Goods date in
      // o.date instead of step_dates["Order Goods"]. Only add this chip
      // when the canonical step_dates slot is empty — otherwise the
      // canonical step loop above already pushed the right chip, and
      // a duplicate would render on a different day if the two fields
      // drifted out of sync.
      if (o.date && !stepDates["Order Goods"]) {
        push(o.date, { order: o, step: "Order Goods", isDue: false });
      }
      // Completed orders get a green chip on their completion date so the
      // calendar serves as a "what shipped when" historical record. Always
      // pushed under the "Completed" step label so it picks up the emerald
      // styling and the hiddenSteps "Completed" filter toggle.
      if (o.status === "Completed" && o.completed_date) {
        push(o.completed_date, { order: o, step: "Completed", isDue: false });
      }
      // Completed orders don't get a red "Due" chip — the job is done, the
      // due date is no longer a thing the shop owner needs flagged.
      if (o.due_date && o.status !== "Completed") {
        // The "Due" chip rides the hiddenSteps filter under the label "Due".
        if (!hiddenSteps.has("Due")) {
          if (!map[o.due_date]) map[o.due_date] = [];
          map[o.due_date].push({ order: o, step: "Due", isDue: true });
        }
      }
    });

    // Quote lifecycle chips — pushed directly from quote rows. A quote
    // that's been sent but not yet converted to an order still shows up.
    //
    // Two filters intentionally applied:
    //   1. status === "Converted to Order" → SKIP. The order's own
    //      chips already tell that quote's story on the calendar; the
    //      Quote Sent / Quote Approved chips become dead weight (and
    //      they're invisible-to-delete from /Quotes because that page
    //      hides converted rows, so users see "ghost" chips for quotes
    //      they think they cleaned up). The Alder Creek / "My Name"
    //      cleanup complaint on 2026-05-30.
    //   2. status === "Declined" → SKIP. A declined quote isn't a live
    //      pipeline event; chips would just clutter the calendar.
    quotes.forEach((q) => {
      const status = q.status || "";
      // "Looks converted" — same predicate resolveQuoteLink uses to
      // route chip clicks to /Orders. Without this branch, a quote
      // whose order was deleted (converted_order_id set, but status
      // never flipped to "Converted to Order") slips past the filter
      // and surfaces "ghost" Quote Sent / Approved chips that point
      // at deleted orders. The "My Name" residue on 2026-05-30.
      if (status === "Converted to Order" || status === "Declined" || q.converted_order_id) return;
      if (q.sent_date) {
        const d = String(q.sent_date).slice(0, 10);
        if (!hiddenSteps.has("Quote Sent")) {
          if (!map[d]) map[d] = [];
          map[d].push({ kind: "quote", quote: q, step: "Quote Sent", isDue: false });
        }
      }
      if (q.client_approved_at) {
        const d = String(q.client_approved_at).slice(0, 10);
        if (!hiddenSteps.has("Quote Approved")) {
          if (!map[d]) map[d] = [];
          map[d].push({ kind: "quote", quote: q, step: "Quote Approved", isDue: false });
        }
      }
    });

    return map;
  }, [orders, quotes, hiddenSteps, hideCompleted]);

  // Printing events as point events (single date)
  const printingEvents = useMemo(() => {
    const map = {};
    if (hiddenSteps.has("Printing")) return map;
    orders.forEach((o) => {
      if (hideCompleted && o.status === "Completed") return;
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
  }, [orders, hiddenSteps, hideCompleted]);

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

  function canEdit() {
    // Destructive + completion actions require the shop owner. CLAUDE.md:
    // managers have "full shop access, no billing/admin", and order
    // deletion / completion mints invoice + performance rows that are
    // part of the shop's accounting record. Keep them shop-owner-only,
    // matching the gate Production.jsx + Orders.jsx use upstream.
    return user?.role === "admin" || user?.role === "shop";
  }

  async function handleDelete(id) {
    if (!canEdit()) return;
    if (!window.confirm("Delete this order?")) return;
    const order = orders.find((o) => o.id === id);
    await base44.entities.Order.delete(id);
    setOrders((prev) => prev.filter((o) => o.id !== id));
    setViewing(null);

    // If the deleted order originated from a broker quote, roll the quote
    // back to "Client Approved" and notify the broker via ShopActionFeed.
    handleBrokerOrderDeletion(order);
  }

  async function handleComplete(order) {
    if (!canEdit()) return;
    // Completion = transition, never destruction.
    //
    // Before this fix: handleComplete called Order.delete() AFTER creating
    // the invoice + performance rows. That orphaned every invoice (the bug
    // Joe hit on 2026-05-12) and bypassed the duplicate-invoice dedupe.
    // Mirrors the Production.jsx pattern: pre-fetch an existing invoice
    // for this job (matched by order_id OR by the original quote_id, with
    // a fallback walk through Quote.converted_order_id) so SendQuoteModal
    // → completion doesn't mint a second invoice row.
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
      console.error("[Calendar.handleComplete] existing-invoice lookup failed:", err);
      // Continue — the 20260519_invoices_no_duplicates.sql unique index
      // is the last-line backstop against a duplicate insert.
    }

    const plan = buildOrderCompletionPlan(order, {
      today: td,
      shopOwner: user.email,
      existingInvoice,
    });

    if (plan.invoiceLink) {
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

    // Notify the broker (no-op for non-broker orders). Same shape as
    // Production/Orders pages.
    notifyBrokerOfShopAction({
      quote: { ...updated, quote_id: updated.order_id || updated.quote_id },
      action: "shop_completed_order",
      shopEmail: user?.email,
    });
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

  // Drag payload carries WHICH chip is being dragged so the drop handler
  // can update the correct underlying field. Previously every drop wrote
  // due_date no matter what chip you grabbed — the subtitle promised
  // "Drag to reschedule" but only due dates actually moved.
  //
  //   field === "due_date"   → update orders.due_date
  //   field === "date"       → update orders.date (legacy Order Goods slot)
  //   field === "step_dates" → update orders.step_dates[step]
  function handleDragStart(e, order, step, field) {
    e.dataTransfer.setData("orderId", order.id);
    e.dataTransfer.setData("step", step || "");
    e.dataTransfer.setData("field", field || "due_date");
  }
  async function handleDrop(e, dateStr) {
    e.preventDefault();
    const orderId = e.dataTransfer.getData("orderId");
    const step    = e.dataTransfer.getData("step");
    const field   = e.dataTransfer.getData("field") || "due_date";
    if (!orderId) { setDragOverDate(null); return; }
    try {
      if (field === "step_dates" && step) {
        await handleUpdateStepDate(orderId, step, dateStr);
      } else if (field === "date") {
        const updated = await base44.entities.Order.update(orderId, { date: dateStr });
        setOrders((prev) => prev.map((o) => (o.id === orderId ? updated : o)));
      } else {
        await handleUpdateDueDate(orderId, dateStr);
      }
    } catch (err) {
      notify.error("Couldn't reschedule", err);
    }
    setDragOverDate(null);
  }
  function handleDragOver(e, dateStr) {
    e.preventDefault();
    setDragOverDate(dateStr);
  }

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  // Each cell is { day, year, month, inMonth } so leading and trailing
  // slots can render the actual adjacent-month dates (dimmed) instead
  // of empty grey blocks. Operators still get the visual rhythm of a
  // continuous month-to-month flow — useful for orders due on the 1st
  // or 31st of the bordering month.
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
          <p className="text-slate-400 text-sm mt-0.5">Each chip is one step of one job. Click to open · drag to a different day to reschedule that step.</p>
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
          <button onClick={goToday} className="text-sm font-semibold text-teal-600 hover:underline">Today</button>
          <button onClick={nextMonth} className="p-2 rounded-xl hover:bg-slate-100 border border-slate-200 transition">
            <ChevronRight className="w-4 h-4 text-slate-600" />
          </button>
          <h3 className="text-lg font-bold text-slate-900 ml-2">{MONTH_NAMES[month]} {year}</h3>
        </div>
      )}

      {/* Filter legend — each chip is clickable to toggle that event
          type on/off in the grid. Hidden chips render desaturated so
          users can see what's filtered without consulting state.
          The "Hide completed" toggle drops every chip belonging to a
          Completed order — separate from the per-step filter so the
          shop owner can still hide just one step at a time. */}
      {!loading && view === "month" && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3 text-[10px] font-semibold">
          {[
            { label: "Quote Sent",     cls: STATUS_COLORS["Quote Sent"] },
            { label: "Quote Approved", cls: STATUS_COLORS["Quote Approved"] },
            { label: "Art Approval",   cls: STATUS_COLORS["Art Approval"] },
            { label: "Order Goods",    cls: STATUS_COLORS["Order Goods"] },
            { label: "Pre-Press",      cls: STATUS_COLORS["Pre-Press"] },
            { label: "Printing",       cls: STATUS_COLORS["Printing"] },
            { label: "Due",            cls: "bg-rose-50 border-rose-300 text-rose-700" },
            { label: "Completed",      cls: STATUS_COLORS["Completed"] },
          ].map((item) => {
            const hidden = hiddenSteps.has(item.label);
            return (
              <button
                key={item.label}
                type="button"
                onClick={() => {
                  setHiddenSteps((prev) => {
                    const next = new Set(prev);
                    if (next.has(item.label)) next.delete(item.label);
                    else next.add(item.label);
                    return next;
                  });
                }}
                aria-pressed={!hidden}
                title={hidden ? `Show ${item.label}` : `Hide ${item.label}`}
                className={`px-1.5 py-0.5 rounded border transition ${item.cls} ${hidden ? "opacity-30 line-through" : "hover:brightness-95"}`}
              >
                {item.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setHideCompleted((v) => !v)}
            className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded border border-slate-200 text-slate-500 hover:bg-slate-50 transition"
            title={hideCompleted ? "Show completed orders" : "Hide completed orders"}
          >
            {hideCompleted ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            {hideCompleted ? "Completed hidden" : "Completed shown"}
          </button>
        </div>
      )}

      {loading ? (
        <CalendarGridSkeleton />
      ) : view === "month" ? (
        <>
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
            {/* Day headers — today's weekday is highlighted so the user
                can spot the column at a glance even when the date number
                isn't visible (e.g. scrolled past on a long week). */}
            <div className="grid grid-cols-7 border-b border-slate-100">
              {DAY_LABELS.map((d, i) => {
                const isTodayCol = (() => {
                  const t = new Date(today + "T00:00:00");
                  // Only highlight if "today" is in the visible month
                  return t.getFullYear() === year && t.getMonth() === month && t.getDay() === i;
                })();
                return (
                  <div
                    key={d}
                    className={`py-2 text-center text-xs font-semibold uppercase tracking-widest ${isTodayCol ? "text-teal-600 bg-teal-50" : "text-slate-400"}`}
                  >
                    {d}
                  </div>
                );
              })}
            </div>

            {/* Week rows */}
            {weeks.map((week, wIdx) => (
              <div key={wIdx} className="relative">
                  {/* Day cells */}
                  <div className="grid grid-cols-7 divide-x divide-y divide-slate-100">
                    {week.map((cell, dIdx) => {
                       // cell is always populated now — adjacent-month cells
                       // carry their own year/month so the dateStr resolves
                       // correctly (e.g. a "31" cell trailing into next
                       // month uses next month's year/month for chip lookup).
                       const { day, year: cellY, month: cellM, inMonth } = cell;
                       const dateStr = toDateStr(cellY, cellM, day);
                       const isToday = dateStr === today;
                        const pointList = pointEvents[dateStr] || [];
                        const printList = printingEvents[dateStr] || [];
                        const allEvents = [...pointList, ...printList];
                        const isDragOver = dragOverDate === dateStr;

                        return (
                         <div
                           key={dateStr}
                           className={`min-h-[110px] p-1.5 flex flex-col transition cursor-pointer ${
                             isDragOver
                               ? "bg-teal-50 ring-2 ring-inset ring-teal-400"
                               : selectedDate === dateStr
                                 ? "bg-teal-50/60"
                                 // Adjacent-month cells: same hover affordance
                                 // as in-month cells (operators can click +
                                 // drop on them), but a subtle gray wash so
                                 // the current month still reads as primary.
                                 : inMonth ? "hover:bg-slate-50" : "bg-slate-50/40 hover:bg-slate-50"
                           }`}
                           onClick={() => setSelectedDate(dateStr)}
                           onDrop={(e) => handleDrop(e, dateStr)}
                           onDragOver={(e) => handleDragOver(e, dateStr)}
                           onDragLeave={() => setDragOverDate(null)}
                           title="Click to see the day's agenda"
                         >
                           <div className={`text-xs font-bold mb-2 w-6 h-6 flex items-center justify-center rounded-full ${
                             isToday
                               ? "bg-teal-600 text-white"
                               : inMonth ? "text-slate-400" : "text-slate-300"
                           }`}>
                             {day}
                           </div>
                           <div className="flex flex-col gap-1 flex-1 overflow-y-auto">
                             {allEvents.map((ev, idx) => {
                               // Quote-kind events click through to /Quotes
                               // (a quote may not have an order yet). Order
                               // events open the OrderDetailModal inline.
                               // Each chip carries its OWN step color —
                               // the Completed-status override that used
                               // to recolor every historical stage chip
                               // green was misleading (an "Order Goods"
                               // chip rendered as green on a completed
                               // order). Now Order Goods always reads as
                               // orange even on completed orders; only
                               // the actual Completed event chip is
                               // green.
                               const isQuoteEvent = ev.kind === "quote";
                               const subject = isQuoteEvent ? ev.quote : ev.order;
                               const subjectName = isQuoteEvent
                                 ? getCompanyName(ev.quote, customers)
                                 : companyName(ev.order);
                               const chipClass = ev.isDue
                                 ? "bg-rose-50 border-rose-300 text-rose-700"
                                 : STATUS_COLORS[ev.step] || "bg-slate-100 border-slate-200 text-slate-600";
                               // Field this chip represents — drives where
                               // a drop will write. Due chip → due_date.
                               // Order Goods chip → order.date (legacy slot).
                               // Anything else → step_dates[step].
                               const field = ev.isDue
                                 ? "due_date"
                                 : (ev.step === "Order Goods" && ev.order?.date === dateStr)
                                   ? "date"
                                   : "step_dates";
                               return (
                                 <div
                                   key={`${subject.id}-${ev.step}-${idx}`}
                                   draggable={!isQuoteEvent}
                                   onDragStart={isQuoteEvent ? undefined : (e) => handleDragStart(e, ev.order, ev.step, field)}
                                   onClick={(e) => {
                                     e.stopPropagation();
                                     if (isQuoteEvent) {
                                       const r = resolveQuoteLink(ev.quote, orders);
                                       if (r.kind === QUOTE_LINK_KIND.OPEN_ORDER) setViewing(r.order);
                                       else if (r.kind === QUOTE_LINK_KIND.NAVIGATE_ORDERS) navigate("/Orders");
                                       else navigate(`/Quotes?id=${r.quoteId}`);
                                     } else {
                                       setViewing(ev.order);
                                     }
                                   }}
                                   className={`w-full text-[10px] font-semibold px-1.5 py-0.5 rounded border ${isQuoteEvent ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"} whitespace-nowrap overflow-hidden text-ellipsis ${chipClass}`}
                                   title={isQuoteEvent ? `${subjectName} — ${ev.step}` : `${subjectName} — ${ev.step} · drag to reschedule`}
                                 >
                                   {subjectName}
                                   <span className="opacity-60 ml-1">· {ev.step}</span>
                                 </div>
                               );
                             })}
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
                <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">Active jobs · {allActiveOrders.length} · click a row to schedule its steps</div>
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
                <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">Active jobs · {allActiveOrders.length} · click a row to schedule its steps</div>
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

      {/* Agenda side panel — a planning view, not a literal mirror of the
          day cell. Two sections:
            (1) SCHEDULED — orders whose chip lands on this day
            (2) DUE SOON  — orders due within the next 14 days (so an
                operator clicking "today" sees what needs to happen this
                week, not just what's already scheduled)
          Each item carries a next-action hint ("Order blanks",
          "Get art approved", …) derived from order state so the agenda
          answers "what should I be doing on this day" rather than just
          "what's pinned to this day". An empty day still opens the panel
          so a click never feels broken. */}
      {selectedDate && (() => {
        const DUE_SOON_DAYS = 14;
        const dueSoonEnd = addDaysISO(selectedDate, DUE_SOON_DAYS);

        // SCHEDULED — orders with a chip on the selected day. Quotes
        // intentionally skipped: clicking a quote chip on the calendar
        // already jumps to /Quotes inline, and the agenda body is
        // order-shaped.
        const dayEvents = eventsByDate[selectedDate] || [];
        const seen = new Set();
        const scheduled = [];
        for (const ev of dayEvents) {
          if (ev.kind === "quote") continue;
          const subject = ev.order;
          if (!subject?.id || seen.has(subject.id)) continue;
          seen.add(subject.id);
          scheduled.push(subject);
        }

        // DUE SOON — orders due AFTER the selected day but within the
        // 14-day window, excluding completed and anything already in
        // SCHEDULED above.
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
        const sectionFor = (o) => (scheduled.includes(o) ? "scheduled" : "dueSoon");

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
                                {getCompanyName(o, customers)}
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
          // Same pattern as Production/Orders: successful Send returns
          // the operator to the calendar grid, not the order modal.
          onSendSuccess={() => setViewing(null)}
        />
      )}
    </div>
  );
}