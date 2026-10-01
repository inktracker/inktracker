import { CheckCircle2, Clock, AlertTriangle, MessageSquareWarning, FileQuestion } from "lucide-react";
import { artBadge } from "@/lib/art/artApproval";

// One badge for the order's art approval state — the same words and colours
// on the Shop Floor, the order lists, the production board and the order.
const TONES = {
  good: { cls: "bg-emerald-50 text-emerald-700 border-emerald-200", Icon: CheckCircle2 },
  wait: { cls: "bg-amber-50 text-amber-800 border-amber-200", Icon: Clock },
  warn: { cls: "bg-red-50 text-red-700 border-red-200", Icon: AlertTriangle },
  muted: { cls: "bg-slate-50 text-slate-600 border-slate-200", Icon: FileQuestion },
};

export default function ArtStatusBadge({ order, size = "sm", className = "" }) {
  if (!order) return null;
  const { label, tone } = artBadge(order);
  const t = TONES[tone] || TONES.muted;
  const Icon = label === "Changes requested" ? MessageSquareWarning : t.Icon;
  const sz = size === "xs" ? "text-[10px] px-1.5 py-0.5 gap-1" : "text-xs px-2 py-0.5 gap-1.5";
  return (
    <span className={`inline-flex items-center font-semibold border rounded whitespace-nowrap ${sz} ${t.cls} ${className}`} title={label}>
      <Icon className={size === "xs" ? "w-3 h-3" : "w-3.5 h-3.5"} aria-hidden="true" />
      {label}
    </span>
  );
}
