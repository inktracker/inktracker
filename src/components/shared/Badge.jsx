// Production-step badge palette mirrors STATUS_COLORS in
// src/pages/Calendar.jsx / src/pages/Production.jsx /
// src/components/calendar/OrderScheduleRow.jsx — each step a
// distinct hue so badges anywhere in the app are instantly readable.
const BADGE_STYLES = {
  Draft:"bg-slate-100 text-slate-500 border-slate-200",
  Pending:"bg-amber-50 text-amber-700 border-amber-200",
  Approved:"bg-emerald-50 text-emerald-700 border-emerald-200",
  "Approved and Paid":"bg-emerald-50 text-emerald-700 border-emerald-200",
  Declined:"bg-red-50 text-red-500 border-red-200",
  // Production pipeline — match Calendar/Production maps
  "Artwork":"bg-violet-50 text-violet-700 border-violet-200",
  "Art Approval":"bg-violet-50 text-violet-700 border-violet-200",
  "Order Goods":"bg-orange-50 text-orange-700 border-orange-200",
  "Pre-Press":"bg-amber-50 text-amber-700 border-amber-200",
  Printing:"bg-indigo-50 text-indigo-700 border-indigo-200",
  Completed:"bg-emerald-50 text-emerald-700 border-emerald-200",
  // Quote lifecycle
  "Quote Sent":"bg-sky-50 text-sky-700 border-sky-200",
  "Quote Approved":"bg-teal-50 text-teal-700 border-teal-200",
  Sent:"bg-slate-100 text-slate-600 border-slate-200",
};

export default function Badge({ s }) {
  return (
    <span className={`font-display text-[11px] tracking-[0.1em] px-2.5 py-1 rounded-full border whitespace-nowrap uppercase ${BADGE_STYLES[s] || "bg-gray-100 text-gray-500 border-gray-200"}`}>
      {s}
    </span>
  );
}