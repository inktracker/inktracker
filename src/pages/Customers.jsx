import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { base44, supabase } from "@/api/supabaseClient";
import { uploadFile } from "@/lib/uploadFile";
import { fmtMoney } from "../components/shared/pricing";
import Icon from "../components/shared/Icon";
import AdvancedFilters from "../components/AdvancedFilters";
import { syncCustomerToQB } from "@/lib/qbCustomerSync";
import { Loader2, GitMerge, Check } from "lucide-react";
import EmptyState from "../components/shared/EmptyState";
import {
  countCustomerDependents,
  formatDependentsMessage,
} from "@/lib/customers/countCustomerDependents";
import { useBillingGate } from "@/lib/billing-gate";

const SUPABASE_FUNC_URL = import.meta.env.VITE_SUPABASE_URL;

const emptyCustomerForm = {
  name: "",
  company: "",
  email: "",
  phone: "",
  address: "",
  notes: "",
  tax_id: "",
  tax_exempt: false,
  default_deposit_pct: 0,
};

function getClientArtworkKey(customerId) {
  return `client:${customerId}`;
}

function normalizeArtworkDoc(doc) {
  return {
    id: doc.id,
    name: doc.name,
    url: doc.file_url,
    type: doc.file_type || "",
    note: doc.note || "",
    colors: doc.color_count || "",
    uploaded_at: doc.created_date || "",
  };
}

