import { useState, useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useReadOnly } from "@/lib/billing-gate";
import { base44, supabase } from "@/api/supabaseClient";
import { cachedFilter } from "@/lib/queries/cachedEntity";
import { TableRowsSkeleton, ListCardsSkeleton } from "@/components/shared/Skeletons";
import { fmtDate, fmtMoney, tod, getDisplayName } from "../components/shared/pricing";
import { computeOutstanding } from "@/lib/reports/invoiceStats";

const SUPABASE_FUNC_URL = import.meta.env.VITE_SUPABASE_URL;
import InvoiceDetailModal from "../components/invoices/InvoiceDetailModal";
import AdvancedFilters from "../components/AdvancedFilters";
import EmptyState from "../components/shared/EmptyState";
import { shopScope } from "@/lib/shopScope";
import { localDateStr } from "@/lib/dateRangeUtils";

function getThisMonth() {
  // localDateStr, not toISOString — UTC conversion shifted the month
  // boundaries a day for shops east of UTC (see dateRangeUtils.js).
  const now = new Date();
  const from = localDateStr(new Date(now.getFullYear(), now.getMonth(), 1));
  const to = localDateStr(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  return { from, to };
}

export default function Invoices() {
  const location = useLocation();
  const urlParams = new URLSearchParams(location.search);
  const initialCustomer = urlParams.get("customer") || "";

  const [invoices, setInvoices] = useState([]);
  const [customers, setCustomers] = useState({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("All");
  const [selected, setSelected] = useState(null);
  const [user, setUser] = useState(null);
  // Default to "All time" so new users with their first invoice
  // (created any time before this calendar month) still see it in
  // the list. The "This Month" preset is still available via the
  // date-shortcut buttons below if they want it.
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [advFilters, setAdvFilters] = useState(initialCustomer ? { customer: initialCustomer } : {});
  const [qbOutstanding, setQbOutstanding] = useState(null);
  // SCALE-05: the QB pull caps at 10k rows. Surface it here too (the Account
  // migrate flow already does) so a large shop's silent truncation isn't only
  // visible in server logs.
  const [qbTruncated, setQbTruncated] = useState(false);
  const [sortKey, setSortKey] = useState("date");
  const [sortDir, setSortDir] = useState("desc");

  // Read-only gate: when the shop's subscription has lapsed, write
  // affordances (mark paid, send, delete, push-to-QB, reorder…) are
  // disabled with a reactivate hint. Viewing/printing stays allowed.
  // Pass the page's loaded `user` so the gate reads the freshest state.
  const { readOnly, reason: readOnlyReason, reactivateHref } = useReadOnly(user);

  useEffect(() => {
    async function loadData() {
      const currentUser = await base44.auth.me();
      setUser(currentUser);

      const c = await cachedFilter("Customer", { filters: { shop_owner: shopScope(currentUser) } });
      const custMap = {};
      c.forEach(cust => custMap[cust.id] = cust);
      setCustomers(custMap);

      // Load local invoices first, then sync with QB in background. Cached for
      // fast nav; the post-QB-sync refetch below stays direct (must be fresh).
      const inv = await cachedFilter("Invoice", { filters: { shop_owner: shopScope(currentUser) }, sort: "-date", limit: 1000 });
      setInvoices(inv);
      setLoading(false);

      // Pull live stats and sync from QB (non-blocking)
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          // Sync invoices from QB (updates existing, creates new — no duplicates)
          const { data: pullRes } = await base44.functions.invoke("qbSync", {
            action: "pullInvoices",
            accessToken: session.access_token,
          });
          if (pullRes?.truncatedAtCap) setQbTruncated(true);
          // Reload with fresh data + recompute outstanding from local rows.
          const freshInv = await base44.entities.Invoice.filter({ shop_owner: shopScope(currentUser) }, "-date", 1000);
          setInvoices(freshInv);
          const stats = computeOutstanding(freshInv);
          setQbOutstanding({ total: stats.total, count: stats.count });
        }
      } catch {}
    }
    loadData();
  }, []);

  const handleAdvFilterChange = (key, value) => {
    setAdvFilters(prev => value ? { ...prev, [key]: value } : { ...prev, [key]: undefined });
  };

  const filtered = useMemo(() => {
    let result = invoices;
    // Date filter
    if (dateFrom) result = result.filter(i => (i.date || i.created_at?.split("T")[0] || "") >= dateFrom);
    if (dateTo) result = result.filter(i => (i.date || i.created_at?.split("T")[0] || "") <= dateTo);
    // Status filter
    if (filter === "Paid") result = result.filter(i => i.paid);
    else if (filter === "Unpaid") result = result.filter(i => !i.paid);
    // Advanced filters
    if (advFilters.customer) {
      const q = advFilters.customer.toLowerCase();
      result = result.filter(i => {
        const cust = customers[i.customer_id];
        const hay = [i.customer_name, cust?.company, cust?.name].filter(Boolean).join(" ").toLowerCase();
        return hay.includes(q);
      });
    }
    if (advFilters.invoiceId) result = result.filter(i => i.invoice_id?.toLowerCase().includes(advFilters.invoiceId.toLowerCase()));
    if (advFilters.minTotal) result = result.filter(i => (i.total || 0) >= parseFloat(advFilters.minTotal));
    if (advFilters.maxTotal) result = result.filter(i => (i.total || 0) <= parseFloat(advFilters.maxTotal));
    return result;
  }, [invoices, dateFrom, dateTo, filter, advFilters]);

  const advFilterOptions = [
    { key: "customer", label: "Customer Name", type: "text" },
    { key: "invoiceId", label: "Invoice ID", type: "text" },
    { key: "minTotal", label: "Min Total", type: "text" },
    { key: "maxTotal", label: "Max Total", type: "text" },
  ];

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };
  const sortArrow = (key) => sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let av, bv;
      if (sortKey === "customer") {
        av = (getDisplayName(customers[a.customer_id] || a.customer_name) || "").toLowerCase();
        bv = (getDisplayName(customers[b.customer_id] || b.customer_name) || "").toLowerCase();
      } else if (sortKey === "total") {
        av = a.total || 0; bv = b.total || 0;
      } else if (sortKey === "subtotal") {
        av = a.subtotal || 0; bv = b.subtotal || 0;
      } else if (sortKey === "tax") {
        av = a.tax || 0; bv = b.tax || 0;
      } else if (sortKey === "date") {
        av = a.date || ""; bv = b.date || "";
      } else if (sortKey === "due") {
        av = a.due || ""; bv = b.due || "";
      } else if (sortKey === "invoice_id") {
        av = (a.invoice_id || "").toLowerCase(); bv = (b.invoice_id || "").toLowerCase();
      } else if (sortKey === "status") {
        av = a.paid ? 1 : 0; bv = b.paid ? 1 : 0;
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [filtered, sortKey, sortDir, customers]);

  const allUnpaid = invoices.filter(i => !i.paid);
  const allUnpaidTotal = allUnpaid.reduce((s, i) => s + (i.total || 0), 0);
  const paidTotal = filtered.filter(i => i.paid).reduce((s, i) => s + (i.total || 0), 0);
  const filteredTotal = filtered.reduce((s, i) => s + (i.total || 0), 0);

  async function markPaid(id) {
    const invoice = invoices.find((i) => i.id === id);
    // QB-synced invoices: push the payment through to QB so the two
    // systems stay in sync. Without this, the InkTracker invoice flips
    // to paid while the QB invoice still shows an open balance — and
    // anyone looking at QB sees the customer still owes us.
    if (invoice?.qb_invoice_id) {
      const docLabel = invoice.qb_doc_number || `#${invoice.qb_invoice_id}`;
      const amount = Number(invoice.total) || 0;
      const proceed = window.confirm(
        `Record ${fmtMoney(amount)} payment in QuickBooks for invoice ${docLabel}?\n\n` +
        `This posts a Payment to QB linked to that invoice, marks both QB and InkTracker as paid, and does NOT email the customer. ` +
        `If the customer already paid via the QB portal link, we'll detect that and just sync the local state without double-counting.\n\n` +
        `Continue?`
      );
      if (!proceed) return;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const { data, error } = await supabase.functions.invoke("qbSync", {
          body: {
            action: "recordPayment",
            accessToken: session?.access_token,
            invoice_id: id,
            qb_invoice_id: invoice.qb_invoice_id,
          },
        });
        if (error) throw new Error(error.message || "QB payment record failed");
        if (data?.error) throw new Error(data.error);
        // Re-pull the row — the edge function patched it server-side.
        const refreshed = await base44.entities.Invoice.get(id);
        setInvoices(prev => prev.map(i => i.id === id ? refreshed : i));
        return;
      } catch (err) {
        console.error("[markPaid] QB push failed:", err);
        window.alert(
          `Couldn't record the payment in QuickBooks: ${err.message || "unknown error"}.\n\n` +
          `The InkTracker invoice was NOT marked paid to avoid drift. Open QuickBooks → Receive Payment to record it manually, then refresh.`
        );
        return;
      }
    }
    // No QB linkage: local-only flip (unchanged behavior).
    const updated = await base44.entities.Invoice.update(id, { paid: true, paid_date: tod() });
    setInvoices(prev => prev.map(i => i.id === id ? updated : i));
  }

  async function handleDelete(id) {
    const invoice = invoices.find((i) => i.id === id);
    // QB-synced invoices: deleting the InkTracker row leaves the QB
    // invoice intact (and still collecting on the customer-facing pay
    // link). Operators need to delete it inside QuickBooks first or the
    // two systems silently drift. Make the prompt unambiguous about it.
    const isQbSynced = Boolean(invoice?.qb_invoice_id);
    const message = isQbSynced
      ? `This invoice is synced to QuickBooks (${invoice.qb_doc_number || `#${invoice.qb_invoice_id}`}).\n\n` +
        `Deleting it here will NOT delete it in QuickBooks — the QB invoice and its payment link stay live, and your customer can still pay. ` +
        `To fully remove the invoice, delete it inside QuickBooks first, then remove it here.\n\n` +
        `Continue removing this row from InkTracker anyway?`
      : "Delete this invoice? This cannot be undone.";
    if (!window.confirm(message)) return;
    await base44.entities.Invoice.delete(id);
    setInvoices(prev => prev.filter(i => i.id !== id));
    setSelected(null);

    // Cascade: drop any broker-pricing row tied to this invoice's order
    // (the row goes stale when its parent order is gone).
    if (invoice?.order_id) {
      try {
        const rows = await base44.entities.BrokerPricing.filter({ order_id: invoice.order_id });
        await Promise.all((rows || []).map((r) => base44.entities.BrokerPricing.delete(r.id)));
      } catch (err) {
        console.warn("[Invoices] broker-pricing cleanup failed:", err);
      }
    }
  }

  async function handleConvertToInvoice(invoice) {
    // Mark invoice as finalized (completed state)
    const updated = await base44.entities.Invoice.update(invoice.id, { status: "Completed" });
    setInvoices(prev => prev.map(i => i.id === invoice.id ? updated : i));
    setSelected(updated);
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100">Invoices</h2>
      </div>
      {qbTruncated && (
        <div role="status" className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          QuickBooks returned more than 10,000 invoices — only the most recent were synced. Older
          invoices may be missing here. Contact support if you need the full history imported.
        </div>
      )}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <div className="bg-red-50 border border-red-100 rounded-xl p-2.5 sm:p-4">
          <div className="text-[10px] font-bold text-red-400 uppercase tracking-widest mb-1">Outstanding</div>
          <div className="text-lg sm:text-2xl font-bold text-red-600 truncate">{fmtMoney(qbOutstanding ? qbOutstanding.total : allUnpaidTotal)}</div>
          <div className="text-[10px] text-red-400">{qbOutstanding ? qbOutstanding.count : allUnpaid.length} unpaid</div>
        </div>
        <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-2.5 sm:p-4">
          <div className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest mb-1">Collected</div>
          <div className="text-lg sm:text-2xl font-bold text-emerald-600 truncate">{fmtMoney(paidTotal)}</div>
          <div className="text-[10px] text-emerald-400">{filtered.filter(i=>i.paid).length} paid</div>
        </div>
        <div className="bg-slate-50 border border-slate-100 rounded-xl p-2.5 sm:p-4">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Total Billed</div>
          <div className="text-lg sm:text-2xl font-bold text-slate-700 truncate">{fmtMoney(filteredTotal)}</div>
          <div className="text-[10px] text-slate-500">{filtered.length} invoices</div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <div className="flex gap-2">
          {["All","Paid","Unpaid"].map(f=>(
            <button key={f} onClick={()=>setFilter(f)} className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition ${filter===f?"bg-teal-600 text-white border-teal-600":"bg-white border-slate-200 text-slate-500 hover:border-teal-300"}`}>{f}</button>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          {[
            { label: "This Month", fn: () => { const m = getThisMonth(); setDateFrom(m.from); setDateTo(m.to); } },
            { label: "Last Month", fn: () => { const d = new Date(); d.setMonth(d.getMonth()-1); const from = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split("T")[0]; const to = new Date(d.getFullYear(), d.getMonth()+1, 0).toISOString().split("T")[0]; setDateFrom(from); setDateTo(to); } },
            { label: "This Year", fn: () => { setDateFrom(`${new Date().getFullYear()}-01-01`); setDateTo(new Date().toISOString().split("T")[0]); } },
            { label: "All Time", fn: () => { setDateFrom(""); setDateTo(""); } },
          ].map(p => (
            <button key={p.label} onClick={p.fn}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg transition ${
                (p.label === "This Month" && (() => { const m = getThisMonth(); return dateFrom === m.from && dateTo === m.to; })()) ||
                (p.label === "All Time" && !dateFrom && !dateTo)
                  ? "bg-slate-800 text-white" : "text-slate-500 hover:bg-slate-100"
              }`}>{p.label}</button>
          ))}
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-teal-300" />
          <span className="text-xs text-slate-500">to</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-teal-300" />
        </div>
      </div>
      <AdvancedFilters filters={advFilters} onFilterChange={handleAdvFilterChange} filterOptions={advFilterOptions} />
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
            {[
              { label: "Invoice", key: "invoice_id" },
              { label: "Customer", key: "customer" },
              { label: "Issued", key: "date" },
              { label: "Due", key: "due" },
              { label: "Subtotal", key: "subtotal" },
              { label: "Tax", key: "tax" },
              { label: "Total", key: "total" },
              { label: "Status", key: "status" },
              { label: "", key: null },
            ].map(h=>(
              <th key={h.label || "action"} onClick={h.key ? () => toggleSort(h.key) : undefined}
                className={`text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-widest ${h.key ? "cursor-pointer hover:text-slate-600 select-none" : ""}`}>
                {h.label}{h.key ? sortArrow(h.key) : ""}
              </th>
            ))}
          </tr></thead>
          <tbody>
            {loading && <TableRowsSkeleton rows={8} cols={9} />}
            {!loading && invoices.length === 0 && (
              <tr><td colSpan={9}><EmptyState type="invoices" /></td></tr>
            )}
            {!loading && invoices.length > 0 && sorted.length === 0 && (
              <tr><td colSpan={9} className="py-8 text-center text-sm text-slate-500">No invoices match your current filters.</td></tr>
            )}
            {sorted.map(inv=>(
              <tr key={inv.id} className="border-b border-slate-50 hover:bg-slate-50 dark:bg-slate-800 transition cursor-pointer" onClick={() => setSelected(inv)}>
                <td className="px-4 py-3.5 font-mono text-xs text-slate-500">{inv.invoice_id}</td>
                <td className="px-4 py-3.5 font-semibold text-slate-800 dark:text-slate-200">{getDisplayName(customers[inv.customer_id] || inv.customer_name)}</td>
                <td className="px-4 py-3.5 text-slate-500">{fmtDate(inv.date)}</td>
                <td className="px-4 py-3.5 text-slate-500">{fmtDate(inv.due)}</td>
                <td className="px-4 py-3.5 text-slate-600">{fmtMoney(inv.subtotal)}</td>
                <td className="px-4 py-3.5 text-slate-500">{fmtMoney(inv.tax)}</td>
                <td className="px-4 py-3.5 font-bold text-slate-800 dark:text-slate-200">{fmtMoney(inv.total)}</td>
                <td className="px-4 py-3.5">
                  {inv.paid
                    ?<span className="text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full whitespace-nowrap">Paid</span>
                    :<span className="text-xs font-semibold text-red-500 bg-red-50 border border-red-100 px-2.5 py-1 rounded-full whitespace-nowrap">Unpaid</span>
                  }
                </td>
                <td className="px-4 py-3.5">
                  {!inv.paid && (
                    <button onClick={e => { e.stopPropagation(); markPaid(inv.id); }}
                      disabled={readOnly}
                      title={readOnly ? readOnlyReason : undefined}
                      className="text-xs font-semibold text-emerald-600 border border-emerald-200 px-2.5 py-1 rounded-lg hover:bg-emerald-50 transition whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed">Mark Paid</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>

        <div className="md:hidden divide-y divide-slate-100">
          {loading && <ListCardsSkeleton />}
          {!loading && invoices.length === 0 && <EmptyState type="invoices" />}
          {!loading && invoices.length > 0 && sorted.length === 0 && (
            <div className="py-8 text-center text-sm text-slate-500">No invoices match your current filters.</div>
          )}
          {sorted.map(inv => (
            <div key={inv.id} className="p-4 border-b border-slate-50 hover:bg-slate-50 dark:bg-slate-800 cursor-pointer transition" onClick={() => setSelected(inv)}>
              <div className="flex justify-between items-start mb-2">
                <div>
                  <div className="font-mono text-xs text-slate-500">{inv.invoice_id}</div>
                  <div className="font-semibold text-slate-800 dark:text-slate-200">{getDisplayName(customers[inv.customer_id] || inv.customer_name)}</div>
                </div>
                {inv.paid
                  ? <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">Paid</span>
                  : <span className="text-xs font-semibold text-red-500 bg-red-50 border border-red-100 px-2.5 py-1 rounded-full">Unpaid</span>
                }
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500 gap-3">
                <span>Due: {fmtDate(inv.due)}</span>
                <span className="font-bold text-slate-800 dark:text-slate-200">{fmtMoney(inv.total)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      {selected && (
        <InvoiceDetailModal
          invoice={selected}
          customer={customers[selected.customer_id]}
          onClose={() => setSelected(null)}
          onMarkPaid={(id) => { markPaid(id); setSelected(prev => ({ ...prev, paid: true })); }}
          onConvertToInvoice={handleConvertToInvoice}
          onDelete={handleDelete}
          readOnly={readOnly}
          readOnlyReason={readOnlyReason}
          reactivateHref={reactivateHref}
        />
      )}
    </div>
  );
}