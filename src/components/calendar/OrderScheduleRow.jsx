import { useState } from "react";
import { ChevronDown, ChevronRight, Pencil, Check, X, CalendarDays } from "lucide-react";
import Badge from "../shared/Badge";
import { O_STATUSES } from "../shared/pricing";
import OrderNotesIcon from "../orders/OrderNotesIcon";

// Mirrors STATUS_COLORS in src/pages/Calendar.jsx + src/pages/Production.jsx.
// Each step gets a visually distinct hue so the schedule row reads as a
// progress map at a glance. Keep all three lists in sync.
const STATUS_COLORS = {
  "Order Goods":      "bg-orange-50 border-orange-300 text-orange-800",
  "Artwork":          "bg-violet-50 border-violet-300 text-violet-700",
  "Pre-Press":        "bg-amber-50 border-amber-300 text-amber-800",
  "Printing":         "bg-indigo-50 border-indigo-300 text-indigo-700",
  "Completed":        "bg-emerald-100 border-emerald-400 text-emerald-800 font-semibold",
};

const DOT_COLORS = {
  "Order Goods":      "bg-orange-400",
  "Artwork":          "bg-violet-400",
  "Pre-Press":        "bg-amber-400",
  "Printing":         "bg-indigo-500",
  "Completed":        "bg-emerald-500",
};

