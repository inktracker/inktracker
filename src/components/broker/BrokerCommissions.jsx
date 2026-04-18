import { useState, useEffect } from "react";
import { base44 } from "@/api/supabaseClient";
import { BadgeDollarSign } from "lucide-react";
import { fmtMoney, fmtDate } from "../shared/pricing";

const STATUS_STYLES = {
  Pending: "bg-yellow-100 text-yellow-700",
  Approved: "bg-blue-100 text-blue-700",
  Paid: "bg-emerald-100 text-emerald-700",
};

/**
 * Commission tracking component.
 * isAdmin=true → shop owner view: can approve/pay commissions, set pct per record.
 * isAdmin=false → broker view: read-only summary.
 */
export default function BrokerCommissions({ brokerEmail, shopOwner, isAdmin = false }) {
  const [commissions, setCommissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);

  useEffect(() => {
    if (!brokerEmail) return;
    const query = isAdmin
      ? { broker_id: brokerEmail, shop_owner: shopOwner }
      : { broker_id: brokerEmail };
    base44.entities.Commission.filter(query, "-created_date", 200)
      .then(c => { setCommissions(c); setLoading(false); });
  }, [brokerEmail, shopOwner, isAdmin]);

  async function updateStatus(commission, status) {
    setSaving(commission.id);
    const data = { status };
    if (status === "Paid") data.paid_date = new Date().toISOString().split("T")[0];
    const updated = await base44.entities.Commission.update(commission.id, data);
    setCommissions(prev => prev.map(c => c.id === updated.id ? updated : c));
    setSaving(null);
  }

  async function updatePct(commission, pct) {
    const amount = ((commission.order_total || 0) * pct) / 100;
    const updated = await base44.entities.Commission.update(commission.id, {
      commission_pct: pct,
      commission_amount: amount,
    });
    setCommissions(prev => prev.map(c => c.id === updated.id ? updated : c));
  }

  const totalEarned = commissions.filter(c => c.status === "Paid").reduce((s, c) => s + (c.commission_amount || 0), 0);
  const totalPending = commissions.filter(c => c.status !== "Paid").reduce((s, c) => s + (c.commission_amount || 0), 0);

  if (loading) return <div className="text-sm text-slate-400">Loading commissions…</div>;

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
          <div className="text-xs font-semibold text-emerald-600 uppercase tracking-widest mb-1">Total Paid</div>
          <div className="text-2xl font-bold text-emerald-700">{fmtMoney(totalEarned)}</div>
        </div>
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
          <div className="text-xs font-semibold text-yellow-600 uppercase tracking-widest mb-1">Pending / Approved</div>
          <div className="text-2xl font-bold text-yellow-700">{fmtMoney(totalPending)}</div>
        </div>
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
          <div className="text-xs font-semibold text-indigo-600 uppercase tracking-widest mb-1">Total Deals</div>
          <div className="text-2xl font-bold text-indigo-700">{commissions.length}</div>
        </div>
      </div>

      {commissions.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl py-14 text-center">
          <BadgeDollarSign className="w-10 h-10 text-slate-200 mx-auto mb-3" />
          <p className="text-slate-400 text-sm">No commissions yet. They appear when broker orders are converted.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                {["Order", "Customer", "Order Total", "Rate", "Commission", "Status", isAdmin ? "Actions" : ""].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-widest">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {commissions.map(c => (
                <tr key={c.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{c.order_id}</td>
                  <td className="px-4 py-3 font-semibold text-slate-800">{c.customer_name || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{fmtMoney(c.order_total)}</td>
                  <td className="px-4 py-3">
                    {isAdmin ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="number" min="0" max="100"
                          defaultValue={c.commission_pct || 10}
                          onBlur={e => updatePct(c, parseFloat(e.target.value) || 10)}
                          className="w-14 text-xs text-right border border-slate-200 rounded px-1.5 py-1 focus:outline-none"
                        />
                        <span className="text-xs text-slate-400">%</span>
                      </div>
                    ) : (
                      <span className="text-slate-600">{c.commission_pct || 10}%</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-bold text-indigo-700">{fmtMoney(c.commission_amount)}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_STYLES[c.status] || STATUS_STYLES.Pending}`}>
                      {c.status}
                    </span>
                    {c.status === "Paid" && c.paid_date && (
                      <div className="text-xs text-slate-400 mt-0.5">{fmtDate(c.paid_date)}</div>
                    )}
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3">
                      <div className="flex gap-1.5">
                        {c.status === "Pending" && (
                          <button
                            onClick={() => updateStatus(c, "Approved")}
                            disabled={saving === c.id}
                            className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-blue-100 text-blue-700 hover:bg-blue-200 transition"
                          >
                            Approve
                          </button>
                        )}
                        {c.status === "Approved" && (
                          <button
                            onClick={() => updateStatus(c, "Paid")}
                            disabled={saving === c.id}
                            className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition"
                          >
                            Mark Paid
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}