import { useState } from "react";
import { ChevronDown, ChevronRight, Pencil, Check, X, CalendarDays } from "lucide-react";
import Badge from "../shared/Badge";
import { O_STATUSES } from "../shared/pricing";

const STATUS_COLORS = {
  "Order Goods":      "bg-orange-50 border-orange-300 text-orange-800",
  "Artwork":          "bg-slate-100 border-slate-300 text-slate-700",
  "Pre-Press":        "bg-yellow-50 border-yellow-300 text-yellow-800",
  "Printing":         "bg-blue-50 border-blue-300 text-blue-800",
  "Completed":        "bg-teal-50 border-teal-300 text-teal-700",
};

const DOT_COLORS = {
  "Order Goods":      "bg-orange-400",
  "Artwork":          "bg-slate-400",
  "Pre-Press":        "bg-yellow-400",
  "Printing":         "bg-blue-500",
  "Completed":        "bg-teal-500",
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
      className={`flex items-center gap-3 py-2.5 border-b border-slate-50 last:border-0 rounded-lg transition ${dragOver ? "bg-indigo-50 border-indigo-200" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <div className="w-4 shrink-0" />

      <div className={`w-2 h-2 rounded-full shrink-0 ${DOT_COLORS[step] || "bg-slate-300"}`} />

      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-700">{step}</div>
        {hasDate && !editing && (
          <div className="text-xs text-slate-400 mt-0.5">
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
              className="text-sm border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              autoFocus
            />
            <button onClick={handleSave} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded-lg transition">
              <Check className="w-4 h-4" />
            </button>
            <button onClick={handleCancel} className="p-1 text-slate-400 hover:bg-slate-100 rounded-lg transition">
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => { setVal(value || ""); setEditing(true); }}
            className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition ${
              hasDate
                ? STATUS_COLORS[step] || "bg-slate-100 border-slate-200 text-slate-600"
                : "border-dashed border-slate-300 text-slate-400 hover:border-indigo-400 hover:text-indigo-600 hover:bg-indigo-50"
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
          <div className="text-xs text-slate-400 mt-0.5">
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
              className="text-sm border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              autoFocus
            />
            <button onClick={handleSave} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded-lg transition">
              <Check className="w-4 h-4" />
            </button>
            <button onClick={() => { setVal(value || ""); setEditing(false); }} className="p-1 text-slate-400 hover:bg-slate-100 rounded-lg transition">
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => { setVal(value || ""); setEditing(true); }}
            className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition ${
              value
                ? "bg-rose-50 border-rose-300 text-rose-700"
                : "border-dashed border-slate-300 text-slate-400 hover:border-rose-400 hover:text-rose-600 hover:bg-rose-50"
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
  const scheduledCount = Object.keys(stepDates).length;

  const isPast = order.due_date && order.due_date < today;
  const isToday = order.due_date === today;

  return (
    <div className="border-b border-slate-100 last:border-0">
      {/* Row header */}
      <div
        className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 transition cursor-pointer"
        onClick={() => setExpanded((e) => !e)}
      >
        <span className="text-slate-400 shrink-0">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>

        {order.due_date ? (
          <div className={`text-center min-w-[44px] rounded-xl py-1 px-1.5 shrink-0 ${isToday ? "bg-indigo-600 text-white" : isPast ? "bg-red-50 border border-red-200 text-red-600" : "bg-slate-50 border border-slate-200 text-slate-700"}`}>
            <div className="text-[9px] font-bold uppercase">{new Date(order.due_date + "T12:00:00").toLocaleString("en-US", { month: "short" })}</div>
            <div className="text-base font-bold leading-none">{new Date(order.due_date + "T12:00:00").getDate()}</div>
          </div>
        ) : (
          <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
            <CalendarDays className="w-4 h-4 text-slate-400" />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="font-semibold text-slate-800 text-sm">{companyName}</div>
            <div className="text-xs text-slate-400 font-mono">{order.order_id}</div>
            {isPast && !isToday && (
              <span className="text-[10px] font-bold text-red-500 bg-red-50 px-1.5 py-0.5 rounded-full border border-red-200">Overdue</span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <Badge s={order.status} />
            <span className={`text-[10px] font-semibold ${scheduledCount === 0 ? "text-amber-500" : "text-slate-400"}`}>
              {scheduledCount === 0 ? "No steps scheduled" : `${scheduledCount}/${O_STATUSES.length} steps scheduled`}
            </span>
          </div>
        </div>

        <button
          onClick={(e) => { e.stopPropagation(); onView(order); }}
          className="text-xs text-indigo-600 font-semibold hover:underline shrink-0"
        >
          View →
        </button>
      </div>

      {/* Expanded schedule panel */}
      {expanded && (
        <div className="mx-5 mb-4 bg-slate-50 border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 pt-3 pb-1">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest pb-1">
              Click to edit · Drag to reschedule
            </div>
            <DueDateRow
              value={order.due_date}
              onSave={(d) => onUpdateDueDate(order.id, d)}
            />
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest pt-3 pb-1">Production Steps</div>
            <StepDateRow
              step="Artwork"
              value={stepDates["Artwork"]}
              onSave={(d) => onUpdateStepDate(order.id, "Artwork", d)}
              onDragStart={setDraggingStep}
            />
            <StepDateRow
              step="Order Goods"
              value={stepDates["Order Goods"]}
              onSave={(d) => onUpdateStepDate(order.id, "Order Goods", d)}
              onDragStart={setDraggingStep}
            />
            {O_STATUSES.filter(s => s !== "Artwork").map((step) => (
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