// ── Generic single-date step row ────────────────────────────────────────────
function StepDateRow({ step, value, onSave, onDragStart }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value || "");
  const [dragOver, setDragOver] = useState(false);
  const hasDate = Boolean(value);

  function handleSave() { onSave(val); setEditing(false); }
  function handleCancel() { setVal(value || ""); setEditing(false); }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const date = e.dataTransfer.getData("text/date");
    if (date) onSave(date);
  }

  return (
    <div
      className={`flex items-center gap-3 py-2.5 border-b border-slate-50 last:border-0 rounded-lg transition ${dragOver ? "bg-teal-50 border-teal-200" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <div className="w-4 shrink-0" />

      <div className={`w-2 h-2 rounded-full shrink-0 ${DOT_COLORS[step] || "bg-slate-300"}`} />

      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-700">{step}</div>
        {hasDate && !editing && (
          <div className="text-xs text-slate-500 mt-0.5">
            {new Date(value + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
          </div>
        )}
      </div>

      <div className="shrink-0">
        {editing ? (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={val}
              onChange={(e) => setVal(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-teal-300"
              autoFocus
            />
            <button onClick={handleSave} aria-label="Save" className="p-1 text-emerald-600 hover:bg-emerald-50 rounded-lg transition">
              <Check className="w-4 h-4" />
            </button>
            <button onClick={handleCancel} aria-label="Cancel" className="p-1 text-slate-500 hover:bg-slate-100 rounded-lg transition">
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => { setVal(value || ""); setEditing(true); }}
            className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition ${
              hasDate
                ? STATUS_COLORS[step] || "bg-slate-100 border-slate-200 text-slate-600"
                : "border-dashed border-slate-300 text-slate-500 hover:border-teal-400 hover:text-teal-600 hover:bg-teal-50"
            }`}
          >
            {hasDate ? <><Pencil className="w-3 h-3" /> Edit</> : <><CalendarDays className="w-3 h-3" /> Set date</>}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Due date row ────────────────────────────────────────────────────────────
function DueDateRow({ value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value || "");
  const [dragOver, setDragOver] = useState(false);

  function handleSave() { onSave(val); setEditing(false); }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const date = e.dataTransfer.getData("text/date");
    if (date) onSave(date);
  }

  return (
    <div
      className={`flex items-center gap-3 py-2.5 border-b border-slate-50 rounded-lg transition ${dragOver ? "bg-rose-50 border-rose-200" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <div className="w-4 shrink-0" />
      <div className="w-2 h-2 rounded-full bg-rose-400 shrink-0" />

      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-rose-700">In-Hands Due Date</div>
        {value && !editing && (
          <div className="text-xs text-slate-500 mt-0.5">
            {new Date(value + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
          </div>
        )}
      </div>

      <div className="shrink-0">
        {editing ? (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={val}
              onChange={(e) => setVal(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-teal-300"
              autoFocus
            />
            <button onClick={handleSave} aria-label="Save" className="p-1 text-emerald-600 hover:bg-emerald-50 rounded-lg transition">
              <Check className="w-4 h-4" />
            </button>
            <button onClick={() => { setVal(value || ""); setEditing(false); }} aria-label="Cancel" className="p-1 text-slate-500 hover:bg-slate-100 rounded-lg transition">
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => { setVal(value || ""); setEditing(true); }}
            className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition ${
              value
                ? "bg-rose-50 border-rose-300 text-rose-700"
                : "border-dashed border-slate-300 text-slate-500 hover:border-rose-400 hover:text-rose-600 hover:bg-rose-50"
            }`}
          >
            {value
              ? <><Pencil className="w-3 h-3" /> {new Date(value + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</>
              : <><CalendarDays className="w-3 h-3" /> Set due date</>
            }
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main row ────────────────────────────────────────────────────────────────
export default function OrderScheduleRow({ order, companyName, onUpdateStepDate, onUpdateDueDate, onView, today }) {
  const [expanded, setExpanded] = useState(false);
  const [draggingStep, setDraggingStep] = useState(null);
  const stepDates = order.step_dates || {};

  // Count scheduled steps (Printing counts if it has a start date)
  // Count only REAL pipeline steps with a date — not every key in step_dates
  // (a legacy phantom "Artwork" key would otherwise inflate the "N/5" count).
  const scheduledCount = O_STATUSES.filter((s) => stepDates[s]).length;

  const isPast = order.due_date && order.due_date < today;
  const isToday = order.due_date === today;

  return (
    <div className="border-b border-slate-100 last:border-0">
      {/* Row header */}
      <div
        className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 transition cursor-pointer"
        onClick={() => setExpanded((e) => !e)}
      >
        <span className="text-slate-500 shrink-0">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>

        {order.due_date ? (
          <div className={`text-center min-w-[44px] rounded-xl py-1 px-1.5 shrink-0 ${isToday ? "bg-teal-600 text-white" : isPast ? "bg-red-50 border border-red-200 text-red-600" : "bg-slate-50 border border-slate-200 text-slate-700"}`}>
            <div className="text-[9px] font-bold uppercase">{new Date(order.due_date + "T12:00:00").toLocaleString("en-US", { month: "short" })}</div>
            <div className="text-base font-bold leading-none">{new Date(order.due_date + "T12:00:00").getDate()}</div>
          </div>
        ) : (
          <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
            <CalendarDays className="w-4 h-4 text-slate-500" />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="font-semibold text-slate-800 text-sm">{companyName}</div>
            <OrderNotesIcon order={order} />
            <div className="text-xs text-slate-500 font-mono">{order.order_id}</div>
            {isPast && !isToday && (
              <span className="text-[10px] font-bold text-red-500 bg-red-50 px-1.5 py-0.5 rounded-full border border-red-200">Overdue</span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <Badge s={order.status} />
            <span className={`text-[10px] font-semibold ${scheduledCount === 0 ? "text-amber-500" : "text-slate-500"}`}>
              {scheduledCount === 0 ? "No steps scheduled" : `${scheduledCount}/${O_STATUSES.length} steps scheduled`}
            </span>
          </div>
        </div>

        <button
          onClick={(e) => { e.stopPropagation(); onView(order); }}
          className="text-xs text-teal-600 font-semibold hover:underline shrink-0"
        >
          View →
        </button>
      </div>

      {/* Expanded schedule panel */}
      {expanded && (
        <div className="mx-5 mb-4 bg-slate-50 border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 pt-3 pb-1">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pb-1">
              Click to edit · Drag to reschedule
            </div>
            <DueDateRow
              value={order.due_date}
              onSave={(d) => onUpdateDueDate(order.id, d)}
            />
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pt-3 pb-1">Production Steps</div>
            {/* One row per REAL pipeline step (O_STATUSES). Previously a
                hardcoded "Artwork" row (a step that doesn't exist — the real
                first stage is "Art Approval") saved dates under a key the
                calendar never reads, and a hardcoded "Order Goods" row plus a
                no-op filter (s !== "Artwork" never matches) rendered "Order
                Goods" twice. */}
            {O_STATUSES.map((step) => (
              <StepDateRow
                key={step}
                step={step}
                value={stepDates[step]}
                onSave={(d) => onUpdateStepDate(order.id, step, d)}
                onDragStart={setDraggingStep}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}