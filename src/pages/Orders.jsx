import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { base44 } from "@/api/supabaseClient";
import { O_STATUSES, fmtDate, fmtMoney, getOrderDisplayClient, getOrderDisplayJobTitle } from "../components/shared/pricing";
import { buildOrderCompletionPlan } from "@/lib/orders/completeOrder";
import Badge from "../components/shared/Badge";
import OrderDetailModal from "../components/orders/OrderDetailModal";
import InvoiceDetailModal from "../components/invoices/InvoiceDetailModal";
import AdvancedFilters from "../components/AdvancedFilters";
import EmptyState from "../components/shared/EmptyState";
import HintTip from "../components/shared/HintTip";
import { useBillingGate } from "@/lib/billing-gate";

function getOrderArtworkCount(order) {
  const keys = new Set();

  (order?.selected_artwork || []).forEach((art) => {
    const key = art.id || art.url || art.name;
    if (key) keys.add(key);
  });

  (order?.line_items || []).forEach((li) => {
    (li.imprints || []).forEach((imp) => {
      const key = imp.artwork_id || imp.artwork_url || imp.artwork_name;
      if (key) keys.add(key);
    });
  });

  return keys.size;
}

export default function Orders() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const initialFilter = O_STATUSES.includes(params.get("status")) ? params.get("status") : "All";
  const initialOrderId = params.get("id") || null;
  const initialCustomer = params.get("customer") || "";

  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(initialFilter);
  const [viewing, setViewing] = useState(null);
  const [user, setUser] = useState(null);
  const { gate: billingGate } = useBillingGate(user);
  const [viewingInvoice, setViewingInvoice] = useState(null);
  const [advFilters, setAdvFilters] = useState(initialCustomer ? { customer: initialCustomer } : {});
  const [originFilter, setOriginFilter] = useState("All");
  const [sortKey, setSortKey] = useState("due_date");
  const [sortDir, setSortDir] = useState("desc");

  useEffect(() => {
    async function loadData() {
      try {
        const currentUser = await base44.auth.me();
        setUser(currentUser);
        const [o, c] = await Promise.all([
          base44.entities.Order.filter({ shop_owner: currentUser.email }, "-created_date", 100),
          base44.entities.Customer.filter({ shop_owner: currentUser.email }),
        ]);
        setOrders(o);
        const custMap = {};
        c.forEach((cust) => (custMap[cust.id] = cust));
        setCustomers(custMap);
        // Auto-open a specific order if ?id= was passed from the Dashboard
        if (initialOrderId) {
          const match = o.find((row) => row.id === initialOrderId || row.order_id === initialOrderId);
          if (match) setViewing(match);
          navigate("/Orders", { replace: true });
        }
      } catch (err) {
        console.error("Orders load failed:", err);
      } finally {
        setLoading(false);
      }
    }
    loadData();

  }, []);

  const handleAdvFilterChange = (key, value) => {
    setAdvFilters((prev) => (value ? { ...prev, [key]: value } : { ...prev, [key]: undefined }));
  };

  let filtered = filter === "All" ? orders : orders.filter((o) => o.status === filter);
  filtered = filtered.filter((o) => {
    if (originFilter === "Internal" && o.broker_id) return false;
    if (originFilter === "Broker" && !o.broker_id) return false;
    return true;
  });
  filtered = filtered.filter((o) => {
    if (advFilters.customer) {
      const customerSearch = advFilters.customer.toLowerCase();
      const haystack = [o.customer_name, o.broker_client_name, o.job_title]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(customerSearch)) return false;
    }
    if (advFilters.orderId && !o.order_id?.toLowerCase().includes(advFilters.orderId.toLowerCase())) return false;
    if (advFilters.minTotal && (o.total || 0) < parseFloat(advFilters.minTotal)) return false;
    if (advFilters.maxTotal && (o.total || 0) > parseFloat(advFilters.maxTotal)) return false;
    return true;
  });

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };
  const sortArrow = (key) => sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  filtered = [...filtered].sort((a, b) => {
    let av, bv;
    if (sortKey === "customer") {
      av = (getOrderDisplayClient(a, customers[a.customer_id]) || "").toLowerCase();
      bv = (getOrderDisplayClient(b, customers[b.customer_id]) || "").toLowerCase();
    } else if (sortKey === "total") {
      av = a.total || 0; bv = b.total || 0;
    } else if (sortKey === "due_date") {
      av = a.due_date || ""; bv = b.due_date || "";
    } else if (sortKey === "order_id") {
      av = (a.order_id || "").toLowerCase(); bv = (b.order_id || "").toLowerCase();
    } else if (sortKey === "status") {
      av = a.status || ""; bv = b.status || "";
    }
    if (av < bv) return sortDir === "asc" ? -1 : 1;
    if (av > bv) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  const advFilterOptions = [
    { key: "customer", label: "Customer / Job Title", type: "text" },
    { key: "orderId", label: "Order ID", type: "text" },
    { key: "minTotal", label: "Min Total", type: "text" },
    { key: "maxTotal", label: "Max Total", type: "text" },
  ];

  async function handleAdvance(id) {
    const order = orders.find((o) => o.id === id);
    const idx = O_STATUSES.indexOf(order.status);
    const nextStatus = idx >= 0 && idx < O_STATUSES.length - 1 ? O_STATUSES[idx + 1] : null;
    if (nextStatus) {
      const updated = await base44.entities.Order.update(id, { status: nextStatus });
      setOrders((prev) => prev.map((o) => (o.id === id ? updated : o)));
      if (viewing?.id === id) setViewing(updated);
    }
  }

  async function handleRevert(id) {
    const order = orders.find((o) => o.id === id);
    const idx = O_STATUSES.indexOf(order.status);
    const prevStatus = idx > 0 ? O_STATUSES[idx - 1] : null;
    if (prevStatus) {
      const updated = await base44.entities.Order.update(id, { status: prevStatus });
      setOrders((prev) => prev.map((o) => (o.id === id ? updated : o)));
      if (viewing?.id === id) setViewing(updated);
    }
  }

  async function handleComplete(order) {
    if (billingGate("complete orders")) return;
    // Uses the same pure helper + pre-fetch pattern as Production.jsx
    // so completion is duplicate-proof. The BrokerFile branch
    // (PDF attachment for broker orders) isn't in the helper because
    // it's optional and Orders-specific — kept inline below.
    const today = new Date().toISOString().split("T")[0];

    let existingInvoice = null;
    try {
      const byOrderId = await base44.entities.Invoice.filter({
        shop_owner: user.email,
        order_id: order.order_id,
      });
      if (byOrderId.length > 0) {
        existingInvoice = byOrderId[0];
      } else if (order.quote_id) {
        const byQuoteId = await base44.entities.Invoice.filter({
          shop_owner: user.email,
          invoice_id: order.quote_id,
        });
        if (byQuoteId.length > 0) existingInvoice = byQuoteId[0];
      }
      // Third fallback: orders converted before PR#45 lack order.quote_id.
      // Walk Quote.converted_order_id → quote_id to recover the link.
      if (!existingInvoice) {
        const originatingQuotes = await base44.entities.Quote.filter({
          shop_owner: user.email,
          converted_order_id: order.order_id,
        });
        const qId = originatingQuotes?.[0]?.quote_id;
        if (qId) {
          const byReversedQuoteId = await base44.entities.Invoice.filter({
            shop_owner: user.email,
            invoice_id: qId,
          });
          if (byReversedQuoteId.length > 0) existingInvoice = byReversedQuoteId[0];
        }
      }
    } catch (err) {
      console.error("[handleComplete] failed to look up existing invoice:", err);
    }

    const plan = buildOrderCompletionPlan(order, {
      today,
      shopOwner: user.email,
      existingInvoice,
    });

    if (plan.invoiceLink) {
      await base44.entities.Invoice.update(plan.invoiceLink.id, plan.invoiceLink.patch);
    } else if (plan.invoiceCreate) {
      await base44.entities.Invoice.create(plan.invoiceCreate);
    }

    if (plan.brokerPerformanceCreate) {
      await base44.entities.BrokerPerformance.create(plan.brokerPerformanceCreate);

      // BrokerFile attachment — only fires when the order has a
      // pdf_url already on it. Independent of the invoice path.
      if (order.pdf_url) {
        await base44.entities.BrokerFile.create({
          broker_id: order.broker_id,
          shop_owner: user.email,
          order_id: order.order_id,
          customer_name: order.customer_name,
          file_url: order.pdf_url,
          date: today,
        });
      }
    }
    await base44.entities.ShopPerformance.create(plan.shopPerformanceCreate);
    const updated = await base44.entities.Order.update(plan.orderUpdate.id, plan.orderUpdate.patch);
    setOrders((prev) => prev.map((o) => (o.id === order.id ? updated : o)));
    setViewing(null);
  }

  async function handleDelete(id) {
    if (!window.confirm("Delete this order?")) return;
    const order = orders.find((o) => o.id === id);
    await base44.entities.Order.delete(id);
    setOrders((prev) => prev.filter((o) => o.id !== id));
    setViewing(null);

    // Cascade: remove any commission rows tied to this order
    if (order?.order_id) {
      try {
        const commissions = await base44.entities.Commission.filter({ order_id: order.order_id });
        await Promise.all((commissions || []).map((c) => base44.entities.Commission.delete(c.id)));
      } catch (err) {
        console.warn("[Orders] commission cleanup failed:", err);
      }
    }
  }

  async function handleTogglePaid(order) {
    const newPaid = !order.paid;
    const updated = await base44.entities.Order.update(order.id, {
      paid: newPaid,
      paid_date: newPaid ? new Date().toISOString().split("T")[0] : null,
    });
    setOrders((prev) => prev.map((o) => (o.id === order.id ? updated : o)));
    setViewing(updated);
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100">Orders</h2>
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {["All", ...O_STATUSES].map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition ${filter === s ? "bg-indigo-600 text-white border-indigo-600" : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-500 hover:border-indigo-300"}`}
          >
            {s}
          </button>
        ))}
      </div>
      <div className="flex gap-2 items-center">
        {["All", "Internal", "Broker"].map((o) => (
          <button
            key={o}
            onClick={() => setOriginFilter(o)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition ${originFilter === o ? "bg-slate-800 text-white border-slate-800" : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-400"}`}
          >
            {o}
          </button>
        ))}
        <HintTip text="Internal = orders your shop created. Broker = orders submitted by your sales reps." side="bottom" />
      </div>
      <AdvancedFilters filters={advFilters} onFilterChange={handleAdvFilterChange} filterOptions={advFilterOptions} />
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                {[
                  { label: "Order ID", key: "order_id" },
                  { label: "Customer", key: "customer" },
                  { label: "Artwork", key: null },
                  { label: "Due", key: "due_date" },
                  { label: "Total", key: "total" },
                  { label: "Status", key: "status" },
                  { label: "", key: null },
                ].map((h) => (
                  <th key={h.label || "action"} onClick={h.key ? () => toggleSort(h.key) : undefined}
                    className={`text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-widest ${h.key ? "cursor-pointer hover:text-slate-600 select-none" : ""}`}>
                    {h.label}{h.key ? sortArrow(h.key) : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-slate-300">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && orders.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <EmptyState type="orders" />
                  </td>
                </tr>
              )}
              {filtered.map((o) => {
                const artworkCount = getOrderArtworkCount(o);
                return (
                  <tr
                    key={o.id}
                    className="border-b border-slate-50 hover:bg-slate-50 dark:bg-slate-800 cursor-pointer transition"
                    onClick={() => setViewing(o)}
                  >
                    <td className="px-5 py-3.5 font-mono text-xs text-slate-400">{o.order_id}</td>
                    <td className="px-5 py-3.5">
                      <div className="font-semibold text-slate-800 dark:text-slate-200">
                        {getOrderDisplayClient(o, customers[o.customer_id])}
                      </div>
                      {getOrderDisplayJobTitle(o, customers[o.customer_id]) && (
                        <div className="text-xs text-slate-400 mt-0.5">
                          Job: {getOrderDisplayJobTitle(o, customers[o.customer_id])}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      {artworkCount > 0 ? (
                        <span className="text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded-full whitespace-nowrap">
                          {artworkCount} file{artworkCount === 1 ? "" : "s"}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-slate-500">{o.due_date ? fmtDate(o.due_date) : "—"}</td>
                    <td className="px-5 py-3.5 font-bold text-slate-800 dark:text-slate-200">{fmtMoney(o.total || 0)}</td>
                    <td className="px-5 py-3.5"><Badge s={o.status} /></td>
                    <td className="px-5 py-3.5 text-right text-indigo-400 text-xs font-semibold">View →</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="md:hidden divide-y divide-slate-100">
          {loading && <div className="px-4 py-8 text-center text-slate-300">Loading…</div>}
          {!loading && orders.length === 0 && <EmptyState type="orders" />}
          {filtered.map((o) => {
            const artworkCount = getOrderArtworkCount(o);
            return (
              <div key={o.id} className="p-4 border-b border-slate-50 hover:bg-slate-50 dark:bg-slate-800 cursor-pointer transition" onClick={() => setViewing(o)}>
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <div className="font-mono text-xs text-slate-400">{o.order_id}</div>
                    <div className="font-semibold text-slate-800 dark:text-slate-200">{getOrderDisplayClient(o, customers[o.customer_id])}</div>
                    {getOrderDisplayJobTitle(o, customers[o.customer_id]) && (
                      <div className="text-xs text-slate-400 mt-0.5">
                        Job: {getOrderDisplayJobTitle(o, customers[o.customer_id])}
                      </div>
                    )}
                  </div>
                  <Badge s={o.status} />
                </div>
                <div className="flex items-center justify-between text-xs text-slate-500 gap-3">
                  <span>Due: {o.due_date ? fmtDate(o.due_date) : "—"}</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">{fmtMoney(o.total || 0)}</span>
                </div>
                {artworkCount > 0 && (
                  <div className="mt-2">
                    <span className="text-[11px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-1 rounded-full">
                      {artworkCount} artwork file{artworkCount === 1 ? "" : "s"}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {viewing && (
        <OrderDetailModal
          order={orders.find((x) => x.id === viewing.id) || viewing}
          onClose={() => setViewing(null)}
          onAdvance={handleAdvance}
          onRevert={handleRevert}
          onComplete={handleComplete}
          onDelete={handleDelete}
          onTogglePaid={handleTogglePaid}
          onShowInvoice={(invoice) => setViewingInvoice(invoice)}
        />
      )}

      {viewingInvoice && (
        <InvoiceDetailModal
          invoice={viewingInvoice}
          customer={null}
          onClose={() => setViewingInvoice(null)}
          onMarkPaid={() => {}}
          onDelete={() => {}}
        />
      )}
    </div>
  );
}