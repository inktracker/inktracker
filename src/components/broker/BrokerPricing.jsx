import { useState, useEffect } from "react";
import { base44 } from "@/api/supabaseClient";
import { Tag } from "lucide-react";
import { fmtMoney, fmtDate } from "../shared/pricing";

// NOTE on terminology:
// This table lives on the `commissions` DB table for historical reasons,
// but it's NOT a 1099-style commission payout. It's the BROKER PRICING
// REFERENCE — each row shows what the shop charges the broker
// (wholesale) and the markup the broker is adding for their own client.
// The broker edits the markup % to set their resale price.
//
// DB column names stay (commission_pct / commission_amount) to avoid a
// heavier migration; everything user-facing reads as "markup" / "margin".

const STATUS_STYLES = {
  Pending: "bg-yellow-100 text-yellow-700",
  Approved: "bg-blue-100 text-blue-700",
  Paid: "bg-emerald-100 text-emerald-700",
};

/**
 * Broker pricing reference.
 *
 * isAdmin=true → shop owner view: can move rows through the status
 *               lifecycle. Sees the markup the broker has set.
 * isAdmin=false → broker view: editable markup %, so the broker can
 *                set their resale price per order.
 */
export default function BrokerPricing({ brokerEmail, shopOwner, isAdmin = false }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);

  useEffect(() => {
    if (!brokerEmail) return;
    const query = isAdmin
      ? { broker_id: brokerEmail, shop_owner: shopOwner }
      : { broker_id: brokerEmail };
    base44.entities.BrokerPricing.filter(query, "-created_date", 200)
      .then((data) => { setRows(data); })
      .catch((err) => console.error("BrokerPricing load failed:", err))
      .finally(() => setLoading(false));
  }, [brokerEmail, shopOwner, isAdmin]);

  async function updateStatus(row, status) {
    setSaving(row.id);
    const data = { status };
    if (status === "Paid") data.paid_date = new Date().toISOString().split("T")[0];
    const updated = await base44.entities.BrokerPricing.update(row.id, data);
    setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    setSaving(null);
  }

  async function updateMarkupPct(row, pct) {
    const amount = ((row.order_total || 0) * pct) / 100;
    const updated = await base44.entities.BrokerPricing.update(row.id, {
      commission_pct: pct,
      commission_amount: amount,
    });
    setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  }

  const totalEarnedMargin = rows.filter((r) => r.status === "Paid").reduce((s, r) => s + (r.commission_amount || 0), 0);
  const totalPendingMargin = rows.filter((r) => r.status !== "Paid").reduce((s, r) => s + (r.commission_amount || 0), 0);

  if (loading) return <div className="text-sm text-slate-400">Loading broker pricing…</div>;

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
          <div className="text-xs font-semibold text-emerald-600 uppercase tracking-widest mb-1">Realised Margin</div>
          <div className="text-2xl font-bold text-emerald-700">{fmtMoney(totalEarnedMargin)}</div>
        </div>
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
          <div className="text-xs font-semibold text-yellow-600 uppercase tracking-widest mb-1">Pending Margin</div>
          <div className="text-2xl font-bold text-yellow-700">{fmtMoney(totalPendingMargin)}</div>
        </div>
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
          <div className="text-xs font-semibold text-indigo-600 uppercase tracking-widest mb-1">Total Orders</div>
          <div className="text-2xl font-bold text-indigo-700">{rows.length}</div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl py-14 text-center">
          <Tag className="w-10 h-10 text-slate-200 mx-auto mb-3" />
          <p className="text-slate-400 text-sm">No broker orders yet. Pricing rows appear when broker quotes convert to orders.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                {["Order", "Client", "Shop Wholesale", "Markup %", "Your Margin", "Resale", "Status", isAdmin ? "Actions" : ""].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-widest">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const wholesale = Number(r.order_total) || 0;
                const margin = Number(r.commission_amount) || 0;
                const resale = wholesale + margin;
                return (
                  <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{r.order_id}</td>
                    <td className="px-4 py-3 font-semibold text-slate-800">{r.customer_name || "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{fmtMoney(wholesale)}</td>
                    <td className="px-4 py-3">
                      {/* Broker edits their markup; admin (shop owner) sees it read-only.
                          Inverted from the old "isAdmin can edit" pattern — the broker
                          is the one setting their resale, not the shop. */}
                      {!isAdmin ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="number" min="0" max="500"
                            defaultValue={r.commission_pct || 10}
                            onBlur={(e) => updateMarkupPct(r, parseFloat(e.target.value) || 10)}
                            className="w-14 text-xs text-right border border-slate-200 rounded px-1.5 py-1 focus:outline-none"
                          />
                          <span className="text-xs text-slate-400">%</span>
                        </div>
                      ) : (
                        <span className="text-slate-600">{r.commission_pct || 10}%</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-bold text-indigo-700">{fmtMoney(margin)}</td>
                    <td className="px-4 py-3 font-semibold text-slate-800">{fmtMoney(resale)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_STYLES[r.status] || STATUS_STYLES.Pending}`}>
                        {r.status}
                      </span>
                      {r.status === "Paid" && r.paid_date && (
                        <div className="text-xs text-slate-400 mt-0.5">{fmtDate(r.paid_date)}</div>
                      )}
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-3">
                        <div className="flex gap-1.5">
                          {r.status === "Pending" && (
                            <button
                              onClick={() => updateStatus(r, "Approved")}
                              disabled={saving === r.id}
                              className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-blue-100 text-blue-700 hover:bg-blue-200 transition"
                            >
                              Approve
                            </button>
                          )}
                          {r.status === "Approved" && (
                            <button
                              onClick={() => updateStatus(r, "Paid")}
                              disabled={saving === r.id}
                              className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition"
                            >
                              Mark Paid
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
