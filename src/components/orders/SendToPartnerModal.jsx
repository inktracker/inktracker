import { useState, useEffect, useMemo } from "react";
import ModalBackdrop from "../shared/ModalBackdrop";
import { useAuth } from "@/lib/AuthContext";
import { shopScope } from "@/lib/shopScope";
import { notify } from "@/lib/notify";
import { fmtMoney } from "../shared/pricing";
import { listPartnerships, activePartners, offerHandoff, listHandoffs } from "@/lib/partners";
import { getPartnerTradeSheet, computeTradeTotal } from "@/lib/partnerTradeSheet";
import { Handshake, Loader2, X } from "lucide-react";

const LIVE_HANDOFF = new Set(["offered", "accepted", "in_production"]);

// Send an order (or selected lines) to a partner shop
// (docs/shop-partnerships-design.md). Blind by default: the partner sees
// specs/art/quantities and the trade price — never the customer or retail
// pricing. A trade price is REQUIRED: acceptance snapshots it, and the
// partner's invoice generates from that one number (no drift).
export default function SendToPartnerModal({ order, onClose, onSent }) {
  const { user } = useAuth();
  const myShop = shopScope(user);
  const [partners, setPartners] = useState(null);
  const [partnerShop, setPartnerShop] = useState("");
  const [selectedLines, setSelectedLines] = useState(() =>
    new Set((order.line_items || []).map((li, idx) => String(li?.id ?? idx))));
  // line id → partner email it's already committed to (a live hand-off).
  const [committedLines, setCommittedLines] = useState({});
  const [blind, setBlind] = useState(true);
  const [tradeTotal, setTradeTotal] = useState("");
  const [userEditedPrice, setUserEditedPrice] = useState(false);
  const [partnerSheet, setPartnerSheet] = useState(null);
  const [note, setNote] = useState("");
  const [dueDate, setDueDate] = useState(order.due_date || "");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const links = await listPartnerships();
        const active = activePartners(links, myShop);
        setPartners(active);
        if (active.length === 1) setPartnerShop(active[0]);
      } catch {
        setPartners([]);
      }
      try {
        // Lines already out to a partner (split support): lock them so this
        // order's remaining lines can go to a DIFFERENT partner without ever
        // double-committing a line. The edge fn enforces the same rule.
        const handoffs = await listHandoffs();
        const committed = {};
        for (const h of handoffs) {
          if (String(h.sending_shop).toLowerCase() !== String(myShop).toLowerCase()) continue;
          if (h.source_order_id !== order.order_id) continue;
          if (!LIVE_HANDOFF.has(h.status)) continue;
          for (const id of h.source_line_ids || []) committed[String(id)] = h.receiving_shop;
        }
        setCommittedLines(committed);
        // Drop committed lines from the default selection.
        setSelectedLines((prev) => {
          const next = new Set(prev);
          for (const id of Object.keys(committed)) next.delete(id);
          return next;
        });
      } catch { /* best-effort; the edge fn still guards overlap */ }
    })();
  }, [myShop, order.order_id]);

  // Pull the partner's published trade sheet (RLS grants it only while
  // actively partnered) so the trade price can auto-fill from their rates.
  useEffect(() => {
    if (!partnerShop) { setPartnerSheet(null); return; }
    let cancelled = false;
    (async () => {
      const sheet = await getPartnerTradeSheet(partnerShop);
      if (!cancelled) setPartnerSheet(sheet);
    })();
    return () => { cancelled = true; };
  }, [partnerShop]);

  const selectedLineObjs = useMemo(
    () => (order.line_items || []).filter((li, idx) => selectedLines.has(String(li?.id ?? idx))),
    [order.line_items, selectedLines],
  );

  // Suggested trade price = the selected lines' DECORATION cost at the
  // partner's rates (same engine as a quote; garment cost excluded).
  const suggested = useMemo(
    () => (partnerSheet && selectedLineObjs.length ? computeTradeTotal(selectedLineObjs, partnerSheet) : 0),
    [partnerSheet, selectedLineObjs],
  );

  // Pre-fill from the partner's rates until the user types their own number.
  useEffect(() => {
    if (suggested > 0 && !userEditedPrice) setTradeTotal(String(suggested));
  }, [suggested, userEditedPrice]);

  const toggleLine = (id) => {
    setSelectedLines((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleSend = async () => {
    if (sending) return;
    const trade = parseFloat(tradeTotal);
    if (!partnerShop) { notify.error("Pick a partner", "Choose which shop gets this job."); return; }
    if (!selectedLines.size) { notify.error("Nothing selected", "Pick at least one line to send."); return; }
    if (!Number.isFinite(trade) || trade <= 0) {
      notify.error("Trade price required", "Enter what you'll pay the partner — their invoice is generated from this number.");
      return;
    }
    setSending(true);
    try {
      await offerHandoff({
        partnerShop,
        orderId: order.order_id,
        lineIds: [...selectedLines],
        blind,
        note,
        dueDate: dueDate || null,
        tradeTotal: trade,
      });
      notify.success("Job offered", `${partnerShop} has been notified. You'll hear back when they accept.`);
      onSent?.();
      onClose();
    } catch (err) {
      notify.error("Couldn't send the job", err);
    } finally {
      setSending(false);
    }
  };

  return (
    <ModalBackdrop onClose={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Handshake className="w-5 h-5 text-teal-600" />
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Send to Partner — {order.order_id}</h2>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 transition" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {partners !== null && partners.length === 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
              No active partners yet. Invite one in Account → Partners first.
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Partner shop</label>
            <select value={partnerShop} onChange={(e) => setPartnerShop(e.target.value)}
              className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-900">
              <option value="">Select partner…</option>
              {(partners || []).map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Lines to send</label>
            <div className="space-y-1.5">
              {(order.line_items || []).map((li, idx) => {
                const id = String(li?.id ?? idx);
                const label = li.customTitle || [li.brand, li.style].filter(Boolean).join(" ") || `Line ${idx + 1}`;
                const qty = Object.values(li.sizes || {}).reduce((s, v) => s + (parseInt(v) || 0), 0);
                const committedTo = committedLines[id];
                if (committedTo) {
                  return (
                    <div key={id} className="flex items-center gap-2 text-sm select-none bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-2 opacity-60">
                      <input type="checkbox" checked={false} disabled className="accent-teal-600" />
                      <span className="flex-1 text-slate-500 line-through">{label}</span>
                      <span className="text-[10px] font-semibold text-teal-700">→ {committedTo}</span>
                    </div>
                  );
                }
                return (
                  <label key={id} className="flex items-center gap-2 text-sm cursor-pointer select-none bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-2">
                    <input type="checkbox" checked={selectedLines.has(id)} onChange={() => toggleLine(id)} className="accent-teal-600" />
                    <span className="flex-1 text-slate-700 dark:text-slate-200">{label}</span>
                    <span className="text-xs text-slate-500">{qty} pcs</span>
                  </label>
                );
              })}
              {Object.keys(committedLines).length > 0 && (
                <p className="text-[11px] text-slate-400 pt-0.5">
                  Struck-through lines are already out to a partner — send the rest to another shop.
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Trade price ($)</label>
              <input type="number" step="0.01" min="0" value={tradeTotal}
                onChange={(e) => { setUserEditedPrice(true); setTradeTotal(e.target.value); }}
                placeholder="what you'll pay them"
                className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-900" />
              {suggested > 0 && (
                <p className="text-[11px] text-slate-400 mt-1">
                  {userEditedPrice && String(suggested) !== tradeTotal ? (
                    <button type="button" onClick={() => { setUserEditedPrice(false); setTradeTotal(String(suggested)); }}
                      className="text-teal-600 hover:text-teal-800 font-medium">
                      Use {partnerShop}&rsquo;s rate: {fmtMoney(suggested)}
                    </button>
                  ) : (
                    <>From {partnerShop}&rsquo;s rates — adjust if you agreed otherwise.</>
                  )}
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Need it by</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
                className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-900" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Note to partner</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
              placeholder="thread colors, placement notes…"
              className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-900" />
          </div>

          <label className="flex items-start gap-2 text-sm cursor-pointer select-none">
            <input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} className="accent-teal-600 mt-0.5" />
            <span className="text-slate-600 dark:text-slate-300">
              <span className="font-semibold">Keep my customer private</span> — the partner sees job specs and art only,
              never your customer's name or your pricing. (Recommended.)
            </span>
          </label>

          {Number.isFinite(parseFloat(tradeTotal)) && parseFloat(tradeTotal) > 0 && (
            <div className="bg-slate-50 dark:bg-slate-800 rounded-xl px-3 py-2 text-xs text-slate-500">
              On acceptance, {fmtMoney(parseFloat(tradeTotal))} is locked as this job's trade price — the partner's
              invoice to you is generated from it, and it lands on your order as a cost for job profit tracking.
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-slate-50 dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 px-6 py-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-slate-600 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-100 transition">
            Cancel
          </button>
          <button onClick={handleSend} disabled={sending || !partners?.length}
            className="px-5 py-2 text-sm font-bold bg-teal-600 hover:bg-teal-700 text-white rounded-xl transition disabled:opacity-50 flex items-center gap-2">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Handshake className="w-4 h-4" />}
            {sending ? "Sending…" : "Offer Job"}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
