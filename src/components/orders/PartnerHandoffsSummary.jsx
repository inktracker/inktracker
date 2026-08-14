import { useState, useEffect } from "react";
import { useAuth } from "@/lib/AuthContext";
import { shopScope } from "@/lib/shopScope";
import { listHandoffs } from "@/lib/partners";
import { fmtMoney } from "../shared/pricing";
import { Handshake } from "lucide-react";

// Sender-side list of an order's partner hand-offs (docs/shop-partnerships-
// design.md). With line-level split an order can be out to several partners
// at once, so a single chip isn't enough — this shows each one: who, how many
// lines, status, trade price. Renders nothing when the order has no hand-offs.
const HANDOFF_STATUS = {
  offered: { label: "Offered", cls: "bg-slate-100 text-slate-600" },
  accepted: { label: "Accepted", cls: "bg-teal-50 text-teal-700" },
  in_production: { label: "In production", cls: "bg-teal-50 text-teal-700" },
  completed: { label: "Completed", cls: "bg-emerald-50 text-emerald-700" },
  declined: { label: "Declined", cls: "bg-slate-100 text-slate-500" },
  cancelled: { label: "Cancelled", cls: "bg-amber-50 text-amber-700" },
};

export default function PartnerHandoffsSummary({ order }) {
  const { user } = useAuth();
  const myShop = shopScope(user);
  const [rows, setRows] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const all = await listHandoffs();
        setRows(all.filter(
          (h) => String(h.sending_shop).toLowerCase() === String(myShop).toLowerCase()
            && h.source_order_id === order.order_id,
        ));
      } catch { /* best-effort display */ }
    })();
  }, [myShop, order.order_id]);

  if (!rows.length) return null;

  return (
    <div className="mt-2 space-y-1.5">
      {rows.map((h) => {
        const s = HANDOFF_STATUS[h.status] || { label: h.status, cls: "bg-slate-100 text-slate-600" };
        const lineCount = (h.source_line_ids || []).length;
        const price = Number(h.agreed_trade_total ?? h.offered_trade_total) || 0;
        return (
          <div key={h.id} className="flex items-center gap-2 text-xs bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-1.5">
            <Handshake className="w-3.5 h-3.5 text-teal-600 shrink-0" />
            <span className="font-semibold text-slate-700 dark:text-slate-200 truncate">{h.receiving_shop}</span>
            <span className="text-slate-400">{lineCount} line{lineCount === 1 ? "" : "s"}</span>
            <span className="text-slate-500 ml-auto">{fmtMoney(price)}</span>
            <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>
          </div>
        );
      })}
    </div>
  );
}
