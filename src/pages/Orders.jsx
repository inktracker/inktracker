import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { base44 } from "@/api/supabaseClient";
import { O_STATUSES, fmtDate, fmtMoney, getOrderDisplayClient, getOrderDisplayJobTitle } from "../components/shared/pricing";
import { runOrderCompletion } from "@/lib/orders/runOrderCompletion";
import Badge from "../components/shared/Badge";
import OrderDetailModal from "../components/orders/OrderDetailModal";
import InvoiceDetailModal from "../components/invoices/InvoiceDetailModal";
import AdvancedFilters from "../components/AdvancedFilters";
import EmptyState from "../components/shared/EmptyState";
import HintTip from "../components/shared/HintTip";
import { useBillingGate } from "@/lib/billing-gate";
import { notify } from "@/lib/notify";
import { handleBrokerOrderDeletion } from "@/lib/orders/handleBrokerOrderDeletion";
import { todayInShopTz } from "@/lib/shopTimezone";

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
        // base44.auth.me() returns null when the auth session is
        // missing OR the profile lookup misses (the most common cause:
        // a race with the handle_new_user trigger right after signup
        // — JWT lands in the browser before the profile row is
        // committed). Bail with a soft empty state instead of throwing
        // "Cannot read properties of null (reading 'email')". The
        // AuthContext layer will re-check and route the user to
        // PostConfirmSpinner if the profile is genuinely missing.
        if (!currentUser?.email) {
          setOrders([]);
          setCustomers({});
          return;
        }
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
        notify.error("Couldn't load orders", err);
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
      // Calendar/Production filter requires completed_date to show the
      // green "Completed" chip. Mirror Production.jsx handleAdvance so
      // the order doesn't fall off the calendar when marked complete
      // from this list.
      const payload = { status: nextStatus };
      if (nextStatus === "Completed" && !order.completed_date) {
        // Shop-tz, not UTC. After ~5pm Pacific the UTC date is
        // already tomorrow — using toISOString() here stamped
        // tomorrow's date and the Calendar's green chip landed on
        // the wrong day. The Alder Creek "didn't show on today"
        // regression (2026-05-30).
        payload.completed_date = todayInShopTz();
      }
      const updated = await base44.entities.Order.update(id, payload);
      setOrders((prev) => prev.map((o) => (o.id === id ? updated : o)));

      // Modal lifecycle: keep open through the pipeline stages so the
      // operator doesn't lose their place mid-job. Final transition
      // to Completed → close so they return to the order queue.
      if (viewing?.id === id) {
        if (nextStatus === "Completed") setViewing(null);
        else setViewing(updated);
      }
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
    const updated = await runOrderCompletion({ order, userEmail: user.email, base44 });
    setOrders((prev) => prev.map((o) => (o.id === order.id ? updated : o)));
    setViewing(null);
  }

  async function handleDelete(id) {
    if (!window.confirm("Delete this order?")) return;
    const order = orders.find((o) => o.id === id);
    await base44.entities.Order.delete(id);
    setOrders((prev) => prev.filter((o) => o.id !== id));
    setViewing(null);

    // Cascade: remove broker-pricing rows tied to this order (the
    // reference is meaningless without its parent order).
    if (order?.order_id) {
      try {
        const rows = await base44.entities.BrokerPricing.filter({ order_id: order.order_id });
        await Promise.all((rows || []).map((r) => base44.entities.BrokerPricing.delete(r.id)));
      } catch (err) {
        console.warn("[Orders] broker-pricing cleanup failed:", err);
      }
    }

    // If this was a broker order, roll the source quote back so the
    // broker isn't staring at a "Converted to Order" status with no
    // underlying order, and ping their ShopActionFeed.
    handleBrokerOrderDeletion(order);
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
            className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition ${filter === s ? "bg-teal-600 text-white border-teal-600" : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-500 hover:border-teal-300"}`}
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
                        <span className="text-xs font-semibold text-teal-700 bg-teal-50 border border-teal-100 px-2.5 py-1 rounded-full whitespace-nowrap">
                          {artworkCount} file{artworkCount === 1 ? "" : "s"}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-slate-500">{o.due_date ? fmtDate(o.due_date) : "—"}</td>
                    <td className="px-5 py-3.5 font-bold text-slate-800 dark:text-slate-200">{fmtMoney(o.total || 0)}</td>
                    <td className="px-5 py-3.5"><Badge s={o.status} /></td>
                    <td className="px-5 py-3.5 text-right text-teal-400 text-xs font-semibold">View →</td>
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
                    <span className="text-[11px] font-semibold text-teal-700 bg-teal-50 border border-teal-100 px-2 py-1 rounded-full">
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
          customer={customers[viewing.customer_id]}
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
          // Successful Send returns operator to the orders queue.
          onSendSuccess={() => setViewing(null)}
        />
      )}
    </div>
  );
}