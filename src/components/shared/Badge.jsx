const BADGE_STYLES = {
  Draft:"bg-slate-100 text-slate-500 border-slate-200",
  Pending:"bg-amber-50 text-amber-700 border-amber-200",
  Approved:"bg-emerald-50 text-emerald-700 border-emerald-200",
  "Approved and Paid":"bg-emerald-50 text-emerald-700 border-emerald-200",
  Declined:"bg-red-50 text-red-500 border-red-200",
  "Artwork":"bg-sky-50 text-sky-700 border-sky-200",
  "Order Goods":"bg-amber-50 text-amber-700 border-amber-200",
  "Pre-Press":"bg-green-50 text-green-700 border-green-200",
  Printing:"bg-blue-50 text-blue-700 border-blue-200",
  Completed:"bg-emerald-50 text-emerald-700 border-emerald-200",
  Sent:"bg-slate-100 text-slate-600 border-slate-200",
};

export default function Badge({ s }) {
  return (
    <span className={`font-display text-[11px] tracking-[0.1em] px-2.5 py-1 rounded-full border whitespace-nowrap uppercase ${BADGE_STYLES[s] || "bg-gray-100 text-gray-500 border-gray-200"}`}>
      {s}
    </span>
  );
}