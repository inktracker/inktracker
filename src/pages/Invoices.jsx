import { useState, useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { base44, supabase } from "@/api/supabaseClient";
import { fmtDate, fmtMoney, tod, getDisplayName } from "../components/shared/pricing";
import { computeOutstanding } from "@/lib/reports/invoiceStats";

const SUPABASE_FUNC_URL = import.meta.env.VITE_SUPABASE_URL;
import InvoiceDetailModal from "../components/invoices/InvoiceDetailModal";
import AdvancedFilters from "../components/AdvancedFilters";
import EmptyState from "../components/shared/EmptyState";

function getThisMonth() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];
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
  const [sortKey, setSortKey] = useState("date");
  const [sortDir, setSortDir] = useState("desc");

  useEffect(() => {
    async function loadData() {
      const currentUser = await base44.auth.me();
      setUser(currentUser);

      const c = await base44.entities.Customer.filter({ shop_owner: currentUser.email });
      const custMap = {};
      c.forEach(cust => custMap[cust.id] = cust);
      setCustomers(custMap);

      // Load local invoices first, then sync with QB in background
      const inv = await base44.entities.Invoice.filter({ shop_owner: currentUser.email }, "-date", 1000);
      setInvoices(inv);
      setLoading(false);

      // Pull live stats and sync from QB (non-blocking)
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          // Sync invoices from QB (updates existing, creates new — no duplicates)
          await fetch(`${SUPABASE_FUNC_URL}/functions/v1/qbSync`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "pullInvoices", accessToken: session.access_token }),
          });
          // Reload with fresh data + recompute outstanding from local rows.
          const freshInv = await base44.entities.Invoice.filter({ shop_owner: currentUser.email }, "-date", 1000);
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
    const updated = await base44.entities.Invoice.update(id, { paid: true, paid_date: tod() });
    setInvoices(prev => prev.map(i => i.id === id ? updated : i));
  }

  async function handleDelete(id) {
    if (!window.confirm("Delete this invoice? This cannot be undone.")) return;
    const invoice = invoices.find((i) => i.id === id);
    await base44.entities.Invoice.delete(id);
    setInvoices(prev => prev.filter(i => i.id !== id));
    setSelected(null);

    // Cascade: drop any commission row created from this invoice's order
    if (invoice?.order_id) {
      try {
        const commissions = await base44.entities.Commission.filter({ order_id: invoice.order_id });
        await Promise.all((commissions || []).map((c) => base44.entities.Commission.delete(c.id)));
      } catch (err) {
        console.warn("[Invoices] commission cleanup failed:", err);
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
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Total Billed</div>
          <div className="text-lg sm:text-2xl font-bold text-slate-700 truncate">{fmtMoney(filteredTotal)}</div>
          <div className="text-[10px] text-slate-400">{filtered.length} invoices</div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <div className="flex gap-2">
          {["All","Paid","Unpaid"].map(f=>(
            <button key={f} onClick={()=>setFilter(f)} className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition ${filter===f?"bg-indigo-600 text-white border-indigo-600":"bg-white border-slate-200 text-slate-500 hover:border-indigo-300"}`}>{f}</button>
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
            className="text-xs border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
          <span className="text-xs text-slate-400">to</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
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
                className={`text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-widest ${h.key ? "cursor-pointer hover:text-slate-600 select-none" : ""}`}>
                {h.label}{h.key ? sortArrow(h.key) : ""}
              </th>
            ))}
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={9} className="px-5 py-8 text-center text-slate-300">Loading…</td></tr>}
            {!loading && invoices.length === 0 && (
              <tr><td colSpan={9}><EmptyState type="invoices" /></td></tr>
            )}
            {sorted.map(inv=>(
              <tr key={inv.id} className="border-b border-slate-50 hover:bg-slate-50 dark:bg-slate-800 transition cursor-pointer" onClick={() => setSelected(inv)}>
                <td className="px-4 py-3.5 font-mono text-xs text-slate-400">{inv.invoice_id}</td>
                <td className="px-4 py-3.5 font-semibold text-slate-800 dark:text-slate-200">{getDisplayName(customers[inv.customer_id] || inv.customer_name)}</td>
                <td className="px-4 py-3.5 text-slate-500">{fmtDate(inv.date)}</td>
                <td className="px-4 py-3.5 text-slate-500">{fmtDate(inv.due)}</td>
                <td className="px-4 py-3.5 text-slate-600">{fmtMoney(inv.subtotal)}</td>
                <td className="px-4 py-3.5 text-slate-400">{fmtMoney(inv.tax)}</td>
                <td className="px-4 py-3.5 font-bold text-slate-800 dark:text-slate-200">{fmtMoney(inv.total)}</td>
                <td className="px-4 py-3.5">
                  {inv.paid
                    ?<span className="text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full whitespace-nowrap">Paid</span>
                    :<span className="text-xs font-semibold text-red-500 bg-red-50 border border-red-100 px-2.5 py-1 rounded-full whitespace-nowrap">Unpaid</span>
                  }
                </td>
                <td className="px-4 py-3.5">
                  {!inv.paid && (
                    <button onClick={e => { e.stopPropagation(); markPaid(inv.id); }} className="text-xs font-semibold text-emerald-600 border border-emerald-200 px-2.5 py-1 rounded-lg hover:bg-emerald-50 transition whitespace-nowrap">Mark Paid</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>

        <div className="md:hidden divide-y divide-slate-100">
          {loading && <div className="px-4 py-8 text-center text-slate-300">Loading…</div>}
          {!loading && invoices.length === 0 && <EmptyState type="invoices" />}
          {sorted.map(inv => (
            <div key={inv.id} className="p-4 border-b border-slate-50 hover:bg-slate-50 dark:bg-slate-800 cursor-pointer transition" onClick={() => setSelected(inv)}>
              <div className="flex justify-between items-start mb-2">
                <div>
                  <div className="font-mono text-xs text-slate-400">{inv.invoice_id}</div>
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
        />
      )}
    </div>
  );
}