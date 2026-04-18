import { useState, useEffect } from "react";
import { base44 } from "@/api/supabaseClient";
import { fmtDate, fmtMoney, tod, getDisplayName } from "../components/shared/pricing";
import InvoiceDetailModal from "../components/invoices/InvoiceDetailModal";
import AdvancedFilters from "../components/AdvancedFilters";

export default function Invoices() {
  const [invoices, setInvoices] = useState([]);
  const [customers, setCustomers] = useState({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("All");
  const [selected, setSelected] = useState(null);
  const [user, setUser] = useState(null);
  const [advFilters, setAdvFilters] = useState({});

  useEffect(() => {
    async function loadData() {
      const currentUser = await base44.auth.me();
      setUser(currentUser);
      Promise.all([
        base44.entities.Invoice.filter({ shop_owner: currentUser.email }, "-created_date", 100),
        base44.entities.Customer.filter({ shop_owner: currentUser.email })
      ]).then(([inv, c]) => {
        setInvoices(inv);
        const custMap = {};
        c.forEach(cust => custMap[cust.id] = cust);
        setCustomers(custMap);
        setLoading(false);
      });
    }
    loadData();
  }, []);

  const handleAdvFilterChange = (key, value) => {
    setAdvFilters(prev => value ? { ...prev, [key]: value } : { ...prev, [key]: undefined });
  };

  let filtered = filter==="All" ? invoices : filter==="Paid" ? invoices.filter(i=>i.paid) : invoices.filter(i=>!i.paid);
  filtered = filtered.filter(i => {
    if (advFilters.customer && !i.customer_name.toLowerCase().includes(advFilters.customer.toLowerCase())) return false;
    if (advFilters.invoiceId && !i.invoice_id?.toLowerCase().includes(advFilters.invoiceId.toLowerCase())) return false;
    if (advFilters.minTotal && (i.total || 0) < parseFloat(advFilters.minTotal)) return false;
    if (advFilters.maxTotal && (i.total || 0) > parseFloat(advFilters.maxTotal)) return false;
    return true;
  });

  const advFilterOptions = [
    { key: "customer", label: "Customer Name", type: "text" },
    { key: "invoiceId", label: "Invoice ID", type: "text" },
    { key: "minTotal", label: "Min Total", type: "text" },
    { key: "maxTotal", label: "Max Total", type: "text" },
  ];

  const unpaidTotal = invoices.filter(i=>!i.paid).reduce((s,i)=>s+i.total,0);
  const paidTotal = invoices.filter(i=>i.paid).reduce((s,i)=>s+i.total,0);

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
        <h2 className="text-2xl font-bold text-slate-900">Invoices</h2>
      </div>
      <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
        <div className="bg-red-50 border border-red-100 rounded-2xl p-5">
          <div className="text-xs font-bold text-red-400 uppercase tracking-widest mb-1">Outstanding</div>
          <div className="text-2xl font-bold text-red-600">{fmtMoney(unpaidTotal)}</div>
          <div className="text-xs text-red-400">{invoices.filter(i=>!i.paid).length} unpaid</div>
        </div>
        <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-5">
          <div className="text-xs font-bold text-emerald-500 uppercase tracking-widest mb-1">Collected</div>
          <div className="text-2xl font-bold text-emerald-600">{fmtMoney(paidTotal)}</div>
          <div className="text-xs text-emerald-400">{invoices.filter(i=>i.paid).length} paid</div>
        </div>
        <div className="bg-slate-50 border border-slate-100 rounded-2xl p-5">
          <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Total Billed</div>
          <div className="text-2xl font-bold text-slate-700">{fmtMoney(unpaidTotal+paidTotal)}</div>
          <div className="text-xs text-slate-400">{invoices.length} invoices</div>
        </div>
      </div>
      <div className="flex gap-2">
        {["All","Paid","Unpaid"].map(f=>(
          <button key={f} onClick={()=>setFilter(f)} className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition ${filter===f?"bg-indigo-600 text-white border-indigo-600":"bg-white border-slate-200 text-slate-500 hover:border-indigo-300"}`}>{f}</button>
        ))}
      </div>
      <AdvancedFilters filters={advFilters} onFilterChange={handleAdvFilterChange} filterOptions={advFilterOptions} />
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-100 bg-slate-50">
            {["Invoice","Customer","Issued","Due","Subtotal","Tax","Total","Status",""].map(h=>(
              <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-widest">{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={9} className="px-5 py-8 text-center text-slate-300">Loading…</td></tr>}
            {filtered.map(inv=>(
              <tr key={inv.id} className="border-b border-slate-50 hover:bg-slate-50 transition cursor-pointer" onClick={() => setSelected(inv)}>
                <td className="px-4 py-3.5 font-mono text-xs text-slate-400">{inv.invoice_id}</td>
                <td className="px-4 py-3.5 font-semibold text-slate-800">{getDisplayName(customers[inv.customer_id] || inv.customer_name)}</td>
                <td className="px-4 py-3.5 text-slate-500">{fmtDate(inv.date)}</td>
                <td className="px-4 py-3.5 text-slate-500">{fmtDate(inv.due)}</td>
                <td className="px-4 py-3.5 text-slate-600">{fmtMoney(inv.subtotal)}</td>
                <td className="px-4 py-3.5 text-slate-400">{fmtMoney(inv.tax)}</td>
                <td className="px-4 py-3.5 font-bold text-slate-800">{fmtMoney(inv.total)}</td>
                <td className="px-4 py-3.5">
                  {inv.paid
                    ?<span className="text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">Paid {fmtDate(inv.paid_date)}</span>
                    :<span className="text-xs font-semibold text-red-500 bg-red-50 border border-red-100 px-2.5 py-1 rounded-full">Unpaid</span>
                  }
                </td>
                <td className="px-4 py-3.5">
                  {!inv.paid && (
                    <button onClick={e => { e.stopPropagation(); markPaid(inv.id); }} className="text-xs font-semibold text-emerald-600 border border-emerald-200 px-2.5 py-1 rounded-lg hover:bg-emerald-50 transition">Mark Paid</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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