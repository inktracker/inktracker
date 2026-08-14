import { useState, useEffect } from "react";
import { useAuth } from "@/lib/AuthContext";
import { shopScope } from "@/lib/shopScope";
import { notify } from "@/lib/notify";
import { listPartnerships, invitePartner, respondToInvite, partnerOf } from "@/lib/partners";
import PartnerTradeSheetEditor from "./PartnerTradeSheetEditor";
import { Handshake, Loader2, Check, X } from "lucide-react";

// Account → Partners: peer shops you subcontract with
// (docs/shop-partnerships-design.md). Invite by owner email; the other
// side accepts here too. Hand-offs themselves happen from orders.
export default function PartnersSection() {
  const { user } = useAuth();
  const myShop = shopScope(user);
  const [links, setLinks] = useState(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try { setLinks(await listPartnerships()); } catch { setLinks([]); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setBusy(true);
    try {
      const res = await invitePartner(inviteEmail.trim());
      if (res?.notFound) {
        notify.error("Not on InkTracker yet", res.message);
      } else {
        notify.success("Invite sent", `We let ${inviteEmail.trim()} know.`);
        setInviteEmail("");
        await load();
      }
    } catch (err) {
      notify.error("Couldn't send the invite", err);
    } finally {
      setBusy(false);
    }
  };

  const handleRespond = async (link, accept) => {
    setBusy(true);
    try {
      await respondToInvite(link.id, accept);
      await load();
      if (accept) notify.success("Partnership active", "You can now send each other jobs from any order.");
    } catch (err) {
      notify.error("Couldn't update the invite", err);
    } finally {
      setBusy(false);
    }
  };

  const incoming = (links || []).filter((l) => l.status === "invited" && String(l.shop_b).toLowerCase() === String(myShop).toLowerCase());
  const outgoing = (links || []).filter((l) => l.status === "invited" && String(l.shop_a).toLowerCase() === String(myShop).toLowerCase());
  const active = (links || []).filter((l) => l.status === "active");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Handshake className="w-5 h-5 text-teal-600" />
        <h3 className="font-bold text-slate-900">Partner Shops</h3>
      </div>
      <p className="text-xs text-slate-500 leading-relaxed">
        Partners are other InkTracker shops you subcontract with — send them the work
        you don't do in-house (embroidery, printing, …) straight from an order. They
        see the job specs and art, never your customer or your pricing.
      </p>

      <div className="flex gap-2">
        <input
          type="email"
          value={inviteEmail}
          onChange={(e) => setInviteEmail(e.target.value)}
          placeholder="partner shop's owner email"
          className="flex-1 text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-900"
        />
        <button
          onClick={handleInvite}
          disabled={busy || !inviteEmail.trim()}
          className="px-4 py-2 text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white rounded-xl transition disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Invite"}
        </button>
      </div>

      {links === null ? (
        <div className="text-xs text-slate-400">Loading…</div>
      ) : (
        <div className="space-y-2">
          {incoming.map((l) => (
            <div key={l.id} className="flex items-center justify-between bg-teal-50 border border-teal-200 rounded-xl px-3 py-2">
              <span className="text-sm text-teal-800 font-semibold">{l.shop_a} invited you to partner</span>
              <div className="flex gap-2">
                <button onClick={() => handleRespond(l, true)} disabled={busy}
                  className="p-1.5 bg-teal-600 text-white rounded-lg hover:bg-teal-700" aria-label="Accept invite">
                  <Check className="w-4 h-4" />
                </button>
                <button onClick={() => handleRespond(l, false)} disabled={busy}
                  className="p-1.5 border border-slate-200 text-slate-500 rounded-lg hover:bg-slate-100" aria-label="Decline invite">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
          {active.map((l) => (
            <div key={l.id} className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
              <span className="text-sm text-slate-700 font-semibold">{partnerOf(l, myShop)}</span>
              <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-600">Active</span>
            </div>
          ))}
          {outgoing.map((l) => (
            <div key={l.id} className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
              <span className="text-sm text-slate-500">{l.shop_b}</span>
              <span className="text-[10px] font-bold uppercase tracking-wide text-amber-600">Invite pending</span>
            </div>
          ))}
          {!incoming.length && !active.length && !outgoing.length && (
            <p className="text-xs text-slate-400">No partners yet — invite a shop you already trade work with.</p>
          )}
        </div>
      )}

      <PartnerTradeSheetEditor />
    </div>
  );
}
