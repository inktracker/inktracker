import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/api/supabaseClient";
import { fmtMoney } from "../shared/pricing";
import { summarizeTaxByState, taxReportTotals } from "@/lib/tax/taxReport";

// Sales-tax-collected, by state, from the immutable tax_records (Phase 3).
// This is the figure a shop files a return from. RLS scopes rows to the shop,
// so we just select + date-filter. `from`/`to` are ISO dates (null = all time).
export default function SalesTaxReport({ from = null, to = null }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError("");
      try {
        let q = supabase
          .from("tax_records")
          .select("ship_to_state,taxable_amount,tax_total,total,exempt,txn_date");
        if (from) q = q.gte("txn_date", from);
        if (to) q = q.lte("txn_date", to);
        const { data, error: e } = await q.limit(5000);
        if (!active) return;
        if (e) setError(e.message);
        else setRecords(data || []);
      } catch (e) {
        if (active) setError(e?.message || "Failed to load tax records");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [from, to]);

  const rows = useMemo(() => summarizeTaxByState(records), [records]);
  const totals = useMemo(() => taxReportTotals(rows), [rows]);

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-700 overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
        <div>
          <div className="text-sm font-bold text-slate-800 dark:text-slate-100">Sales Tax Collected — by State</div>
          <div className="text-xs text-slate-500">
            What you collected, for filing returns. Tax as recorded by QuickBooks at sale time.
          </div>
        </div>
        {totals.count > 0 && (
          <div className="text-right">
            <div className="text-lg font-bold text-slate-900 dark:text-slate-100">{fmtMoney(totals.tax)}</div>
            <div className="text-xs text-slate-500">{totals.count} invoice{totals.count === 1 ? "" : "s"}</div>
          </div>
        )}
      </div>

      {error ? (
        <div className="px-5 py-4 text-sm text-rose-600">{error}</div>
      ) : loading ? (
        <div className="px-5 py-8 text-center text-sm text-slate-400">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-slate-500">
          No tax records yet. They're created as invoices sync to QuickBooks.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-xs text-slate-500 uppercase tracking-wide">
                <th className="px-4 py-2.5 text-left font-semibold">State</th>
                <th className="px-4 py-2.5 text-right font-semibold">Invoices</th>
                <th className="px-4 py-2.5 text-right font-semibold">Taxable</th>
                <th className="px-4 py-2.5 text-right font-semibold">Tax collected</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.state} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-2.5 font-semibold text-slate-700 dark:text-slate-200">
                    {r.state}
                    {r.exemptCount > 0 && (
                      <span className="ml-2 text-[11px] font-medium text-slate-400">
                        {r.exemptCount} exempt
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-500">{r.count}</td>
                  <td className="px-4 py-2.5 text-right text-slate-500">{fmtMoney(r.taxable)}</td>
                  <td className="px-4 py-2.5 text-right font-bold text-slate-900 dark:text-slate-100">{fmtMoney(r.tax)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 font-bold text-slate-800 dark:text-slate-100">
                <td className="px-4 py-2.5">Total</td>
                <td className="px-4 py-2.5 text-right">{totals.count}</td>
                <td className="px-4 py-2.5 text-right">{fmtMoney(totals.taxable)}</td>
                <td className="px-4 py-2.5 text-right">{fmtMoney(totals.tax)}</td>
              </tr>
            </tfoot>
          </table>
          <div className="px-5 py-3 text-[11px] text-slate-400 border-t border-slate-100 dark:border-slate-800">
            File a return in each state where you have nexus. States you ship to but don't collect in show $0 — confirm that matches your nexus.
          </div>
        </div>
      )}
    </div>
  );
}
