import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { base44, supabase } from "@/api/supabaseClient";
import { Loader2, Mail, Trash2 } from "lucide-react";
import EmptyState from "../components/shared/EmptyState";
import HintTip from "../components/shared/HintTip";
import {
  Q_STATUSES,
  calcQuoteTotals,
  getQty,
  getTier,
  fmtDate,
  fmtMoney,
  getDisplayName,
  BROKER_MARKUP,
} from "../components/shared/pricing";
import Badge from "../components/shared/Badge";
import QuoteEditorModal from "../components/quotes/QuoteEditorModal";
import QuoteDetailModal from "../components/quotes/QuoteDetailModal";
import AdvancedFilters from "../components/AdvancedFilters";

function isBrokerQuote(q) {
  return Boolean(q?.broker_id || q?.broker_email || q?.brokerId);
}

function getQuoteTotalsForDisplay(q) {
  return calcQuoteTotals(q, isBrokerQuote(q) ? BROKER_MARKUP : undefined);
}

export default function Quotes() {
  const location = useLocation();
  const navigate = useNavigate();
  const searchId = new URLSearchParams(location.search).get("id");

  const [quotes, setQuotes] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [customerMap, setCustomerMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("All");
  const [viewing, setViewing] = useState(null);
  const [editing, setEditing] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [user, setUser] = useState(null);
  const [brokerMap, setBrokerMap] = useState({});
  const [converting, setConverting] = useState(false);
  const [advFilters, setAdvFilters] = useState({});
  const [brokerFilter, setBrokerFilter] = useState("All");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;
  const [bulkSelect, setBulkSelect] = useState(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [sortKey, setSortKey] = useState("date");
  const [sortDir, setSortDir] = useState("desc");
  const [showEmailPaste, setShowEmailPaste] = useState(false);
  const [emailText, setEmailText] = useState("");
  const [parsing, setParsing] = useState(false);
  const SUPABASE_FUNC_URL = import.meta.env.VITE_SUPABASE_URL;

  useEffect(() => {
    async function loadData() {
      try {
        const currentUser = await base44.auth.me();
        setUser(currentUser);

        const [allQuotes, c, allUsers] = await Promise.all([
          base44.entities.Quote.filter({ shop_owner: currentUser.email }, "-created_date", 500),
          base44.entities.Customer.filter({ shop_owner: currentUser.email }),
          base44.entities.User.list(),
        ]);

        // Exclude quotes already converted to orders — those live under Orders now.
        const q = allQuotes.filter((quote) =>
          quote.status !== "Converted to Order"
        );
        setQuotes(q);
        // If the Dashboard linked us here with ?id=, auto-open that quote
        if (searchId) {
          const match = q.find((row) => row.id === searchId || row.quote_id === searchId);
          if (match) setViewing(match);
          navigate("/Quotes", { replace: true });
        }
        setCustomers([...c].sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: 'base' })));

        const custMap = {};
        c.forEach((cust) => {
          custMap[cust.id] = cust;
        });
        setCustomerMap(custMap);

        const bMap = {};
        allUsers
          .filter((u) => u.role === "broker")
          .forEach((b) => {
            bMap[b.email] = b;
          });
        setBrokerMap(bMap);
      } catch (error) {
        console.error("Error loading data:", error);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  // Auto-open quote from ?id= param (e.g. from Dashboard click)
  useEffect(() => {
    if (searchId && quotes.length > 0 && !viewing) {
      const match = quotes.find(q => q.id === searchId);
      if (match) setViewing(match);
    }
  }, [searchId, quotes]);

  // Handle "Use in Quote" coming from the Catalog page
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("from_catalog") === "1") {
      const raw = sessionStorage.getItem("ss_prefill");
      if (raw) {
        try {
          const prefill = JSON.parse(raw);
          // Open new quote editor with the prefilled line item
          setShowNew({ prefillLineItem: prefill });
        } catch {}
        sessionStorage.removeItem("ss_prefill");
      }
      // Clean URL
      const url = new URL(window.location.href);
      url.searchParams.delete("from_catalog");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  const handleAdvFilterChange = (key, value) => {
    setPage(1);
    setAdvFilters((prev) =>
      value ? { ...prev, [key]: value } : { ...prev, [key]: undefined }
    );
  };

  let filtered = filter === "All" ? quotes : quotes.filter((q) => q.status === filter);

  filtered = filtered.filter((q) => {
    if (
      advFilters.customer &&
      !q.customer_name?.toLowerCase().includes(advFilters.customer.toLowerCase())
    ) {
      return false;
    }

    if (
      advFilters.quoteId &&
      !q.quote_id?.toLowerCase().includes(advFilters.quoteId.toLowerCase())
    ) {
      return false;
    }

    const totals = getQuoteTotalsForDisplay(q);

    if (advFilters.minTotal && totals.total < parseFloat(advFilters.minTotal)) {
      return false;
    }

    if (advFilters.maxTotal && totals.total > parseFloat(advFilters.maxTotal)) {
      return false;
    }

    if (brokerFilter === "Broker" && !q.broker_id) return false;
    if (brokerFilter === "Internal" && (q.broker_id || q.source === "wizard")) return false;
    if (brokerFilter === "Wizard" && q.source !== "wizard") return false;

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
      av = (getDisplayName(customerMap[a.customer_id] || a.customer_name) || "").toLowerCase();
      bv = (getDisplayName(customerMap[b.customer_id] || b.customer_name) || "").toLowerCase();
    } else if (sortKey === "total") {
      av = getQuoteTotalsForDisplay(a).total; bv = getQuoteTotalsForDisplay(b).total;
    } else if (sortKey === "date") {
      av = a.date || ""; bv = b.date || "";
    } else if (sortKey === "due_date") {
      av = a.due_date || ""; bv = b.due_date || "";
    } else if (sortKey === "quote_id") {
      av = (a.quote_id || "").toLowerCase(); bv = (b.quote_id || "").toLowerCase();
    } else if (sortKey === "qty") {
      av = (a.line_items || []).reduce((s, li) => s + getQty(li), 0);
      bv = (b.line_items || []).reduce((s, li) => s + getQty(li), 0);
    } else if (sortKey === "status") {
      av = a.status || ""; bv = b.status || "";
    }
    if (av < bv) return sortDir === "asc" ? -1 : 1;
    if (av > bv) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  // Reset to page 1 when filters change
  const totalFiltered = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
  const pagedQuotes = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const advFilterOptions = [
    { key: "customer", label: "Customer Name", type: "text" },
    { key: "quoteId", label: "Quote ID", type: "text" },
    { key: "minTotal", label: "Min Total", type: "text" },
    { key: "maxTotal", label: "Max Total", type: "text" },
  ];

  async function saveQuote(q) {
    const customerData = customerMap[q.customer_id];
    const customerEmail = q.customer_email || customerData?.email || "";
    // Sanitize date fields — empty strings break Postgres DATE columns
    const sanitized = {
      ...q,
      due_date: q.due_date || null,
      expires_date: q.expires_date || null,
    };
    let saved;

    if (quotes.find((x) => x.id === q.id)) {
      saved = await base44.entities.Quote.update(q.id, {
        ...sanitized,
        customer_email: customerEmail,
      });

      setQuotes((prev) => prev.map((x) => (x.id === q.id ? saved : x)));
    } else {
      saved = await base44.entities.Quote.create({
        ...sanitized,
        customer_email: customerEmail,
        shop_owner: user.email,
        quote_id: q.quote_id || `Q-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase().slice(-5)}`,
      });

      setQuotes((prev) => [saved, ...prev]);
    }

    setEditing(null);
    setShowNew(false);
    setViewing(saved);
  }

  async function addCustomer(c) {
    const created = await base44.entities.Customer.create({
      ...c,
      shop_owner: user.email,
    });

    setCustomers((prev) => [...prev, created].sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: 'base' })));
    setCustomerMap((prev) => ({
      ...prev,
      [created.id]: created,
    }));

    return created;
  }

  async function handleApprove(id) {
    const updated = await base44.entities.Quote.update(id, { status: "Approved" });
    setQuotes((prev) => prev.map((q) => (q.id === id ? updated : q)));
    setViewing(null);
  }

  async function handleDecline(id) {
    const updated = await base44.entities.Quote.update(id, { status: "Declined" });
    setQuotes((prev) => prev.map((q) => (q.id === id ? updated : q)));
    setViewing(null);
  }

  async function handleDelete(id) {
    if (!window.confirm("Delete this quote? This cannot be undone.")) return;
    await base44.entities.Quote.delete(id);
    setQuotes((prev) => prev.filter((q) => q.id !== id));
    setViewing(null);
  }

  async function handleConvert(q) {
    if (converting) return;
    if (q.converted_order_id) {
      alert("This quote has already been converted to an order.");
      return;
    }
    setConverting(true);
    try {
    const t = getQuoteTotalsForDisplay(q);
    const orderId = `ORD-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase().slice(-5)}`;

    const brokerOrder = isBrokerQuote(q);
    const brokerDisplayName = q.broker_name || q.broker_company || q.broker_id || q.customer_name;
    const brokerClientName = q.customer_name || "";

    await base44.entities.Order.create({
      order_id: orderId,
      shop_owner: user.email,
      broker_id: q.broker_id || "",
      broker_name: q.broker_name || "",
      broker_company: q.broker_company || "",
      customer_id: q.customer_id,
      customer_name: brokerOrder ? brokerDisplayName : q.customer_name,
      broker_client_name: brokerOrder ? brokerClientName : "",
      job_title: q.job_title || "",
      date: q.date,
      due_date: q.due_date || null,
      status: "Art Approval",
      line_items: q.line_items,
      notes: q.notes,
      rush_rate: q.rush_rate,
      extras: q.extras,
      discount: q.discount,
      discount_type: q.discount_type || "percent",
      tax_rate: brokerOrder ? 0 : q.tax_rate,
      subtotal: t.sub,
      tax: t.tax,
      total: t.total,
      paid: false,
      selected_artwork: q.selected_artwork || [],
    });

    // Commissions are created when the invoice is marked paid — not on quote
    // conversion — so that broker commissions only reflect completed + paid work.

    // For broker "Client Approved" quotes, update status instead of deleting
    // so the broker can still track it in their portal
    if (q.status === "Client Approved") {
      const updated = await base44.entities.Quote.update(q.id, {
        status: "Converted to Order",
        converted_order_id: orderId,
        converted_at: new Date().toISOString(),
      });
      setQuotes((prev) => prev.map((x) => (x.id === q.id ? updated : x)));
    } else {
      await base44.entities.Quote.delete(q.id);
      setQuotes((prev) => prev.filter((x) => x.id !== q.id));
    }
    setViewing(null);
    } finally {
      setConverting(false);
    }
  }

  async function handleTogglePaid(quote) {
    const newPaid = !quote.deposit_paid;
    const updated = await base44.entities.Quote.update(quote.id, {
      deposit_paid: newPaid,
    });
    setQuotes((prev) => prev.map((q) => (q.id === quote.id ? updated : q)));
    setViewing(updated);
  }

  async function handleQuoteSent() {
    try {
      const fresh = await base44.entities.Quote.filter({ id: viewing.id });
      const updated = fresh?.[0];
      if (updated) {
        setViewing(updated);
        setQuotes((prev) => prev.map((q) => (q.id === updated.id ? updated : q)));
      }
    } catch (err) {
      console.error("Failed to refresh quote after send:", err);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100">Quotes</h2>
        <div className="flex gap-2">
          {bulkSelect.size > 0 && (
            <button onClick={async () => {
              if (!window.confirm(`Delete ${bulkSelect.size} selected quote(s)?`)) return;
              setBulkDeleting(true);
              for (const id of bulkSelect) {
                try { await base44.entities.Quote.delete(id); } catch {}
              }
              setQuotes(prev => prev.filter(q => !bulkSelect.has(q.id)));
              setBulkSelect(new Set());
              setBulkDeleting(false);
            }} disabled={bulkDeleting}
              className="flex items-center gap-1.5 bg-red-500 hover:bg-red-600 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition disabled:opacity-50">
              <Trash2 className="w-4 h-4" />
              {bulkDeleting ? "Deleting..." : `Delete ${bulkSelect.size}`}
            </button>
          )}
          <button
            onClick={() => setShowNew(true)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition shadow-sm"
          >
            + New Quote
          </button>
        </div>
      </div>
      {showEmailPaste && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onMouseDown={e => { if (e.target === e.currentTarget) setShowEmailPaste(false); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg" onMouseDown={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-900">Quote from Email</h3>
              <p className="text-xs text-slate-400 mt-0.5">Paste the email content and we'll create a draft quote</p>
            </div>
            <div className="px-6 py-4">
              <textarea value={emailText} onChange={e => setEmailText(e.target.value)}
                placeholder={"Paste the email here...\n\nExample:\nHey Joe,\nNeed 50 Gildan 5000 Black t-shirts\nFront print, 3 colors\nSizes: S:5 M:15 L:15 XL:10 2XL:5"}
                rows={10}
                className="w-full text-sm border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none" />
            </div>
            <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
              <button onClick={() => { setShowEmailPaste(false); setEmailText(""); }}
                className="text-sm text-slate-500 hover:text-slate-700">Cancel</button>
              <button onClick={async () => {
                if (!emailText.trim()) return;
                setParsing(true);
                try {
                  const { data: { session } } = await supabase.auth.getSession();
                  const res = await fetch(`${SUPABASE_FUNC_URL}/functions/v1/emailScanner`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "parseAndCreate", accessToken: session?.access_token, emailBody: emailText.trim() }),
                  });
                  const data = await res.json();
                  if (data.error) { alert(data.error); }
                  else if (data.quoteId) {
                    const fresh = await base44.entities.Quote.list("-created_date", 500);
                    setQuotes(fresh);
                    setShowEmailPaste(false);
                    setEmailText("");
                    const created = fresh.find(q => q.quote_id === data.quoteId);
                    if (created) setViewing(created);
                  }
                } catch (err) { alert("Failed: " + err.message); }
                setParsing(false);
              }} disabled={parsing || !emailText.trim()}
                className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition disabled:opacity-50">
                {parsing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                {parsing ? "Creating Quote..." : "Create Draft Quote"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex gap-1.5 flex-wrap">
          {["All", ...Q_STATUSES].map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition ${
                filter === s
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-500 hover:border-indigo-300"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="flex gap-2 flex-wrap items-center">
          {["All", "Internal", "Broker", "Wizard"].map((b) => (
            <button
              key={b}
              onClick={() => setBrokerFilter(b)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition ${
                brokerFilter === b
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-500 hover:border-blue-300"
              }`}
            >
              {b}
            </button>
          ))}
          <HintTip text="Internal = created by your shop. Broker = submitted by a sales rep. Wizard = from your website's quote form." side="bottom" />
        </div>

        <AdvancedFilters
          filters={advFilters}
          onFilterChange={handleAdvFilterChange}
          filterOptions={advFilterOptions}
        />
      </div>

      <div className="text-xs text-slate-400 font-medium">
        {totalFiltered} quote{totalFiltered !== 1 ? "s" : ""}
        {totalPages > 1 && ` · page ${page} of ${totalPages}`}
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
              {[
                { label: "", key: null },
                { label: "Quote ID", key: "quote_id" },
                { label: "Customer", key: "customer" },
                { label: "Date", key: "date" },
                { label: "In-Hands", key: "due_date" },
                { label: "Qty", key: "qty" },
                { label: "Total", key: "total" },
                { label: "Tier", key: null },
                { label: "Status", key: "status" },
                { label: "", key: null },
              ].map((h, idx) => (
                <th key={h.label || `col-${idx}`} onClick={h.key ? () => toggleSort(h.key) : undefined}
                  className={`text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-widest ${h.key ? "cursor-pointer hover:text-slate-600 select-none" : ""}`}>
                  {h.label}{h.key ? sortArrow(h.key) : ""}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {loading && (
              <tr>
                <td colSpan={9} className="px-5 py-8 text-center text-slate-300">
                  Loading…
                </td>
              </tr>
            )}

            {!loading && quotes.length === 0 && (
              <tr>
                <td colSpan={9}>
                  <EmptyState type="quotes" onAction={() => setShowNew(true)} />
                </td>
              </tr>
            )}

            {pagedQuotes.map((q) => {
              const t = getQuoteTotalsForDisplay(q);
              const qty = (q.line_items || []).reduce((s, li) => s + getQty(li), 0);

              return (
                <tr
                  key={q.id}
                  className="border-b border-slate-50 hover:bg-slate-50 dark:bg-slate-800 cursor-pointer transition"
                  onClick={() => setViewing(q)}
                >
                  <td className="px-2 py-3.5 w-8" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={bulkSelect.has(q.id)}
                      onChange={e => {
                        setBulkSelect(prev => {
                          const next = new Set(prev);
                          e.target.checked ? next.add(q.id) : next.delete(q.id);
                          return next;
                        });
                      }}
                      className="rounded border-slate-300 accent-indigo-600" />
                  </td>
                  <td className="px-5 py-3.5 font-mono text-xs text-slate-400">
                    {q.quote_id}
                    {q.source === "email" && <span className="ml-1 text-indigo-500" title="From email">✉</span>}
                    {q.broker_id && (
                      <div className="text-indigo-500 font-semibold mt-0.5">
                        🤝 {brokerMap[q.broker_id]?.full_name || q.broker_name || q.broker_id}
                        {(brokerMap[q.broker_id]?.company_name || q.broker_company)
                          ? ` · ${
                              brokerMap[q.broker_id]?.company_name || q.broker_company
                            }`
                          : ""}
                      </div>
                    )}
                  </td>

                  <td className="px-5 py-3.5 font-semibold text-slate-800 dark:text-slate-200">
                    {getDisplayName(customerMap[q.customer_id] || q.customer_name) || "—"}
                  </td>

                  <td className="px-5 py-3.5 text-slate-500">{fmtDate(q.date)}</td>

                  <td className="px-5 py-3.5 text-slate-500">
                    {q.due_date ? fmtDate(q.due_date) : "—"}
                  </td>

                  <td className="px-5 py-3.5 text-slate-600">{qty} pcs</td>

                  <td className="px-5 py-3.5 font-bold text-slate-800 dark:text-slate-200">
                    {fmtMoney(t.total)}
                  </td>

                  <td className="px-5 py-3.5">
                    <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full whitespace-nowrap">
                      {qty > 0 ? getTier(qty) : "—"}+
                    </span>
                  </td>

                  <td className="px-5 py-3.5">
                    <div className="flex flex-col gap-1">
                      <Badge s={q.status} />
                      {q.expires_date && new Date(q.expires_date) < new Date() && q.status === "Pending" && (
                        <span className="text-[10px] font-semibold text-rose-600 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded-full w-fit whitespace-nowrap">
                          Expired
                        </span>
                      )}
                    </div>
                  </td>

                  <td className="px-5 py-3.5 text-right text-indigo-400 text-xs font-semibold">
                    View →
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>

        <div className="md:hidden divide-y divide-slate-100">
          {loading && <div className="px-4 py-8 text-center text-slate-300">Loading…</div>}
          {!loading && quotes.length === 0 && <EmptyState type="quotes" onAction={() => setShowNew(true)} />}
          {pagedQuotes.map((q) => {
            const t = getQuoteTotalsForDisplay(q);
            return (
              <div key={q.id} className="p-4 border-b border-slate-50 hover:bg-slate-50 dark:bg-slate-800 cursor-pointer transition" onClick={() => setViewing(q)}>
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <div className="font-mono text-xs text-slate-400">{q.quote_id}</div>
                    <div className="font-semibold text-slate-800 dark:text-slate-200">
                      {getDisplayName(customerMap[q.customer_id] || q.customer_name) || "—"}
                    </div>
                  </div>
                  <Badge s={q.status} />
                </div>
                <div className="flex items-center justify-between text-xs text-slate-500 gap-3">
                  <span>Due: {q.due_date ? fmtDate(q.due_date) : "—"}</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">{fmtMoney(t.total)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 text-sm font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 hover:bg-slate-50 dark:bg-slate-800 disabled:opacity-40 transition"
          >
            ← Prev
          </button>
          <span className="text-sm text-slate-500">{page} / {totalPages}</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 text-sm font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 hover:bg-slate-50 dark:bg-slate-800 disabled:opacity-40 transition"
          >
            Next →
          </button>
        </div>
      )}

      {viewing && (
        <QuoteDetailModal
          quote={quotes.find((x) => x.id === viewing.id) || viewing}
          customer={customerMap[viewing.customer_id] || null}
          onClose={() => setViewing(null)}
          onEdit={() => {
            setEditing(quotes.find((x) => x.id === viewing.id));
            setViewing(null);
          }}
          onApprove={handleApprove}
          onDecline={handleDecline}
          onConvert={handleConvert}
          onDelete={handleDelete}
          onSend={handleQuoteSent}
          onTogglePaid={handleTogglePaid}
          onDuplicate={async (q) => {
            const newId = `Q-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase().slice(-4)}`;
            const { id, created_date, created_at, qb_invoice_id, qb_payment_link, qb_total, qb_tax_amount, qb_subtotal, qb_synced_at, source_email_id, ...rest } = q;
            const dup = { ...rest, quote_id: newId, status: "Draft", date: new Date().toISOString().split("T")[0] };
            const created = await base44.entities.Quote.create(dup);
            setQuotes(prev => [created, ...prev]);
            setViewing(null);
            setEditing(created);
          }}
        />
      )}

      {(showNew || editing) && (
        <QuoteEditorModal
          quote={editing}
          prefillLineItem={showNew?.prefillLineItem ?? null}
          customers={customers}
          onSave={saveQuote}
          onClose={() => {
            setShowNew(false);
            setEditing(null);
          }}
          onAddCustomer={addCustomer}
          defaultTaxRate={user?.default_tax_rate || 8.265}
        />
      )}
    </div>
  );
}