export default function Customers() {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [artworkDocs, setArtworkDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyCustomerForm);
  const [addingCustomer, setAddingCustomer] = useState(false);
  const { gate: billingGate } = useBillingGate();
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editSaved, setEditSaved] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [user, setUser] = useState(null);
  const [filters, setFilters] = useState({});
  const [artworkNote, setArtworkNote] = useState("");
  const [artworkColorCount, setArtworkColorCount] = useState("");
  const [uploadingArtwork, setUploadingArtwork] = useState(false);
  const [qbStats, setQbStats] = useState({});
  const [showMerge, setShowMerge] = useState(false);

  useEffect(() => {
    async function loadData() {
      try {
        const currentUser = await base44.auth.me();
        setUser(currentUser);

        const [c, docs] = await Promise.all([
          base44.entities.Customer.filter({ shop_owner: currentUser.email }),
          base44.entities.BrokerDocument.filter(
            { shop_owner: currentUser.email },
            "-created_date",
            500
          ),
        ]);

        setCustomers([...c].sort((a, b) => (a.company || a.name || "").localeCompare(b.company || b.name || "", undefined, { sensitivity: 'base' })));
        setArtworkDocs(
          (docs || []).filter((doc) => String(doc.broker_id || "").startsWith("client:"))
        );

        // Fetch live stats from QB (non-blocking)
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.access_token) {
            const res = await fetch(`${SUPABASE_FUNC_URL}/functions/v1/qbSync`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "getCustomerStats", accessToken: session.access_token }),
            });
            if (res.ok) {
              const data = await res.json();
              setQbStats(data.stats || {});
            }
          }
        } catch (err) {
          console.warn("[QB stats] failed:", err?.message);
        }
      } catch (error) {
        console.error("Error loading customers:", error);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  const artworkByCustomer = useMemo(() => {
    const map = {};

    for (const doc of artworkDocs) {
      const brokerId = String(doc.broker_id || "");
      if (!brokerId.startsWith("client:")) continue;

      const customerId = brokerId.replace("client:", "");
      if (!customerId) continue;

      if (!map[customerId]) map[customerId] = [];
      map[customerId].push(normalizeArtworkDoc(doc));
    }

    return map;
  }, [artworkDocs]);

  const currentEditingArtwork = editing ? artworkByCustomer[editing.id] || [] : [];

  function canDelete() {
    // Customer deletion is a destructive accounting-adjacent action — it
    // orphans quote/order/invoice history if the dependent-count guard
    // below misses anything (id+name combos). Shop-owner only, matching
    // the gate Production/Orders/Calendar use for completion + delete.
    return user?.role === "admin" || user?.role === "shop";
  }

  async function handleDelete(id) {
    if (!canDelete()) return;
    const customer = customers.find((c) => c.id === id);
    if (!customer) return;

    // No FK constraints exist on customer_id (verified in supabase/migrations),
    // so a raw delete here silently orphans every quote/order/invoice that
    // references this customer. Check dependents first and block if any exist.
    let counts = { quotes: 0, orders: 0, invoices: 0, total: 0 };
    try {
      const [qById, oById, iById, qByName, oByName, iByName] = await Promise.all([
        base44.entities.Quote.filter({ customer_id: id }),
        base44.entities.Order.filter({ customer_id: id }),
        base44.entities.Invoice.filter({ customer_id: id }),
        customer.name ? base44.entities.Quote.filter({ customer_name: customer.name }) : Promise.resolve([]),
        customer.name ? base44.entities.Order.filter({ customer_name: customer.name }) : Promise.resolve([]),
        customer.name ? base44.entities.Invoice.filter({ customer_name: customer.name }) : Promise.resolve([]),
      ]);
      // Dedupe id+name buckets (a row may appear in both).
      const uniq = (arrs) => [...new Map(arrs.flat().map((r) => [r.id, r])).values()];
      counts = countCustomerDependents(customer, {
        quotes: uniq([qById, qByName]),
        orders: uniq([oById, oByName]),
        invoices: uniq([iById, iByName]),
      });
    } catch (err) {
      console.error("[Customers] dependent count failed:", err);
      alert("Couldn't verify this customer's history. Please try again.");
      return;
    }

    const blockMessage = formatDependentsMessage(counts, customer.name || "this customer");
    if (blockMessage) {
      alert(blockMessage);
      return;
    }

    await base44.entities.Customer.delete(id);
    setCustomers((prev) => prev.filter((c) => c.id !== id));
    setConfirmDelete(false);
    setEditing(null);
  }

  async function handleAdd() {
    if (!form.name.trim() || !user?.email) return;
    if (addingCustomer) return; // re-entry guard: double-click would create dupes
    if (billingGate("add new customers")) return;
    setAddingCustomer(true);

    let created;
    try {
      created = await base44.entities.Customer.create({
        ...form,
        shop_owner: user.email,
        orders: 0,
      });
    } catch (err) {
      console.error("[Customers] add failed:", err);
      alert("Couldn't add this customer. Please try again.");
      setAddingCustomer(false);
      return;
    }

    setCustomers((prev) => [...prev, created].sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: 'base' })));
    setForm(emptyCustomerForm);
    setShowForm(false);
    setAddingCustomer(false);

    // Push to QB in the background — won't block the UI; logs if it fails.
    syncCustomerToQB(created).then((result) => {
      if (result?.qbCustomerId) {
        base44.entities.Customer.update(created.id, { qb_customer_id: result.qbCustomerId })
          .then((updated) => {
            setCustomers((prev) => prev.map((c) => (c.id === created.id ? updated : c)));
          })
          .catch(() => {});
      }
    });
  }

  async function handleSaveEdit() {
    if (!editing?.name?.trim()) return;
    setEditSaving(true);
    try {
      // Strip server-managed and tenancy fields from the patch. RLS would
      // refuse a shop_owner rewrite anyway, but spreading the whole row
      // sends a write attempt and risks moving a customer to another shop
      // if the policy ever loosens. Send only the editable surface.
      const { id, created_date, updated_date, shop_owner, ...patch } = editing;
      const updated = await base44.entities.Customer.update(editing.id, patch);
      setCustomers((prev) => prev.map((c) => (c.id === editing.id ? updated : c)));
      setEditing(updated);
      setEditSaved(true);
      setTimeout(() => setEditSaved(false), 2500);
      // Push to QB — if no qb_customer_id yet, creates it; otherwise idempotent.
      syncCustomerToQB(updated);
    } catch (err) {
      console.error("[Customers] save edit failed:", err);
      alert("Couldn't save changes. Please try again.");
    } finally {
      setEditSaving(false);
    }
  }

  async function handleArtworkUpload(e) {
    const file = e.target.files?.[0];
    if (!file || !editing?.id || !user?.email) return;

    try {
      setUploadingArtwork(true);

      const { file_url } = await uploadFile(file);

      const createdDoc = await base44.entities.BrokerDocument.create({
        broker_id: getClientArtworkKey(editing.id),
        shop_owner: user.email,
        name: file.name,
        file_url,
        file_type: file.type || "",
        note: artworkNote.trim(),
        color_count: parseInt(artworkColorCount, 10) || null,
      });

      setArtworkDocs((prev) => [createdDoc, ...prev]);
      setArtworkNote("");
      setArtworkColorCount("");
      e.target.value = "";
    } catch (error) {
      console.error("Error uploading artwork:", error);
      alert("Artwork upload failed. Please try again.");
    } finally {
      setUploadingArtwork(false);
    }
  }

  async function handleRemoveArtwork(artworkId) {
    if (!editing) return;
    if (!window.confirm("Remove this artwork from the client library?")) return;

    await base44.entities.BrokerDocument.delete(artworkId);
    setArtworkDocs((prev) => prev.filter((doc) => doc.id !== artworkId));
  }

  const handleFilterChange = (key, value) => {
    setFilters((prev) =>
      value ? { ...prev, [key]: value } : { ...prev, [key]: undefined }
    );
  };

  const filtered = customers.filter((c) => {
    if (filters.name && !c.name.toLowerCase().includes(filters.name.toLowerCase())) {
      return false;
    }
    if (filters.company && !c.company?.toLowerCase().includes(filters.company.toLowerCase())) {
      return false;
    }
    if (filters.email && !c.email?.toLowerCase().includes(filters.email.toLowerCase())) {
      return false;
    }
    if (filters.taxExempt && !c.tax_exempt) {
      return false;
    }
    return true;
  });

  const filterOptions = [
    { key: "name", label: "Customer Name", type: "text" },
    { key: "company", label: "Company", type: "text" },
    { key: "email", label: "Email", type: "text" },
    { key: "taxExempt", label: "Tax Exempt Only", type: "checkbox" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Customers</h2>
        <div className="flex gap-2">
          <button onClick={() => setShowMerge(true)}
            className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-600 text-sm font-semibold px-4 py-2.5 rounded-xl transition hover:border-indigo-300">
            <GitMerge className="w-4 h-4" /> Merge Duplicates
          </button>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition shadow-sm"
          >
            {showForm ? "✕ Cancel" : "+ Add Customer"}
          </button>
        </div>
      </div>

      <AdvancedFilters
        filters={filters}
        onFilterChange={handleFilterChange}
        filterOptions={filterOptions}
      />

      {showForm && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-5 space-y-3">
          <div className="text-xs font-bold text-indigo-700 uppercase tracking-widest">
            New Customer
          </div>

          <div className="grid gap-3 grid-cols-2">
            {[
              { key: "name", label: "Name *", placeholder: "Jane Smith" },
              { key: "company", label: "Company / Org", placeholder: "Company name" },
              { key: "email", label: "Email", placeholder: "jane@example.com", type: "email" },
              { key: "phone", label: "Phone", placeholder: "(775) 555-0000", type: "tel" },
              { key: "address", label: "Address", placeholder: "123 Main St" },
              { key: "notes", label: "Notes", placeholder: "Terms, preferences…" },
              { key: "tax_id", label: "Tax ID", placeholder: "12-3456789" },
            ].map((f) => (
              <div key={f.key}>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                  {f.label}
                </label>
                <input
                  type={f.type || "text"}
                  value={form[f.key]}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  placeholder={f.placeholder}
                  className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="tax_exempt_new"
              checked={form.tax_exempt}
              onChange={(e) => setForm({ ...form, tax_exempt: e.target.checked })}
              className="w-4 h-4 accent-indigo-600"
            />
            <label htmlFor="tax_exempt_new" className="text-sm font-semibold text-slate-600">
              Tax Exempt
            </label>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600 uppercase tracking-widest">Default Payment Terms</label>
            <div className="flex items-center gap-3 text-sm">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="payment_terms_new"
                  checked={Number(form.default_deposit_pct) === 0}
                  onChange={() => setForm({ ...form, default_deposit_pct: 0 })}
                  className="accent-indigo-600"
                />
                Pay in full
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="payment_terms_new"
                  checked={Number(form.default_deposit_pct) > 0}
                  onChange={() => setForm({ ...form, default_deposit_pct: 50 })}
                  className="accent-indigo-600"
                />
                Deposit
              </label>
              {Number(form.default_deposit_pct) > 0 && (
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={form.default_deposit_pct}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      setForm({ ...form, default_deposit_pct: Number.isFinite(v) ? Math.max(1, Math.min(100, v)) : 50 });
                    }}
                    className="w-14 text-xs text-center border border-slate-200 dark:border-slate-700 rounded px-1.5 py-1"
                  />
                  <span className="text-slate-400">%</span>
                </div>
              )}
            </div>
          </div>

          <div className="text-xs text-slate-500 bg-white dark:bg-slate-900/70 border border-indigo-100 rounded-xl px-3 py-2">
            Add the customer first. Then open Edit Customer to upload artwork files that persist after reload.
          </div>

          <button
            onClick={handleAdd}
            disabled={addingCustomer || !form.name.trim()}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2 rounded-xl transition"
          >
            {addingCustomer ? "Adding…" : "Add Customer"}
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-center text-slate-300 py-10">Loading…</div>
      ) : customers.length === 0 ? (
        <EmptyState type="customers" onAction={() => { setForm(emptyCustomerForm); setShowForm(true); }} />
      ) : (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => {
            const qbCustStats = c.qb_customer_id ? qbStats[c.qb_customer_id] : null;
            const orderCount = qbCustStats?.orders || 0;
            const spent = qbCustStats?.collected || 0;

            const artCount = (artworkByCustomer[c.id] || []).length;

            return (
              <div
                key={c.id}
                className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm p-5 hover:shadow-md transition-shadow"
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-100 to-indigo-200 text-indigo-700 font-bold text-sm flex items-center justify-center flex-shrink-0">
                    {(c.company || c.name || "").split(" ").map((w) => w[0]).filter(Boolean).slice(0, 2).join("")}
                  </div>
                  <div>
                    <div className="font-bold text-slate-800 dark:text-slate-200 text-sm">{c.company || c.name}</div>
                    {c.company && c.name && <div className="text-xs text-slate-400">{c.name}</div>}
                  </div>
                </div>

                <div className="text-xs text-slate-500 space-y-1.5 mb-4">
                  {c.email && (
                    <div className="flex items-center gap-2">
                      <Icon name="mail" className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      {c.email}
                    </div>
                  )}
                  {c.phone && (
                    <div className="flex items-center gap-2">
                      <Icon name="phone" className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      {c.phone}
                    </div>
                  )}
                  {c.address && (
                    <div className="flex items-center gap-2">
                      <Icon
                        name="location"
                        className="w-3.5 h-3.5 text-slate-400 flex-shrink-0"
                      />
                      {c.address}
                    </div>
                  )}
                </div>

                {c.notes && (
                  <div className="text-xs text-amber-700 bg-amber-50 rounded-lg px-2.5 py-1.5 border border-amber-100 mb-3">
                    {c.notes}
                  </div>
                )}

                <div className="mb-3 text-xs text-slate-500 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2">
                  Artwork files: <span className="font-bold text-slate-700">{artCount}</span>
                </div>

                <div className="flex gap-3 border-t border-slate-100 dark:border-slate-700 pt-3 items-center">
                  <div className={`text-center flex-1 ${orderCount > 0 ? "cursor-pointer hover:bg-indigo-50 dark:hover:bg-slate-800 rounded-lg py-1 transition" : ""}`}
                    onClick={() => {
                      if (orderCount > 0) navigate(`/Invoices?customer=${encodeURIComponent(c.company || c.name)}`);
                    }}>
                    <div className={`text-lg font-bold ${orderCount > 0 ? "text-indigo-600" : "text-slate-800 dark:text-slate-200"}`}>{orderCount}</div>
                    <div className="text-xs text-slate-400">invoices</div>
                  </div>

                  <div className="text-center flex-1">
                    <div className="text-lg font-bold text-emerald-600">{fmtMoney(spent)}</div>
                    <div className="text-xs text-slate-400">collected</div>
                  </div>

                  {c.tax_exempt && (
                    <span className="text-xs font-semibold text-purple-600 bg-purple-50 border border-purple-100 px-2 py-0.5 rounded-full">
                      Tax Exempt
                    </span>
                  )}

                  <button
                    onClick={() => {
                      setEditing({ ...c });
                      setConfirmDelete(false);
                      setArtworkNote("");
                      setArtworkColorCount("");
                    }}
                    className="text-xs text-slate-400 hover:text-slate-600 border border-slate-200 dark:border-slate-700 hover:border-slate-300 px-2.5 py-1 rounded-lg transition"
                  >
                    Edit
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => {
            setEditing(null);
            setConfirmDelete(false);
            setArtworkNote("");
            setArtworkColorCount("");
          }}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-4xl p-6 space-y-5 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">Edit Customer</h3>
              <button
                onClick={() => {
                  setEditing(null);
                  setConfirmDelete(false);
                  setArtworkNote("");
                  setArtworkColorCount("");
                }}
                className="text-slate-400 hover:text-slate-600 text-lg"
              >
                ✕
              </button>
            </div>

            <div className="grid gap-3 grid-cols-2">
              {[
                { key: "name", label: "Name *", placeholder: "Jane Smith" },
                { key: "company", label: "Company / Org", placeholder: "Company name" },
                { key: "email", label: "Email", placeholder: "jane@example.com" },
                { key: "phone", label: "Phone", placeholder: "(775) 555-0000" },
                { key: "address", label: "Address", placeholder: "123 Main St" },
                { key: "notes", label: "Notes", placeholder: "Terms, preferences…" },
                { key: "tax_id", label: "Tax ID", placeholder: "12-3456789" },
              ].map((f) => (
                <div key={f.key}>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                    {f.label}
                  </label>
                  <input
                    value={editing[f.key] || ""}
                    onChange={(e) => setEditing({ ...editing, [f.key]: e.target.value })}
                    placeholder={f.placeholder}
                    className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  />
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="tax_exempt_edit"
                checked={!!editing.tax_exempt}
                onChange={(e) => setEditing({ ...editing, tax_exempt: e.target.checked })}
                className="w-4 h-4 accent-indigo-600"
              />
              <label htmlFor="tax_exempt_edit" className="text-sm font-semibold text-slate-600">
                Tax Exempt
              </label>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-widest">Default Payment Terms</label>
              <div className="flex items-center gap-3 text-sm">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="payment_terms_edit"
                    checked={Number(editing.default_deposit_pct || 0) === 0}
                    onChange={() => setEditing({ ...editing, default_deposit_pct: 0 })}
                    className="accent-indigo-600"
                  />
                  Pay in full
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="payment_terms_edit"
                    checked={Number(editing.default_deposit_pct || 0) > 0}
                    onChange={() => setEditing({ ...editing, default_deposit_pct: 50 })}
                    className="accent-indigo-600"
                  />
                  Deposit
                </label>
                {Number(editing.default_deposit_pct || 0) > 0 && (
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={editing.default_deposit_pct}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        setEditing({ ...editing, default_deposit_pct: Number.isFinite(v) ? Math.max(1, Math.min(100, v)) : 50 });
                      }}
                      className="w-14 text-xs text-center border border-slate-200 dark:border-slate-700 rounded px-1.5 py-1"
                    />
                    <span className="text-slate-400">%</span>
                  </div>
                )}
              </div>
            </div>

            {/* Saved Imprints Editor */}
            <div className="border border-slate-200 dark:border-slate-700 rounded-2xl p-4 space-y-3">
              <div className="flex justify-between items-center">
                <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">Saved Imprints</div>
                <button
                  onClick={() => setEditing({
                    ...editing,
                    saved_imprints: [...(editing.saved_imprints || []), { title: "", location: "Front", width: "", height: "", colors: 1, technique: "Screen Print", pantones: "" }]
                  })}
                  className="text-xs font-semibold text-indigo-600 border border-indigo-200 px-2.5 py-1 rounded-lg hover:bg-indigo-50 transition"
                >
                  + Add Imprint
                </button>
              </div>

              {(editing.saved_imprints || []).length === 0 ? (
                <div className="text-sm text-slate-400 border border-dashed border-slate-200 dark:border-slate-700 rounded-xl p-4 text-center">
                  No saved imprints yet. They are added automatically when saving quotes.
                </div>
              ) : (
                <div className="space-y-2">
                  {(editing.saved_imprints || []).map((imp, i) => (
                    <div key={i} className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 space-y-2">
                      <div className="flex gap-2 flex-wrap">
                        <div className="flex-1 min-w-28">
                          <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-0.5">Title</label>
                          <input
                            value={imp.title || ""}
                            onChange={(e) => {
                              const updated = [...editing.saved_imprints];
                              updated[i] = { ...updated[i], title: e.target.value };
                              setEditing({ ...editing, saved_imprints: updated });
                            }}
                            placeholder="e.g. Front Logo"
                            className="w-full text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                          />
                        </div>
                        <div className="w-28">
                          <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-0.5">Location</label>
                          <select
                            value={imp.location || "Front"}
                            onChange={(e) => {
                              const updated = [...editing.saved_imprints];
                              updated[i] = { ...updated[i], location: e.target.value };
                              setEditing({ ...editing, saved_imprints: updated });
                            }}
                            className="w-full text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-900 focus:outline-none"
                          >
                            {["Front","Back","Left Chest","Right Chest","Left Sleeve","Right Sleeve","Pocket","Hood","Other"].map(l => <option key={l}>{l}</option>)}
                          </select>
                        </div>
                        <div className="w-16">
                          <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-0.5">Width</label>
                          <input
                            value={imp.width || ""}
                            onChange={(e) => {
                              const updated = [...editing.saved_imprints];
                              updated[i] = { ...updated[i], width: e.target.value };
                              setEditing({ ...editing, saved_imprints: updated });
                            }}
                            placeholder='4"'
                            className="w-full text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                          />
                        </div>
                        <div className="w-16">
                          <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-0.5">Height</label>
                          <input
                            value={imp.height || ""}
                            onChange={(e) => {
                              const updated = [...editing.saved_imprints];
                              updated[i] = { ...updated[i], height: e.target.value };
                              setEditing({ ...editing, saved_imprints: updated });
                            }}
                            placeholder='2"'
                            className="w-full text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                          />
                        </div>
                        <div className="w-16">
                          <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-0.5">Colors</label>
                          <input
                            type="number"
                            min="1"
                            max="8"
                            value={imp.colors || 1}
                            onChange={(e) => {
                              const updated = [...editing.saved_imprints];
                              updated[i] = { ...updated[i], colors: parseInt(e.target.value) || 1 };
                              setEditing({ ...editing, saved_imprints: updated });
                            }}
                            className="w-full text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                          />
                        </div>
                        <div className="w-28">
                          <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-0.5">Technique</label>
                          <select
                            value={imp.technique || "Screen Print"}
                            onChange={(e) => {
                              const updated = [...editing.saved_imprints];
                              updated[i] = { ...updated[i], technique: e.target.value };
                              setEditing({ ...editing, saved_imprints: updated });
                            }}
                            className="w-full text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-900 focus:outline-none"
                          >
                            {["Screen Print","DTG","Embroidery","DTF","Heat Transfer","Sublimation"].map(t => <option key={t}>{t}</option>)}
                          </select>
                        </div>
                        <button
                          onClick={() => {
                            const updated = (editing.saved_imprints || []).filter((_, idx) => idx !== i);
                            setEditing({ ...editing, saved_imprints: updated });
                          }}
                          className="text-slate-300 hover:text-red-400 text-xs mt-4 transition"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border border-slate-200 dark:border-slate-700 rounded-2xl p-4 space-y-4">
              <div>
                <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                  Customer Artwork Library
                </div>
                <div className="text-sm text-slate-400 mt-1">
                  These files are stored in BrokerDocument so they survive page reloads.
                </div>
              </div>

              <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 space-y-3">
                <input
                  type="text"
                  value={artworkNote}
                  onChange={(e) => setArtworkNote(e.target.value)}
                  placeholder="Optional note (example: Front chest logo)"
                  className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />

                <input
                  type="number"
                  min="1"
                  max="12"
                  value={artworkColorCount}
                  onChange={(e) => setArtworkColorCount(e.target.value)}
                  placeholder="Production color count (example: 3)"
                  className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />

                <div className="text-xs text-slate-500">
                  Set the production color count once here so quotes can auto-fill imprint pricing later.
                </div>

                <label
                  className={`flex items-center gap-2 cursor-pointer w-fit text-sm font-semibold px-4 py-2 rounded-xl border transition ${
                    uploadingArtwork
                      ? "bg-slate-100 text-slate-400 border-slate-200 dark:border-slate-700"
                      : "bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700"
                  }`}
                >
                  {uploadingArtwork ? "Uploading…" : "Choose File & Upload Artwork"}
                  <input
                    type="file"
                    className="hidden"
                    onChange={handleArtworkUpload}
                    disabled={uploadingArtwork}
                  />
                </label>
              </div>

              {currentEditingArtwork.length === 0 ? (
                <div className="text-sm text-slate-400 border border-dashed border-slate-200 dark:border-slate-700 rounded-xl p-6 text-center">
                  No artwork saved for this client yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {currentEditingArtwork.map((art) => (
                    <div
                      key={art.id}
                      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-800 dark:text-slate-200 text-sm truncate">
                          {art.name}
                        </div>
                        {art.note && (
                          <div className="text-xs text-slate-400 truncate">{art.note}</div>
                        )}
                        <div className="flex flex-wrap gap-2 mt-1">
                          {art.colors ? (
                            <span className="text-[11px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full">
                              {art.colors} color{String(art.colors) === "1" ? "" : "s"}
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-400">
                              No color count set
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-300 mt-0.5">
                          {art.uploaded_at
                            ? new Date(art.uploaded_at).toLocaleDateString()
                            : ""}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <a
                          href={art.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-semibold text-indigo-600 border border-indigo-200 px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition"
                        >
                          Open
                        </a>
                        <button
                          onClick={() => handleRemoveArtwork(art.id)}
                          className="text-xs font-semibold text-red-500 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-50 transition"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {confirmDelete ? (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
                <p className="text-sm font-semibold text-red-700">
                  Are you sure you want to delete this client? This cannot be undone.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleDelete(editing.id)}
                    className="bg-red-500 hover:bg-red-600 text-white text-sm font-semibold px-4 py-2 rounded-xl transition"
                  >
                    Yes, Delete
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="text-slate-600 border border-slate-200 dark:border-slate-700 text-sm font-semibold px-4 py-2 rounded-xl hover:bg-slate-50 dark:bg-slate-800 transition"
                  >
                    No, Go Back
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2 pt-2 items-center">
                <button
                  onClick={handleSaveEdit}
                  disabled={editSaving}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-sm font-semibold px-4 py-2 rounded-xl transition"
                >
                  {editSaving ? "Saving…" : "Save Changes"}
                </button>
                {editSaved && (
                  <span className="text-sm font-semibold text-emerald-600 flex items-center gap-1">
                    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 011.4-1.4L8.5 12l6.8-6.7a1 1 0 011.4 0z" clipRule="evenodd" /></svg>
                    Saved
                  </span>
                )}
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="ml-auto text-red-400 border border-red-200 text-sm font-semibold px-4 py-2 rounded-xl hover:bg-red-50 transition"
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {showMerge && (
        <MergeDuplicatesModal
          customers={customers}
          user={user}
          onMerge={async (primary, duplicates) => {
            // Merge reassigns quotes/orders/invoices then deletes the dup
            // row — same shop-owner-only gate as handleDelete. RLS blocks
            // cross-shop writes; this is the in-app guard.
            if (!canDelete()) return;
            let totalMoved = 0;
            for (const dup of duplicates) {
              // Also match by customer_name since some records might not have customer_id
              const [quotesById, ordersByName, invoicesById] = await Promise.all([
                base44.entities.Quote.filter({ customer_id: dup.id }),
                base44.entities.Order.filter({ customer_name: dup.name }),
                base44.entities.Invoice.filter({ customer_id: dup.id }),
              ]);
              // Also search quotes/invoices by name for records without customer_id
              const [quotesByName, invoicesByName] = await Promise.all([
                base44.entities.Quote.filter({ customer_name: dup.name }),
                base44.entities.Invoice.filter({ customer_name: dup.name }),
              ]);
              // Deduplicate by id
              const allQuotes = [...new Map([...quotesById, ...quotesByName].map(q => [q.id, q])).values()];
              const allInvoices = [...new Map([...invoicesById, ...invoicesByName].map(i => [i.id, i])).values()];

              for (const q of allQuotes) {
                try { await base44.entities.Quote.update(q.id, { customer_id: primary.id, customer_name: primary.name }); totalMoved++; } catch (e) { console.error("Quote reassign failed:", e); }
              }
              for (const o of ordersByName) {
                try { await base44.entities.Order.update(o.id, { customer_id: primary.id, customer_name: primary.name }); totalMoved++; } catch (e) { console.error("Order reassign failed:", e); }
              }
              for (const inv of allInvoices) {
                try { await base44.entities.Invoice.update(inv.id, { customer_id: primary.id, customer_name: primary.name }); totalMoved++; } catch (e) { console.error("Invoice reassign failed:", e); }
              }

              // Merge any useful data from duplicate into primary
              const mergeFields = {};
              if (!primary.email && dup.email) mergeFields.email = dup.email;
              if (!primary.phone && dup.phone) mergeFields.phone = dup.phone;
              if (!primary.address && dup.address) mergeFields.address = dup.address;
              if (!primary.company && dup.company) mergeFields.company = dup.company;
              if (!primary.qb_customer_id && dup.qb_customer_id) mergeFields.qb_customer_id = dup.qb_customer_id;
              if (Object.keys(mergeFields).length) {
                try { await base44.entities.Customer.update(primary.id, mergeFields); Object.assign(primary, mergeFields); } catch {}
              }

              await base44.entities.Customer.delete(dup.id);
            }
            alert(`Merged ${duplicates.length} duplicate(s) into ${primary.name}. ${totalMoved} records reassigned.`);
            setCustomers(prev => prev.filter(c => !duplicates.some(d => d.id === c.id)));
          }}
          onClose={() => setShowMerge(false)}
          supabaseFuncUrl={SUPABASE_FUNC_URL}
        />
      )}
    </div>
  );
}

function MergeDuplicatesModal({ customers, user, onMerge, onClose, supabaseFuncUrl }) {
  const [merging, setMerging] = useState(false);
  const [merged, setMerged] = useState([]);

  const duplicateGroups = useMemo(() => {
    const groups = [];
    const used = new Set();
    const normalize = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

    for (let i = 0; i < customers.length; i++) {
      if (used.has(customers[i].id)) continue;
      const group = [customers[i]];
      const companyKey = normalize(customers[i].company);
      const emailKey = (customers[i].email || "").toLowerCase().trim();

      for (let j = i + 1; j < customers.length; j++) {
        if (used.has(customers[j].id)) continue;
        const c2 = normalize(customers[j].company);
        const e2 = (customers[j].email || "").toLowerCase().trim();

        const companyMatch = companyKey && c2 && (companyKey === c2 || companyKey.includes(c2) || c2.includes(companyKey));
        const emailMatch = emailKey && e2 && emailKey === e2;

        if (companyMatch || emailMatch) {
          group.push(customers[j]);
          used.add(customers[j].id);
        }
      }
      if (group.length > 1) {
        used.add(customers[i].id);
        groups.push(group);
      }
    }
    return groups;
  }, [customers]);

  const [selected, setSelected] = useState(() => {
    const s = {};
    duplicateGroups.forEach((g, gi) => { s[gi] = 0; });
    return s;
  });

  async function handleMerge(groupIdx) {
    const group = duplicateGroups[groupIdx];
    const primaryIdx = selected[groupIdx] || 0;
    const primary = group[primaryIdx];
    const duplicates = group.filter((_, i) => i !== primaryIdx);
    setMerging(true);
    try {
      await onMerge(primary, duplicates);
      setMerged(prev => [...prev, groupIdx]);

      // Deactivate duplicates in QB
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          for (const dup of duplicates) {
            if (!dup.qb_customer_id) continue;
            await fetch(`${supabaseFuncUrl}/functions/v1/qbSync`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "deactivateCustomer",
                accessToken: session.access_token,
                customerId: dup.qb_customer_id,
              }),
            });
          }
        }
      } catch {}
    } catch (err) {
      alert("Merge failed: " + err.message);
    } finally {
      setMerging(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" onMouseDown={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <GitMerge className="w-5 h-5 text-indigo-600" /> Merge Duplicate Customers
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {duplicateGroups.length} potential duplicate group{duplicateGroups.length !== 1 ? "s" : ""} found
          </p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {duplicateGroups.length === 0 && (
            <div className="px-6 py-12 text-center text-sm text-slate-400">No duplicates detected.</div>
          )}

          {duplicateGroups.map((group, gi) => {
            if (merged.includes(gi)) return (
              <div key={gi} className="px-6 py-4 border-b border-slate-50 bg-emerald-50 flex items-center gap-2 text-sm text-emerald-700 font-semibold">
                <Check className="w-4 h-4" /> Merged
              </div>
            );
            return (
              <div key={gi} className="px-6 py-4 border-b border-slate-100">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                  Group {gi + 1} — {group.length} records
                </div>
                <div className="space-y-2">
                  {group.map((c, ci) => (
                    <label key={c.id}
                      className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition ${selected[gi] === ci ? "border-indigo-400 bg-indigo-50" : "border-slate-100 hover:border-slate-200"}`}>
                      <input type="radio" name={`group-${gi}`} checked={selected[gi] === ci}
                        onChange={() => setSelected(prev => ({ ...prev, [gi]: ci }))}
                        className="accent-indigo-600" />
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm text-slate-800">{c.name}</div>
                        <div className="text-xs text-slate-400">
                          {[c.company, c.email, c.phone].filter(Boolean).join(" · ") || "No details"}
                          {c.qb_customer_id && <span className="ml-2 text-emerald-600 font-semibold">QB linked</span>}
                        </div>
                      </div>
                      {selected[gi] === ci && <span className="text-xs font-semibold text-indigo-600 bg-indigo-100 px-2 py-0.5 rounded-full">Keep</span>}
                    </label>
                  ))}
                </div>
                <button onClick={() => handleMerge(gi)} disabled={merging}
                  className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-lg transition disabled:opacity-50">
                  {merging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitMerge className="w-3.5 h-3.5" />}
                  Merge into selected
                </button>
              </div>
            );
          })}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
          <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700">Close</button>
          <div className="text-xs text-slate-400">Select the record to keep, others will be merged into it</div>
        </div>
      </div>
    </div>
  );
}