import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { base44, supabase } from "@/api/supabaseClient";
import { CardGridSkeleton } from "@/components/shared/Skeletons";
import { uploadFile } from "@/lib/uploadFile";
import { fmtMoney } from "../components/shared/pricing";
import ModalBackdrop from "../components/shared/ModalBackdrop";
import Icon from "../components/shared/Icon";
import AdvancedFilters from "../components/AdvancedFilters";
import { syncCustomerToQB } from "@/lib/qbCustomerSync";
import { buildAdditiveMergePatch, describeMergeFor } from "@/lib/customers/mergeCustomerData";
import { aggregateInvoiceStatsByCustomer } from "@/lib/customers/invoiceStats";
import { findReconcileNeeded, partitionReconcilePairs, planReconcileActions } from "@/lib/customers/qbReconcileDetect";
import { Loader2, GitMerge, Check, AlertTriangle, RefreshCw } from "lucide-react";
import EmptyState from "../components/shared/EmptyState";
import {
  countCustomerDependents,
  formatDependentsMessage,
} from "@/lib/customers/countCustomerDependents";
import { useBillingGate } from "@/lib/billing-gate";
import { notify } from "@/lib/notify";
import { isValidEmail } from "@/lib/email";

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
  const [invoiceStats, setInvoiceStats] = useState({});
  const [showMerge, setShowMerge] = useState(false);
  // Auto-detected post-QB-merge orphans. Fires once after the customer
  // list loads — when the shop has merged customers in QuickBooks but
  // InkTracker's local table still has two records. Banner UI offers
  // a one-click finish for the actionable cases.
  const [reconcileNeeded, setReconcileNeeded] = useState([]);
  const [showReconcileReview, setShowReconcileReview] = useState(false);
  const didDetectReconcileRef = useRef(false);

  useEffect(() => {
    async function loadData() {
      try {
        const currentUser = await base44.auth.me();
        setUser(currentUser);

        const [c, docs, invs] = await Promise.all([
          base44.entities.Customer.filter({ shop_owner: currentUser.email }),
          base44.entities.BrokerDocument.filter(
            { shop_owner: currentUser.email },
            "-created_date",
            500
          ),
          base44.entities.Invoice.filter({ shop_owner: currentUser.email }),
        ]);
        // Profile-card stats come from OUR invoices table so the card
        // always matches the Invoices tab. Previously QB-sourced, which
        // undercounted customers with pre-QB-integration history (the
        // Beloved's "2 invoices / $3,550 vs 4 / $8,210" mismatch).
        setInvoiceStats(aggregateInvoiceStatsByCustomer(invs));

        setCustomers([...c].sort((a, b) => (a.company || a.name || "").localeCompare(b.company || b.name || "", undefined, { sensitivity: 'base' })));
        setArtworkDocs(
          (docs || []).filter((doc) => String(doc.broker_id || "").startsWith("client:"))
        );

      } catch (error) {
        notify.error("Couldn't load customers", error);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  // Auto-detect QB-side merges that still need finishing in InkTracker.
  // Fires ONCE after the customer list loads — one batched QB call
  // returns only the inactive customers whose IDs we're linked to,
  // and the helper pairs them with their survivor (when local). The
  // ref-guard prevents this from re-running on every customer edit.
  useEffect(() => {
    if (didDetectReconcileRef.current) return;
    if (loading) return;
    if (!customers || customers.length === 0) return;
    const qbIds = customers
      .map((c) => c.qb_customer_id)
      .filter((id) => id != null && String(id) !== "");
    if (qbIds.length === 0) return;
    didDetectReconcileRef.current = true;

    (async () => {
      try {
        const { data, error } = await base44.functions.invoke("qbSync", {
          action: "scanInactiveCustomers",
          customerIds: qbIds,
        });
        if (error || !data?.inactive) return;
        const pairs = findReconcileNeeded(customers, data.inactive);
        if (pairs.length === 0) return;

        // Auto-follow QB-side merges (policy set by Joe 2026-06-11):
        // a merge done IN QuickBooks is a decision the shop already
        // made — InkTracker mirrors it automatically and notifies
        // after the fact. Only SUSPECTED duplicates (the Merge
        // Duplicates flow) still ask first. Non-owners fall back to
        // the review banner since the merge path is owner-gated.
        const isOwner = user?.role === "admin" || user?.role === "shop";
        if (!isOwner) {
          setReconcileNeeded(pairs);
          return;
        }

        const { merges, repoints, review } = planReconcileActions(pairs);

        // Repoint: QB survivor isn't in InkTracker — the local record
        // simply becomes the survivor's representative. Pure mapping
        // update, nothing moves, nothing deleted. (The manual Choo
        // Choo's fix from 2026-06-10, made automatic.)
        for (const p of repoints) {
          try {
            await base44.entities.Customer.update(p.inactive.id, { qb_customer_id: p.mergedIntoId });
            setCustomers((prev) =>
              prev.map((c) => (c.id === p.inactive.id ? { ...c, qb_customer_id: p.mergedIntoId } : c))
            );
            notify.success(
              "Followed a QuickBooks merge",
              `${p.inactive.company || p.inactive.name} now points at its surviving QuickBooks customer — invoice links will stay correct on the next sync.`
            );
          } catch (err) {
            notify.error("Couldn't follow a QuickBooks merge", err);
          }
        }

        // Merge: both sides exist locally — finish with the same safe
        // engine the banner used (everything moves before anything is
        // deleted; aborts on any failure). runCustomerMerge notifies
        // with the moved-record count.
        for (const p of merges) {
          await runCustomerMerge(p.survivor, [p.inactive]);
        }

        // Deactivated-but-not-merged (no MergedIntoId): intent unknown,
        // surface for the shop to decide.
        if (review.length > 0) setReconcileNeeded(review);
      } catch (err) {
        // Quiet on failure — auto-detect is a nice-to-have. The
        // manual Merge Duplicates → Reconcile path still works.
        console.warn("[qb reconcile detect] skipped:", err?.message);
      }
    })();
  }, [customers, loading]);

  // Hoisted merge handler. Reused by MergeDuplicatesModal (operator-
  // initiated) and QbReconcileReviewModal (auto-detected QB pairs).
  // Same additive merge contract either way — buildAdditiveMergePatch
  // fills blanks on the primary, appends notes with attribution,
  // unions saved_imprints. Child quote/order/invoice rows reassign
  // before the duplicate row is deleted; if any reassign fails the
  // duplicate stays in place to avoid orphans.
  async function runCustomerMerge(primary, duplicates) {
    if (!canDelete()) return;
    let totalMoved = 0;
    const fullyMergedIds = [];
    const partiallyFailed = [];

    for (const dup of duplicates) {
      const [quotesById, ordersByName, invoicesById, quotesByName, invoicesByName] = await Promise.all([
        base44.entities.Quote.filter({ customer_id: dup.id }),
        base44.entities.Order.filter({ customer_name: dup.name }),
        base44.entities.Invoice.filter({ customer_id: dup.id }),
        base44.entities.Quote.filter({ customer_name: dup.name }),
        base44.entities.Invoice.filter({ customer_name: dup.name }),
      ]);
      const allQuotes = [...new Map([...quotesById, ...quotesByName].map((q) => [q.id, q])).values()];
      const allInvoices = [...new Map([...invoicesById, ...invoicesByName].map((i) => [i.id, i])).values()];

      let dupReassignsOk = true;
      for (const q of allQuotes) {
        try { await base44.entities.Quote.update(q.id, { customer_id: primary.id, customer_name: primary.name }); totalMoved++; }
        catch (e) { console.error("Quote reassign failed:", e); dupReassignsOk = false; }
      }
      for (const o of ordersByName) {
        try { await base44.entities.Order.update(o.id, { customer_id: primary.id, customer_name: primary.name }); totalMoved++; }
        catch (e) { console.error("Order reassign failed:", e); dupReassignsOk = false; }
      }
      for (const inv of allInvoices) {
        try { await base44.entities.Invoice.update(inv.id, { customer_id: primary.id, customer_name: primary.name }); totalMoved++; }
        catch (e) { console.error("Invoice reassign failed:", e); dupReassignsOk = false; }
      }

      const mergeFields = buildAdditiveMergePatch(primary, dup);
      if (mergeFields) {
        try {
          const updated = await base44.entities.Customer.update(primary.id, mergeFields);
          primary = updated || { ...primary, ...mergeFields };
        } catch {}
      }

      if (dupReassignsOk) {
        try {
          await base44.entities.Customer.delete(dup.id);
          fullyMergedIds.push(dup.id);
        } catch (e) {
          console.error("Duplicate delete failed:", e);
          partiallyFailed.push(dup);
        }
      } else {
        partiallyFailed.push(dup);
      }
    }

    const failedNames = partiallyFailed.map((d) => d.name).join(", ");
    if (partiallyFailed.length > 0) {
      notify.error(
        `Merged ${fullyMergedIds.length} of ${duplicates.length}`,
        `Couldn't finish merging ${partiallyFailed.length} duplicate(s) (${failedNames}) — some child records didn't reassign and were left in place to avoid orphans. ${totalMoved} record(s) moved overall.`,
      );
    } else {
      notify.success(`Merged ${duplicates.length} duplicate(s) into ${primary.name}`, `${totalMoved} records reassigned.`);
    }
    setCustomers((prev) => prev.filter((c) => !fullyMergedIds.includes(c.id)));
  }

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
      notify.error("Couldn't verify customer's history", err);
      return;
    }

    const blockMessage = formatDependentsMessage(counts, customer.name || "this customer");
    if (blockMessage) {
      notify.error("Can't delete customer", blockMessage);
      return;
    }

    try {
      await base44.entities.Customer.delete(id);
      setCustomers((prev) => prev.filter((c) => c.id !== id));
      setConfirmDelete(false);
      setEditing(null);
    } catch (err) {
      notify.error("Couldn't delete customer", err);
    }
  }

  async function handleAdd() {
    if (!form.name.trim() || !user?.email) return;
    if (addingCustomer) return; // re-entry guard: double-click would create dupes
    if (billingGate("add new customers")) return;
    // Email is optional, but if present it must look like an email.
    // Junk in this field (names, phone numbers) breaks the QB sync
    // downstream — fix-up at save time so bad data never lands.
    if (form.email && !isValidEmail(form.email)) {
      notify.error("Invalid email", "Enter a valid email address or leave it blank.");
      return;
    }
    setAddingCustomer(true);

    let created;
    try {
      created = await base44.entities.Customer.create({
        ...form,
        shop_owner: user.email,
        orders: 0,
      });
    } catch (err) {
      notify.error("Couldn't add customer", err);
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
    if (editing?.email && !isValidEmail(editing.email)) {
      notify.error("Invalid email", "Enter a valid email address or leave it blank.");
      return;
    }
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
      notify.error("Couldn't save customer", err);
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
      notify.error("Artwork upload failed", error);
    } finally {
      setUploadingArtwork(false);
    }
  }

  async function handleRemoveArtwork(artworkId) {
    if (!editing) return;
    if (!window.confirm("Remove this artwork from the client library?")) return;
    try {
      await base44.entities.BrokerDocument.delete(artworkId);
      setArtworkDocs((prev) => prev.filter((doc) => doc.id !== artworkId));
    } catch (err) {
      notify.error("Couldn't remove artwork", err);
    }
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
            className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-600 text-sm font-semibold px-4 py-2.5 rounded-xl transition hover:border-teal-300">
            <GitMerge className="w-4 h-4" /> Merge Duplicates
          </button>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition shadow-sm"
          >
            {showForm ? "✕ Cancel" : "+ Add Customer"}
          </button>
        </div>
      </div>

      {/* Auto-detect banner: surfaces post-QB-merge orphans that need
          finishing in InkTracker. Click → opens review modal that
          uses the same additive merge handler. Hidden when no
          actionable pairs OR when the banner has been dismissed. */}
      {reconcileNeeded.length > 0 && (() => {
        const { actionable, survivorMissing } = partitionReconcilePairs(reconcileNeeded);
        return (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center justify-between gap-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
              <div className="text-xs">
                <div className="font-semibold text-amber-800">
                  {reconcileNeeded.length} QuickBooks merge{reconcileNeeded.length === 1 ? "" : "s"} need finishing in InkTracker
                </div>
                <div className="text-amber-700 mt-0.5">
                  You merged customers in QuickBooks but their local InkTracker records still split quotes, notes, and saved imprints.
                  {actionable.length > 0 && ` ${actionable.length} can be finished with one click.`}
                  {survivorMissing.length > 0 && ` ${survivorMissing.length} need the survivor pulled from QB first.`}
                </div>
              </div>
            </div>
            <button
              onClick={() => setShowReconcileReview(true)}
              className="text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-lg whitespace-nowrap shrink-0"
            >
              Review →
            </button>
          </div>
        );
      })()}

      <AdvancedFilters
        filters={filters}
        onFilterChange={handleFilterChange}
        filterOptions={filterOptions}
      />

      {showForm && (
        <div className="bg-teal-50 border border-teal-200 rounded-2xl p-5 space-y-3">
          <div className="text-xs font-bold text-teal-700 uppercase tracking-widest">
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
                  className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-300"
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
              className="w-4 h-4 accent-teal-600"
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
                  className="accent-teal-600"
                />
                Pay in full
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="payment_terms_new"
                  checked={Number(form.default_deposit_pct) > 0}
                  onChange={() => setForm({ ...form, default_deposit_pct: 50 })}
                  className="accent-teal-600"
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

          <div className="text-xs text-slate-500 bg-white dark:bg-slate-900/70 border border-teal-100 rounded-xl px-3 py-2">
            Add the customer first. Then open Edit Customer to upload artwork files that persist after reload.
          </div>

          <button
            onClick={handleAdd}
            disabled={addingCustomer || !form.name.trim()}
            className="bg-teal-600 hover:bg-teal-700 disabled:bg-teal-300 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2 rounded-xl transition"
          >
            {addingCustomer ? "Adding…" : "Add Customer"}
          </button>
        </div>
      )}

      {loading ? (
        <CardGridSkeleton />
      ) : customers.length === 0 ? (
        <EmptyState type="customers" onAction={() => { setForm(emptyCustomerForm); setShowForm(true); }} />
      ) : (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => {
            const custStats = invoiceStats[c.id] || null;
            const orderCount = custStats?.count || 0;
            const spent = custStats?.collected || 0;

            const artCount = (artworkByCustomer[c.id] || []).length;

            return (
              <div
                key={c.id}
                className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm p-5 hover:shadow-md transition-shadow"
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-teal-100 to-teal-200 text-teal-700 font-bold text-sm flex items-center justify-center flex-shrink-0">
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
                  <div className={`text-center flex-1 ${orderCount > 0 ? "cursor-pointer hover:bg-teal-50 dark:hover:bg-slate-800 rounded-lg py-1 transition" : ""}`}
                    onClick={() => {
                      if (orderCount > 0) navigate(`/Invoices?customer=${encodeURIComponent(c.company || c.name)}`);
                    }}>
                    <div className={`text-lg font-bold ${orderCount > 0 ? "text-teal-600" : "text-slate-800 dark:text-slate-200"}`}>{orderCount}</div>
                    <div className="text-xs text-slate-400">invoices</div>
                  </div>

                  <div className="text-center flex-1">
                    <div className="text-lg font-bold text-emerald-600">{fmtMoney(spent)}</div>
                    <div className="text-xs text-slate-400">collected</div>
                  </div>

                  {c.tax_exempt && (
                    <span className="text-xs font-semibold text-teal-600 bg-teal-50 border border-teal-100 px-2 py-0.5 rounded-full">
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
        <ModalBackdrop
          onClose={() => {
            setEditing(null);
            setConfirmDelete(false);
            setArtworkNote("");
            setArtworkColorCount("");
          }}
          z="z-50"
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
                    className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-300"
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
                className="w-4 h-4 accent-teal-600"
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
                    className="accent-teal-600"
                  />
                  Pay in full
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="payment_terms_edit"
                    checked={Number(editing.default_deposit_pct || 0) > 0}
                    onChange={() => setEditing({ ...editing, default_deposit_pct: 50 })}
                    className="accent-teal-600"
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
                  className="text-xs font-semibold text-teal-600 border border-teal-200 px-2.5 py-1 rounded-lg hover:bg-teal-50 transition"
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
                            className="w-full text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-300"
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
                            className="w-full text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-300"
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
                            className="w-full text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-300"
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
                            className="w-full text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-300"
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
                  className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-400"
                />

                <input
                  type="number"
                  min="1"
                  max="12"
                  value={artworkColorCount}
                  onChange={(e) => setArtworkColorCount(e.target.value)}
                  placeholder="Production color count (example: 3)"
                  className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-400"
                />

                <div className="text-xs text-slate-500">
                  Set the production color count once here so quotes can auto-fill imprint pricing later.
                </div>

                <label
                  className={`flex items-center gap-2 cursor-pointer w-fit text-sm font-semibold px-4 py-2 rounded-xl border transition ${
                    uploadingArtwork
                      ? "bg-slate-100 text-slate-400 border-slate-200 dark:border-slate-700"
                      : "bg-teal-600 text-white border-teal-600 hover:bg-teal-700"
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
                            <span className="text-[11px] font-semibold text-teal-700 bg-teal-50 border border-teal-100 px-2 py-0.5 rounded-full">
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
                          className="text-xs font-semibold text-teal-600 border border-teal-200 px-3 py-1.5 rounded-lg hover:bg-teal-50 transition"
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
                  className="bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white text-sm font-semibold px-4 py-2 rounded-xl transition"
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
        </ModalBackdrop>
      )}

      {showMerge && (
        <MergeDuplicatesModal
          customers={customers}
          user={user}
          onMerge={runCustomerMerge}
          onClose={() => setShowMerge(false)}
          supabaseFuncUrl={SUPABASE_FUNC_URL}
        />
      )}

      {showReconcileReview && (
        <QbReconcileReviewModal
          pairs={reconcileNeeded}
          onMerge={runCustomerMerge}
          onClose={() => {
            setShowReconcileReview(false);
            // Recompute remaining pairs after a reconcile so the
            // banner count stays accurate.
            setReconcileNeeded((prev) => prev.filter((p) => customers.some((c) => c.id === p.inactive.id)));
          }}
        />
      )}
    </div>
  );
}

function MergeDuplicatesModal({ customers, user, onMerge, onClose, supabaseFuncUrl }) {
  const [merging, setMerging] = useState(false);
  const [merged, setMerged] = useState([]);
  // Confirm dialog state — single overlay shared across groups.
  const [confirm, setConfirm] = useState(null); // { gi, primary, duplicates, descriptions }
  // QB reconcile state, keyed by group index → { loading, results: [{id, status, ...}] }
  const [reconcile, setReconcile] = useState({});

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

  // Per-group QB status: how many customers in the group are linked
  // to a QuickBooks customer. Drives whether we surface a merge
  // button (≤1 linked = safe) or a "merge in QB first" panel (≥2
  // linked, because an InkTracker merge would leave an orphan QB
  // customer pointing at nothing).
  function groupQbStatus(group) {
    const linked = group.filter((c) => !!c.qb_customer_id);
    return {
      linkedCount: linked.length,
      multiLinked: linked.length >= 2,
      linked,
    };
  }

  async function runActualMerge(gi, primary, duplicates) {
    setMerging(true);
    try {
      await onMerge(primary, duplicates);
      setMerged(prev => [...prev, gi]);
    } catch (err) {
      notify.error("Merge failed", err);
    } finally {
      setMerging(false);
    }
  }

  // Called when the operator hits "Merge into selected" on a safe
  // (≤1 QB-linked) group. Builds a per-duplicate preview of what
  // will move using describeMergeFor, opens the confirm dialog.
  function handleMergeClick(groupIdx) {
    const group = duplicateGroups[groupIdx];
    const primaryIdx = selected[groupIdx] || 0;
    const primary = group[primaryIdx];
    const duplicates = group.filter((_, i) => i !== primaryIdx);
    const descriptions = duplicates.map((dup) => ({
      dup,
      items: describeMergeFor(primary, dup),
    }));
    setConfirm({ gi: groupIdx, primary, duplicates, descriptions });
  }

  // Read-only QB query for every linked customer in the group. Used
  // after the operator has merged them inside QuickBooks — we ping
  // each qb_customer_id to figure out which one is now Active=false
  // (the loser of the QB merge) so we can finish the InkTracker side
  // safely. No destructive QB write is ever attempted from here.
  async function handleReconcile(gi) {
    const group = duplicateGroups[gi];
    setReconcile(prev => ({ ...prev, [gi]: { loading: true, results: null, error: null } }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not signed in");
      const results = [];
      for (const c of group) {
        if (!c.qb_customer_id) {
          results.push({ id: c.id, name: c.name, qbStatus: "not_linked" });
          continue;
        }
        const { data, error } = await base44.functions.invoke("qbSync", {
          action: "lookupCustomerById",
          accessToken: session.access_token,
          customerId: c.qb_customer_id,
        });
        if (error) throw error;
        results.push({
          id: c.id,
          name: c.name,
          qbStatus: data?.status || "unknown",
          mergedIntoId: data?.mergedIntoId || null,
        });
      }
      setReconcile(prev => ({ ...prev, [gi]: { loading: false, results, error: null } }));
    } catch (err) {
      setReconcile(prev => ({ ...prev, [gi]: { loading: false, results: null, error: err.message || String(err) } }));
    }
  }

  // After reconcile, if exactly one customer is Active in QB and the
  // others are Inactive/notfound (i.e. QB merge was already done),
  // the operator can finish the InkTracker side. We pick the active
  // one as primary and merge everyone else into it.
  function handleReconcileMerge(gi) {
    const group = duplicateGroups[gi];
    const { results } = reconcile[gi] || {};
    if (!results) return;
    const activeIdx = group.findIndex((c) => {
      const r = results.find(rr => rr.id === c.id);
      return r?.qbStatus === "active";
    });
    if (activeIdx < 0) {
      notify.error("Can't reconcile", "Need exactly one Active QB customer in the group.");
      return;
    }
    const primary = group[activeIdx];
    const duplicates = group.filter((_, i) => i !== activeIdx);
    const descriptions = duplicates.map((dup) => ({
      dup,
      items: describeMergeFor(primary, dup),
    }));
    setConfirm({ gi, primary, duplicates, descriptions });
  }

  return (
    <ModalBackdrop onClose={onClose} z="z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <GitMerge className="w-5 h-5 text-teal-600" /> Customer Duplicates
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

            const qb = groupQbStatus(group);
            const rec = reconcile[gi];

            return (
              <div key={gi} className="px-6 py-4 border-b border-slate-100">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                  Group {gi + 1} — {group.length} records
                </div>
                <div className="space-y-2">
                  {group.map((c, ci) => {
                    // Reconcile result tag, if available
                    const recRow = rec?.results?.find((r) => r.id === c.id);
                    return (
                      <label key={c.id}
                        className={`flex items-center gap-3 p-3 rounded-xl border ${qb.multiLinked ? "cursor-default" : "cursor-pointer"} transition ${selected[gi] === ci && !qb.multiLinked ? "border-teal-400 bg-teal-50" : "border-slate-100 hover:border-slate-200"}`}>
                        {!qb.multiLinked && (
                          <input type="radio" name={`group-${gi}`} checked={selected[gi] === ci}
                            onChange={() => setSelected(prev => ({ ...prev, [gi]: ci }))}
                            className="accent-teal-600" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm text-slate-800">{c.name}</div>
                          <div className="text-xs text-slate-400 flex items-center gap-2 flex-wrap">
                            <span>{[c.company, c.email, c.phone].filter(Boolean).join(" · ") || "No details"}</span>
                            {c.qb_customer_id && <span className="text-emerald-600 font-semibold">QB linked</span>}
                            {recRow?.qbStatus === "active" && <span className="text-emerald-600 font-semibold bg-emerald-50 px-1.5 rounded">QB · Active</span>}
                            {recRow?.qbStatus === "inactive" && <span className="text-amber-600 font-semibold bg-amber-50 px-1.5 rounded">QB · Inactive</span>}
                            {recRow?.qbStatus === "notfound" && <span className="text-slate-500 font-semibold bg-slate-100 px-1.5 rounded">QB · Not found</span>}
                          </div>
                        </div>
                        {!qb.multiLinked && selected[gi] === ci && (
                          <span className="text-xs font-semibold text-teal-600 bg-teal-100 px-2 py-0.5 rounded-full">Keep</span>
                        )}
                      </label>
                    );
                  })}
                </div>

                {qb.multiLinked ? (
                  /* ─── BOTH (or more) sides are QB-linked ──────────
                     Don't expose a merge button. An InkTracker merge
                     here would orphan the loser's QB customer. The
                     correct flow is: merge them in QuickBooks first
                     (Settings → Customers → Merge), then click
                     Reconcile to let InkTracker follow what QB did.
                     The Reconcile button only reads from QB — it can
                     never damage the QB side. */
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                      <div className="flex-1 text-xs leading-snug text-amber-900">
                        <p className="font-semibold mb-1">{qb.linkedCount} customers are linked to QuickBooks.</p>
                        <p>
                          To merge safely, first merge them inside QuickBooks
                          (<span className="font-mono">Settings → Customers → Merge</span>). When that's done, click <span className="font-semibold">Reconcile from QuickBooks</span> below — InkTracker will follow the merge QB did. <span className="text-amber-700/80">Read-only check. Never writes to QuickBooks.</span>
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => handleReconcile(gi)}
                        disabled={rec?.loading}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 px-3 py-1.5 rounded-lg transition disabled:opacity-50"
                      >
                        {rec?.loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                        Reconcile from QuickBooks
                      </button>
                      {rec?.error && (
                        <span className="text-xs text-rose-600">{rec.error}</span>
                      )}
                      {rec?.results && !rec.loading && (() => {
                        const activeCount = rec.results.filter(r => r.qbStatus === "active").length;
                        if (activeCount === 1) {
                          return (
                            <button
                              onClick={() => handleReconcileMerge(gi)}
                              disabled={merging}
                              className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 px-3 py-1.5 rounded-lg transition disabled:opacity-50"
                            >
                              <GitMerge className="w-3.5 h-3.5" />
                              Finish merge in InkTracker
                            </button>
                          );
                        }
                        if (activeCount === 0) {
                          return <span className="text-xs text-amber-700">No active QB record — review manually.</span>;
                        }
                        return <span className="text-xs text-amber-700">{activeCount} customers still active in QB — finish merging there first.</span>;
                      })()}
                    </div>
                  </div>
                ) : (
                  /* ─── Safe to merge in InkTracker ─────────────────
                     0 or 1 QB-linked customers in the group. The
                     additive-merge helper handles everything; the
                     confirm dialog shows the operator the exact diff
                     before any write happens. */
                  <button onClick={() => handleMergeClick(gi)} disabled={merging}
                    className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 px-3 py-1.5 rounded-lg transition disabled:opacity-50">
                    {merging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitMerge className="w-3.5 h-3.5" />}
                    Merge into selected
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
          <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700">Close</button>
          <div className="text-xs text-slate-400">Select the record to keep, others will be merged into it</div>
        </div>
      </div>

      {/* Confirm dialog — exact diff before any write commits */}
      {confirm && (
        <ModalBackdrop onClose={() => setConfirm(null)} z="z-[60]">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Confirm merge</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Survivor: <span className="font-semibold text-slate-800">{confirm.primary.name}</span>
              </p>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 text-sm">
              <p className="text-xs text-slate-500">
                Every quote, order, and invoice attached to the duplicate{confirm.duplicates.length > 1 ? "s" : ""} below will be re-pointed at <span className="font-semibold text-slate-700">{confirm.primary.name}</span>. The duplicate row{confirm.duplicates.length > 1 ? "s are" : " is"} then deleted from InkTracker. Quickbooks is not changed.
              </p>
              {confirm.descriptions.map(({ dup, items }) => (
                <div key={dup.id} className="border border-slate-100 rounded-xl p-3">
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">
                    Merging in: <span className="text-slate-800 normal-case">{dup.name}</span>
                  </div>
                  {items.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">No new fields to copy — survivor already has everything this record had.</p>
                  ) : (
                    <ul className="text-xs space-y-1 list-disc list-inside text-slate-600">
                      {items.map((it, idx) => {
                        if (it.mode === "append" && it.field === "notes") {
                          return <li key={idx}><span className="font-semibold">Notes</span> — appended (kept primary's, added this one's)</li>;
                        }
                        if (it.mode === "union" && it.field === "saved_imprints") {
                          return <li key={idx}><span className="font-semibold">Saved imprints</span> — merged (no duplicates)</li>;
                        }
                        const label = it.field.replace(/_/g, " ");
                        let val = it.to ?? it.from;
                        if (typeof val === "boolean") val = val ? "yes" : "no";
                        return <li key={idx}>Fill <span className="font-semibold">{label}</span>: {String(val)}</li>;
                      })}
                    </ul>
                  )}
                </div>
              ))}
            </div>
            <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirm(null)}
                className="text-sm font-semibold text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const { gi, primary, duplicates } = confirm;
                  setConfirm(null);
                  await runActualMerge(gi, primary, duplicates);
                }}
                disabled={merging}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 px-4 py-1.5 rounded-lg transition disabled:opacity-50"
              >
                <GitMerge className="w-4 h-4" />
                Merge
              </button>
            </div>
          </div>
        </ModalBackdrop>
      )}
    </ModalBackdrop>
  );
}

// Surfaces post-QB-merge orphans the auto-detect picked up. Each
// actionable pair shows: which local record is the survivor, which
// will be merged into it, and exactly what data moves. Calls the
// same runCustomerMerge as the operator-driven merge flow so the
// additive-merge contract is identical. Pairs where the QB survivor
// has no local row yet display a "pull from QB first" hint instead
// of a merge button.
function QbReconcileReviewModal({ pairs, onMerge, onClose }) {
  const [merging, setMerging] = useState(false);
  const [doneIds, setDoneIds] = useState([]);

  const { actionable, survivorMissing } = useMemo(
    () => partitionReconcilePairs(pairs || []),
    [pairs],
  );

  async function handleReconcile(pair) {
    if (merging) return;
    setMerging(true);
    try {
      // Survivor = winner (Active in QB), inactive = loser. Additive
      // patch carries inactive's local data over to survivor; child
      // quotes/orders/invoices reassign; inactive row deletes.
      await onMerge(pair.survivor, [pair.inactive]);
      setDoneIds((prev) => [...prev, pair.inactive.id]);
    } finally {
      setMerging(false);
    }
  }

  const remaining = actionable.filter((p) => !doneIds.includes(p.inactive.id));

  return (
    <ModalBackdrop onClose={onClose}>
      <div className="bg-white rounded-2xl p-5 max-w-2xl w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-amber-600" />
            Finish QuickBooks Merges
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
        </div>

        <p className="text-xs text-slate-500 mb-4">
          These customers were merged in QuickBooks. Click <span className="font-semibold">Finish merge</span> to consolidate their local InkTracker data into the survivor — quotes, orders, invoices, notes, and saved imprints all transfer. QuickBooks is not touched.
        </p>

        {remaining.length === 0 && actionable.length > 0 && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 mb-3 flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-600" />
            <div className="text-xs text-emerald-700 font-semibold">All actionable merges finished.</div>
          </div>
        )}

        {remaining.length > 0 && (
          <div className="space-y-2 mb-4">
            {remaining.map((p) => (
              <div key={p.inactive.id} className="border border-slate-200 rounded-lg p-3 flex items-center justify-between gap-3">
                <div className="text-xs min-w-0">
                  <div className="font-semibold text-slate-800 truncate">
                    {p.inactive.company || p.inactive.name || p.qbDisplayName || "(unnamed)"}
                  </div>
                  <div className="text-slate-500 mt-0.5">
                    Local record will merge into{" "}
                    <span className="font-semibold text-slate-700">
                      {p.survivor.company || p.survivor.name || "(survivor)"}
                    </span>
                    {" "}(active in QuickBooks).
                  </div>
                  {(() => {
                    const items = describeMergeFor(p.survivor, p.inactive);
                    if (!items?.length) return null;
                    return (
                      <ul className="text-[10px] text-slate-400 mt-1 ml-3 list-disc">
                        {items.slice(0, 4).map((line, i) => <li key={i}>{line}</li>)}
                        {items.length > 4 && <li>+ {items.length - 4} more</li>}
                      </ul>
                    );
                  })()}
                </div>
                <button
                  onClick={() => handleReconcile(p)}
                  disabled={merging}
                  className="text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5 disabled:opacity-50 shrink-0"
                >
                  {merging ? <Loader2 className="w-3 h-3 animate-spin" /> : <GitMerge className="w-3 h-3" />}
                  Finish merge
                </button>
              </div>
            ))}
          </div>
        )}

        {survivorMissing.length > 0 && (
          <div className="border-t border-slate-100 pt-3 mt-3">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-2">
              Need QB pull first
            </div>
            <p className="text-[10px] text-slate-400 mb-2">
              These were merged in QuickBooks but the survivor isn't in InkTracker yet. Run your QuickBooks customer pull to bring it in, then revisit this banner.
            </p>
            <div className="space-y-1">
              {survivorMissing.map((p) => (
                <div key={p.inactive.id} className="text-xs text-slate-600 px-2 py-1.5 bg-slate-50 rounded">
                  {p.inactive.company || p.inactive.name || p.qbDisplayName || "(unnamed)"}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end mt-4">
          <button
            onClick={onClose}
            className="text-xs font-semibold text-slate-600 hover:text-slate-800 px-4 py-2"
          >
            Close
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}