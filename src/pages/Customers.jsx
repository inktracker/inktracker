import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/supabaseClient";
import { cachedFilter } from "@/lib/queries/cachedEntity";
import { CardGridSkeleton } from "@/components/shared/Skeletons";
import { uploadFile } from "@/lib/uploadFile";
import AdvancedFilters from "../components/AdvancedFilters";
import { syncCustomerToQB } from "@/lib/qbCustomerSync";
import { addressOneLine } from "@/lib/tax/address";
import { normalizeCustomerWrite } from "@/lib/customers/normalizeCustomerWrite";
import { buildAdditiveMergePatch } from "@/lib/customers/mergeCustomerData";
import { aggregateInvoiceStatsByCustomer } from "@/lib/customers/invoiceStats";
import { findReconcileNeeded, partitionReconcilePairs, planReconcileActions } from "@/lib/customers/qbReconcileDetect";
import { GitMerge, AlertTriangle } from "lucide-react";
import EmptyState from "../components/shared/EmptyState";
import {
  countCustomerDependents,
  formatDependentsMessage,
} from "@/lib/customers/countCustomerDependents";
import { useBillingGate, useReadOnly } from "@/lib/billing-gate";
import ReactivateLink from "@/components/shared/ReactivateLink";
import { notify } from "@/lib/notify";
import { isValidEmail } from "@/lib/email";
import { shopScope } from "@/lib/shopScope";
import { hasOwnerAccess } from "@/lib/managerPermissions";
import AddCustomerForm from "@/components/customers/AddCustomerForm";
import CustomerCardGrid from "@/components/customers/CustomerCardGrid";
import EditCustomerModal from "@/components/customers/EditCustomerModal";
import MergeDuplicatesModal from "@/components/customers/MergeDuplicatesModal";
import QbReconcileReviewModal from "@/components/customers/QbReconcileReviewModal";

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
  bill_to_address: null,
  ship_to_address: null,
  exemption_type: "",
  exemption_certificate_number: "",
  exemption_certificate_path: "",
  exemption_expires_at: "",
  exemption_states: null,
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
  // Read-only affordance state — declared AFTER `user` so the hook can read it.
  const { readOnly, reason: readOnlyReason, reactivateHref } = useReadOnly(user);
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

        // Cached mount-load reads — see lib/queries/cachedEntity. Merge/detail
        // lookups below stay direct (freshness-critical for the merge path).
        const [c, docs, invs] = await Promise.all([
          cachedFilter("Customer", { filters: { shop_owner: shopScope(currentUser) } }),
          cachedFilter("BrokerDocument", { filters: { shop_owner: shopScope(currentUser) }, sort: "-created_date", limit: 500 }),
          cachedFilter("Invoice", { filters: { shop_owner: shopScope(currentUser) } }),
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
        // Full-partner managers (with Customers permission) get the same
        // auto-merge path as the owner; restricted managers fall back to the
        // review banner.
        const isOwner = hasOwnerAccess(user, "Customers");
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
      // Fetch children by BOTH customer_id and customer_name for all three
      // entities. Orders used to be fetched by name only, so an order whose
      // stored name drifted from the duplicate's current name survived the
      // merge pointing at a deleted customer id. A null name matches
      // nothing, so name lookups are skipped for unnamed records.
      const byName = (entity) =>
        dup.name ? base44.entities[entity].filter({ customer_name: dup.name }) : Promise.resolve([]);
      const [quotesById, ordersById, invoicesById, quotesByName, ordersByName, invoicesByName, artworkDocsForDup] = await Promise.all([
        base44.entities.Quote.filter({ customer_id: dup.id }),
        base44.entities.Order.filter({ customer_id: dup.id }),
        base44.entities.Invoice.filter({ customer_id: dup.id }),
        byName("Quote"),
        byName("Order"),
        byName("Invoice"),
        base44.entities.BrokerDocument.filter({ broker_id: getClientArtworkKey(dup.id), shop_owner: shopScope(user) }),
      ]);
      const allQuotes = [...new Map([...quotesById, ...quotesByName].map((q) => [q.id, q])).values()];
      const allOrders = [...new Map([...ordersById, ...ordersByName].map((o) => [o.id, o])).values()];
      const allInvoices = [...new Map([...invoicesById, ...invoicesByName].map((i) => [i.id, i])).values()];

      let dupReassignsOk = true;
      for (const q of allQuotes) {
        try { await base44.entities.Quote.update(q.id, { customer_id: primary.id, customer_name: primary.name }); totalMoved++; }
        catch (e) { console.error("Quote reassign failed:", e); dupReassignsOk = false; }
      }
      for (const o of allOrders) {
        try { await base44.entities.Order.update(o.id, { customer_id: primary.id, customer_name: primary.name }); totalMoved++; }
        catch (e) { console.error("Order reassign failed:", e); dupReassignsOk = false; }
      }
      for (const inv of allInvoices) {
        try { await base44.entities.Invoice.update(inv.id, { customer_id: primary.id, customer_name: primary.name }); totalMoved++; }
        catch (e) { console.error("Invoice reassign failed:", e); dupReassignsOk = false; }
      }
      // The duplicate's artwork library rows are keyed client:<id>; without
      // reassignment they dangle on the deleted id and vanish from every
      // customer card ("nothing gets silently dropped" contract).
      const movedArtworkIds = [];
      for (const doc of artworkDocsForDup) {
        try {
          await base44.entities.BrokerDocument.update(doc.id, { broker_id: getClientArtworkKey(primary.id) });
          movedArtworkIds.push(doc.id);
          totalMoved++;
        } catch (e) { console.error("Artwork reassign failed:", e); dupReassignsOk = false; }
      }
      if (movedArtworkIds.length > 0) {
        const movedSet = new Set(movedArtworkIds);
        setArtworkDocs((prev) =>
          prev.map((doc) => (movedSet.has(doc.id) ? { ...doc, broker_id: getClientArtworkKey(primary.id) } : doc)),
        );
      }

      const mergeFields = buildAdditiveMergePatch(primary, dup);
      if (mergeFields) {
        try {
          const updated = await base44.entities.Customer.update(primary.id, mergeFields);
          primary = updated || { ...primary, ...mergeFields };
        } catch (e) {
          // If carrying the duplicate's fields onto the survivor fails, we must
          // NOT delete the duplicate — doing so would lose the very data
          // (exemption cert, ship-to, notes) the patch was meant to preserve.
          // Keep the duplicate in place and report it as a partial merge.
          console.error("Customer merge additive-patch failed:", e);
          dupReassignsOk = false;
        }
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
    // below misses anything (id+name combos). Owner OR a full-partner manager
    // with Customers permission (managerCanAccess gates it per-manager).
    return hasOwnerAccess(user, "Customers");
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
      created = await base44.entities.Customer.create(normalizeCustomerWrite({
        ...form,
        // Keep the legacy one-line `address` in sync with structured billing
        // (QB BillAddr + customer-list display read it).
        address: addressOneLine(form.bill_to_address) || form.address || "",
        shop_owner: shopScope(user),
        orders: 0,
      }));
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
      // Keep legacy one-line `address` in sync with structured billing.
      patch.address = addressOneLine(editing.bill_to_address) || editing.address || "";
      // Toggling Tax Exempt off resets exemption_expires_at to "" — Postgres
      // rejects "" for a date column, same failure as the add path.
      const updated = await base44.entities.Customer.update(editing.id, normalizeCustomerWrite(patch));
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
        shop_owner: shopScope(user),
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
    if (filters.name && !c.name?.toLowerCase().includes(filters.name.toLowerCase())) {
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
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Customers</h2>
        <div className="flex flex-wrap gap-2 items-center">
          <ReactivateLink show={readOnly} href={reactivateHref} />
          <button onClick={() => setShowMerge(true)}
            disabled={readOnly}
            title={readOnly ? readOnlyReason : undefined}
            className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-600 text-sm font-semibold px-4 py-2.5 rounded-xl transition hover:border-teal-300 disabled:opacity-50 disabled:cursor-not-allowed">
            <GitMerge className="w-4 h-4" /> Merge Duplicates
          </button>
          <button
            onClick={() => setShowForm((v) => !v)}
            disabled={readOnly}
            title={readOnly ? readOnlyReason : undefined}
            className="bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
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
        <AddCustomerForm
          form={form}
          setForm={setForm}
          handleAdd={handleAdd}
          addingCustomer={addingCustomer}
          readOnly={readOnly}
          reactivateHref={reactivateHref}
        />
      )}

      {loading ? (
        <CardGridSkeleton />
      ) : customers.length === 0 ? (
        <EmptyState type="customers" onAction={() => { setForm(emptyCustomerForm); setShowForm(true); }} readOnly={readOnly} reactivateHref={reactivateHref} />
      ) : (
        <CustomerCardGrid
          filtered={filtered}
          invoiceStats={invoiceStats}
          artworkByCustomer={artworkByCustomer}
          navigate={navigate}
          setEditing={setEditing}
          setConfirmDelete={setConfirmDelete}
          setArtworkNote={setArtworkNote}
          setArtworkColorCount={setArtworkColorCount}
        />
      )}

      {editing && (
        <EditCustomerModal
          editing={editing}
          setEditing={setEditing}
          confirmDelete={confirmDelete}
          setConfirmDelete={setConfirmDelete}
          artworkNote={artworkNote}
          setArtworkNote={setArtworkNote}
          artworkColorCount={artworkColorCount}
          setArtworkColorCount={setArtworkColorCount}
          handleSaveEdit={handleSaveEdit}
          editSaving={editSaving}
          editSaved={editSaved}
          handleDelete={handleDelete}
          handleArtworkUpload={handleArtworkUpload}
          uploadingArtwork={uploadingArtwork}
          currentEditingArtwork={currentEditingArtwork}
          handleRemoveArtwork={handleRemoveArtwork}
          readOnly={readOnly}
          reactivateHref={reactivateHref}
        />
      )}

      {showMerge && (
        <MergeDuplicatesModal
          customers={customers}
          user={user}
          onMerge={runCustomerMerge}
          onClose={() => setShowMerge(false)}
          supabaseFuncUrl={SUPABASE_FUNC_URL}
          readOnly={readOnly}
          reactivateHref={reactivateHref}
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
