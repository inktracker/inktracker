// Design-language chips — the approved 2026-08-31 system. Exactly three
// kinds exist app-wide: StatusChip (Anton caps, tinted, ONE per row),
// MetaTag (quiet outline pill for metadata — tier, QuickBooks, source),
// and the "signal line" (plain text callers render under a StatusChip:
// slate normally, amber when someone should act, red when late).
//
// Color roles: amber always means "waiting on someone", red is reserved
// for late/blocked, forest (the teal-* brand scale) is action/done, slate
// is quiet. Stage hues stay distinct for floor recognition but Pre-Press
// sits on cyan — never amber — and Completed lands on the brand scale.
//
// This map is canonical for migrated screens. Badge.jsx is the legacy
// renderer; retire it surface by surface, not in one sweep.

export const STATUS_CHIP_STYLES = {
  // Quote lifecycle
  Draft: "bg-slate-100 text-slate-600 border-slate-200",
  Sent: "bg-amber-50 text-amber-700 border-amber-200",
  Pending: "bg-amber-50 text-amber-700 border-amber-200",
  Approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Approved and Paid": "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Converted to Order": "bg-teal-50 text-teal-700 border-teal-200",
  Declined: "bg-red-50 text-red-600 border-red-200",
  // Production pipeline
  "Art Approval": "bg-violet-50 text-violet-700 border-violet-200",
  Artwork: "bg-violet-50 text-violet-700 border-violet-200",
  "Order Goods": "bg-orange-50 text-orange-700 border-orange-200",
  "Pre-Press": "bg-cyan-50 text-cyan-700 border-cyan-200",
  Printing: "bg-indigo-50 text-indigo-700 border-indigo-200",
  Completed: "bg-teal-50 text-teal-700 border-teal-200",
};

export function StatusChip({ s }) {
  return (
    <span className={`font-display text-[11px] tracking-[0.1em] px-2.5 py-1 rounded-md border whitespace-nowrap uppercase ${STATUS_CHIP_STYLES[s] || "bg-slate-100 text-slate-600 border-slate-200"}`}>
      {s}
    </span>
  );
}

export function MetaTag({ children, title }) {
  return (
    <span
      title={title}
      className="text-[10px] font-medium text-slate-500 border border-slate-200 rounded-full px-2 py-0.5 whitespace-nowrap"
    >
      {children}
    </span>
  );
}
