import { useState, useEffect } from "react";
import { useAuth } from "@/lib/AuthContext";
import { shopScope } from "@/lib/shopScope";
import { notify } from "@/lib/notify";
import { fmtMoney } from "../shared/pricing";
import { listHandoffs, respondToHandoff } from "@/lib/partners";
import { Handshake, Loader2, Check, X } from "lucide-react";

// Dashboard card: incoming partner job offers
// (docs/shop-partnerships-design.md). Renders nothing when there are no
// open offers — zero dashboard noise for shops without partners.
export default function PartnerInboxCard() {
  const { user } = useAuth();
  const myShop = shopScope(user);
  const [offers, setOffers] = useState([]);
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    try {
      const rows = await listHandoffs();
      setOffers(rows.filter(
        (h) => String(h.receiving_shop).toLowerCase() === String(myShop).toLowerCase()
          && h.status === "offered",
      ));
    } catch { /* card is best-effort */ }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (handoff, response) => {
    setBusyId(handoff.id);
    try {
      const res = await respondToHandoff(handoff.id, response);
      if (response === "accept") {
        notify.success("Job accepted", `It's on your production board as ${res?.receivingOrderId || "a new order"}.`);
      }
      await load();
    } catch (err) {
      notify.error("Couldn't respond", err);
    } finally {
      setBusyId(null);
    }
  };

  if (!offers.length) return null;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-teal-200 shadow-sm p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Handshake className="w-5 h-5 text-teal-600" />
        <h3 className="font-bold text-slate-900 dark:text-slate-100">Partner job offers</h3>
        <span className="text-xs font-bold bg-teal-100 text-teal-700 rounded-full px-2 py-0.5">{offers.length}</span>
      </div>
      {offers.map((h) => {
        const pieces = (h.spec?.lines || []).reduce(
          (s, l) => s + Object.values(l.sizes || {}).reduce((a, v) => a + (parseInt(v) || 0), 0), 0);
        return (
          <div key={h.id} className="border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-sm">
                <span className="font-semibold text-slate-800 dark:text-slate-100">{h.sending_shop}</span>
                <span className="text-slate-500"> · {(h.spec?.lines || []).length} line(s), {pieces} pcs</span>
              </div>
              <div className="text-sm font-bold text-teal-700">{fmtMoney(Number(h.offered_trade_total) || 0)}</div>
            </div>
            <div className="text-xs text-slate-500">
              Due {h.due_date || "TBD"}{h.spec?.note ? ` — “${h.spec.note}”` : ""}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => act(h, "accept")} disabled={busyId === h.id}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-teal-600 hover:bg-teal-700 text-white rounded-lg transition disabled:opacity-50">
                {busyId === h.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                Accept
              </button>
              <button onClick={() => act(h, "decline")} disabled={busyId === h.id}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-500 rounded-lg hover:bg-slate-50 transition">
                <X className="w-3.5 h-3.5" /> Decline
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
