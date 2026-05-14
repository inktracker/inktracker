import { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/supabaseClient";
import { fmtMoney } from "@/components/shared/pricing";
import { placeOrder, getShippingMethods, SUPPLIERS } from "@/api/suppliers";
import {
  poSubtotal,
  freightProgress,
  removeItem,
  updateItemQty,
  validateForSubmit,
  buildSubmitPayload,
  mergePOItems,
  mergeableDestinations,
  buildMergedPO,
  combinedReference,
  AC_REFERENCE_MAX,
} from "@/lib/purchaseOrders";
import AddItemsPanel from "@/components/purchaseOrders/AddItemsPanel";
import { Plus, Trash2, Loader2, Truck, CheckCircle2, AlertCircle, X, GitMerge, Check } from "lucide-react";

const STATUS_LABEL = { draft: "Draft", submitted: "Submitted", cancelled: "Cancelled" };

export default function PurchaseOrders() {
  const [user, setUser] = useState(null);
  const [pos, setPos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("drafts"); // drafts | history
  const [selectedId, setSelectedId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [mergeOpen, setMergeOpen] = useState(false);

  // Filter + multi-select merge mode (drafts tab only)
  const [supplierFilter, setSupplierFilter] = useState("All");
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeSelection, setMergeSelection] = useState(() => new Set());
  const [merging, setMerging] = useState(false);

  // Shipping methods cache keyed by supplier. Loaded once per supplier
  // per session and shared across POs. Saves a round trip every time a
  // user clicks a draft.
  const [shippingMethodsBySupplier, setShippingMethodsBySupplier] = useState({});
  const [shippingMethodsLoading, setShippingMethodsLoading] = useState(false);
  const [shippingMethodsError, setShippingMethodsError] = useState(null);

  // Per-shop free-freight thresholds keyed by supplier name
  const thresholds = user?.free_freight_thresholds || {};

  useEffect(() => {
    base44.auth.me().then(async (u) => {
      setUser(u);
      const rows = await base44.entities.PurchaseOrder.filter({ shop_owner: u.email });
      setPos([...rows].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // Suppliers actually present on this shop's POs — used to populate
  // the filter pills. Sorted alphabetically so the order is stable as
  // POs come and go.
  const supplierOptions = useMemo(() => {
    const set = new Set();
    for (const p of pos) if (p.supplier) set.add(p.supplier);
    return ["All", ...Array.from(set).sort()];
  }, [pos]);

  const visible = useMemo(() => {
    let list = tab === "drafts"
      ? pos.filter((p) => p.status === "draft")
      : pos.filter((p) => p.status !== "draft");
    if (supplierFilter !== "All") {
      list = list.filter((p) => p.supplier === supplierFilter);
    }
    return list;
  }, [pos, tab, supplierFilter]);

  // Reset merge mode when leaving drafts tab or changing filter — the
  // selection set may otherwise contain rows that aren't visible.
  useEffect(() => {
    if (tab !== "drafts" || mergeMode) {
      setMergeSelection(new Set());
    }
    if (tab !== "drafts" && mergeMode) setMergeMode(false);
  }, [tab, supplierFilter]);

  // When the selected PO is a draft, fetch the supplier's shipping
  // methods if we haven't already. Skip on locked POs (their saved
  // method is already a string, no need to populate the dropdown).
  useEffect(() => {
    if (!selectedId) return;
    const sel = pos.find((p) => p.id === selectedId);
    if (!sel || sel.status !== "draft") return;
    if (shippingMethodsBySupplier[sel.supplier]) return;
    let cancelled = false;
    setShippingMethodsLoading(true);
    setShippingMethodsError(null);
    getShippingMethods(sel.supplier)
      .then(({ methods }) => {
        if (cancelled) return;
        setShippingMethodsBySupplier((prev) => ({ ...prev, [sel.supplier]: methods }));
      })
      .catch((err) => {
        if (cancelled) return;
        setShippingMethodsError(
          err?.message?.includes("not configured")
            ? "Configure your AS Colour API keys to load shipping methods."
            : `Couldn't load shipping methods: ${err?.message || err}`,
        );
      })
      .finally(() => {
        if (!cancelled) setShippingMethodsLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedId, pos, shippingMethodsBySupplier]);

  function toggleSelectForMerge(id) {
    setMergeSelection((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const selected = useMemo(
    () => pos.find((p) => p.id === selectedId) || null,
    [pos, selectedId],
  );

  async function createDraft() {
    if (!user) return;
    setCreating(true);
    try {
      const defaults = {
        shop_owner: user.email,
        supplier: SUPPLIERS.AC,
        status: "draft",
        reference: `PO-${new Date().toISOString().slice(0, 10)}`,
        ship_to: defaultShipTo(user),
        items: [],
      };
      const created = await base44.entities.PurchaseOrder.create(defaults);
      setPos((prev) => [created, ...prev]);
      setSelectedId(created.id);
    } finally {
      setCreating(false);
    }
  }

  async function patchSelected(patch) {
    if (!selected) return;
    const updated = await base44.entities.PurchaseOrder.update(selected.id, patch);
    setPos((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  }

  async function deleteSelected() {
    if (!selected) return;
    if (!confirm(`Delete "${selected.reference}"? This cannot be undone.`)) return;
    await base44.entities.PurchaseOrder.delete(selected.id);
    setPos((prev) => prev.filter((p) => p.id !== selected.id));
    setSelectedId(null);
  }

  // Multi-select merge: combine all selected drafts into one new PO.
  // Reference becomes "ref1, ref2, ref3..."; ship_to/shipping/notes
  // come from the first selected. All sources delete after the new
  // row is in place.
  async function mergeMultipleSelected() {
    if (!user || mergeSelection.size < 2) return;
    // Preserve the order users see in the list (visible's order) so
    // the comma-separated reference and the ship_to inheritance are
    // predictable rather than dependent on Set iteration order.
    const sources = visible.filter((p) => mergeSelection.has(p.id));
    if (sources.length < 2) return;
    const totalItems = sources.reduce((s, p) => s + (p.items?.length || 0), 0);
    if (!confirm(
      `Merge ${sources.length} drafts into one new PO?\n\n` +
      `New reference: "${combinedReference(sources.map(s => s.reference))}"\n` +
      `${totalItems} item rows combined (duplicate SKUs summed).\n\n` +
      `The original ${sources.length} drafts will be deleted.`,
    )) return;
    setMerging(true);
    try {
      const payload = buildMergedPO(sources);
      const created = await base44.entities.PurchaseOrder.create(payload);
      // Delete sources in parallel; if one fails the rest still go.
      await Promise.all(
        sources.map((s) =>
          base44.entities.PurchaseOrder.delete(s.id).catch((err) => {
            console.error(`Failed to delete merged source ${s.id}:`, err);
          }),
        ),
      );
      const sourceIds = new Set(sources.map((s) => s.id));
      setPos((prev) => [created, ...prev.filter((p) => !sourceIds.has(p.id))]);
      setSelectedId(created.id);
      setMergeMode(false);
      setMergeSelection(new Set());
    } catch (err) {
      alert("Merge failed: " + (err?.message || String(err)));
    } finally {
      setMerging(false);
    }
  }

  // Merge `selected` INTO targetPO: combine items (mergeItem dedupes
  // SKUs, sums quantities), update target, delete source. Destination's
  // ship_to / shipping_method / notes are kept as-is.
  async function mergeSelectedInto(targetPO) {
    if (!selected || !targetPO) return;
    const sourceLabel = selected.reference || "this draft";
    const destLabel = targetPO.reference || "the destination";
    if (!confirm(
      `Merge "${sourceLabel}" into "${destLabel}"?\n\n` +
      `${selected.items?.length || 0} item(s) will move into "${destLabel}". ` +
      `Duplicate SKUs are summed. "${sourceLabel}" will be deleted afterwards.`,
    )) return;
    setMergeOpen(false);
    const mergedItems = mergePOItems(selected.items, targetPO.items);
    const updated = await base44.entities.PurchaseOrder.update(targetPO.id, { items: mergedItems });
    await base44.entities.PurchaseOrder.delete(selected.id);
    setPos((prev) => prev
      .filter((p) => p.id !== selected.id)
      .map((p) => (p.id === updated.id ? updated : p)));
    setSelectedId(updated.id);
  }

  async function submitSelected() {
    if (!selected) return;
    const errors = validateForSubmit(selected);
    if (errors.length) {
      setSubmitError(errors.join("\n"));
      return;
    }
    if (!confirm(`Submit "${selected.reference}" to ${selected.supplier}?\n\nThis places a real order. Subtotal: ${fmtMoney(poSubtotal(selected.items))}.`)) {
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload = buildSubmitPayload(selected);
      const result = await placeOrder(selected.supplier, payload);
      await patchSelected({
        status: "submitted",
        supplier_order_id: result?.order?.id ? String(result.order.id) : null,
        submit_response: result ?? null,
        submitted_at: new Date().toISOString(),
      });
    } catch (err) {
      setSubmitError(err?.message || "Order submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading purchase orders…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Purchase Orders</h2>
          <p className="text-sm text-slate-400 mt-0.5">
            Build supplier orders, pair jobs to hit free freight, submit when ready.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {tab === "drafts" && (
            <button
              onClick={() => {
                if (mergeMode) setMergeSelection(new Set());
                setMergeMode((v) => !v);
              }}
              className={`flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-xl transition border ${
                mergeMode
                  ? "bg-indigo-50 border-indigo-300 text-indigo-700"
                  : "bg-white border-slate-200 text-slate-600 hover:border-indigo-300"
              }`}
            >
              <GitMerge className="w-4 h-4" /> {mergeMode ? "Exit merge mode" : "Merge POs"}
            </button>
          )}
          <button
            onClick={createDraft}
            disabled={creating}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-3 py-2 rounded-xl transition shadow-sm disabled:opacity-60"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            New PO
          </button>
        </div>
      </div>

      {/* Supplier filter pills — only show when shop has POs from
          more than one supplier (otherwise "All / S&S" is just noise). */}
      {supplierOptions.length > 2 && (
        <div className="flex flex-wrap gap-1.5">
          {supplierOptions.map((s) => (
            <button
              key={s}
              onClick={() => setSupplierFilter(s)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition ${
                supplierFilter === s
                  ? "bg-indigo-600 border-indigo-600 text-white"
                  : "bg-white border-slate-200 text-slate-500 hover:border-slate-400"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-200">
        {["drafts", "history"].map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setSelectedId(null); }}
            className={`px-4 py-2 text-sm font-semibold transition ${
              tab === t
                ? "text-indigo-600 border-b-2 border-indigo-600 -mb-px"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {t === "drafts" ? `Drafts (${pos.filter(p => p.status === "draft").length})` : "History"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
        {/* List */}
        <div className="space-y-2">
          {visible.length === 0 && (
            <div className="text-sm text-slate-400 bg-white border border-slate-100 rounded-xl p-6 text-center">
              {tab === "drafts" ? "No drafts yet. Click New PO to start." : "No submitted orders yet."}
            </div>
          )}
          {visible.map((po) => {
            const subtotal = poSubtotal(po.items);
            const t = Number(thresholds[po.supplier]) || 0;
            const fp = freightProgress(po.items, t);
            const isSel = po.id === selectedId;
            const isChecked = mergeSelection.has(po.id);
            const handleClick = mergeMode
              ? () => toggleSelectForMerge(po.id)
              : () => setSelectedId(po.id);
            return (
              <button
                key={po.id}
                onClick={handleClick}
                className={`w-full text-left bg-white border rounded-xl p-3 transition ${
                  mergeMode && isChecked
                    ? "border-indigo-500 ring-2 ring-indigo-200"
                    : isSel
                      ? "border-indigo-400 ring-2 ring-indigo-100"
                      : "border-slate-100 hover:border-slate-300"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0 flex-1">
                    {mergeMode && (
                      <div className={`mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                        isChecked
                          ? "bg-indigo-600 border-indigo-600"
                          : "border-slate-300 bg-white"
                      }`}>
                        {isChecked && <Check className="w-3 h-3 text-white" />}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-sm text-slate-800 truncate">{po.reference || "Untitled PO"}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        {po.supplier} · {po.items?.length || 0} items · {fmtMoney(subtotal)}
                      </div>
                    </div>
                  </div>
                  {po.status !== "draft" && (
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                      {STATUS_LABEL[po.status]}
                    </span>
                  )}
                </div>
                {po.status === "draft" && t > 0 && (
                  <div className="mt-2">
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all ${fp.qualifies ? "bg-emerald-500" : "bg-indigo-500"}`}
                        style={{ width: `${fp.percentage}%` }}
                      />
                    </div>
                    <div className="text-[10px] text-slate-400 mt-1">
                      {fp.qualifies
                        ? `Free freight ✓ (${fmtMoney(subtotal)} of ${fmtMoney(t)})`
                        : `${fmtMoney(fp.remaining)} to free freight`}
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Detail */}
        <div>
          {!selected ? (
            <div className="text-sm text-slate-400 bg-white border border-slate-100 rounded-xl p-10 text-center">
              Select a PO to view details, or click <strong>New PO</strong>.
            </div>
          ) : (
            <PoDetail
              po={selected}
              threshold={Number(thresholds[selected.supplier]) || 0}
              submitting={submitting}
              submitError={submitError}
              shippingMethods={shippingMethodsBySupplier[selected.supplier] || []}
              shippingMethodsLoading={shippingMethodsLoading}
              shippingMethodsError={shippingMethodsError}
              mergeTargets={mergeableDestinations(selected, pos)}
              mergeOpen={mergeOpen}
              onMergeOpen={() => setMergeOpen(true)}
              onMergeClose={() => setMergeOpen(false)}
              onMergeInto={mergeSelectedInto}
              onPatch={patchSelected}
              onItemRemove={(idx) => patchSelected({ items: removeItem(selected.items, idx) })}
              onItemQty={(idx, qty) => patchSelected({ items: updateItemQty(selected.items, idx, qty) })}
              onDelete={deleteSelected}
              onSubmit={submitSelected}
              onDismissError={() => setSubmitError(null)}
            />
          )}
        </div>
      </div>

      {/* Floating action bar for multi-select merge. Sits at the bottom
          of the viewport while merge mode is on. Disabled until ≥2
          drafts are checked. */}
      {mergeMode && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 bg-slate-900 text-white rounded-2xl shadow-2xl px-4 py-3 flex items-center gap-3">
          <div className="text-sm font-semibold">
            {mergeSelection.size === 0
              ? "Select drafts to merge"
              : `${mergeSelection.size} draft${mergeSelection.size === 1 ? "" : "s"} selected`}
          </div>
          <button
            onClick={() => { setMergeMode(false); setMergeSelection(new Set()); }}
            className="text-xs font-semibold text-slate-300 hover:text-white px-2 py-1.5"
          >
            Cancel
          </button>
          <button
            onClick={mergeMultipleSelected}
            disabled={mergeSelection.size < 2 || merging}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-700 disabled:text-slate-400 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition"
          >
            {merging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitMerge className="w-3.5 h-3.5" />}
            Merge {mergeSelection.size >= 2 ? mergeSelection.size : ""}
          </button>
        </div>
      )}
    </div>
  );
}

function defaultShipTo(user) {
  return {
    company: user?.shop_name || "",
    firstName: "",
    lastName: "",
    address1: user?.address || "",
    address2: "",
    city: "",
    state: "",
    zip: "",
    countryCode: "US",
    email: user?.email || "",
    phone: user?.phone || "",
  };
}

function PoDetail({ po, threshold, submitting, submitError, shippingMethods, shippingMethodsLoading, shippingMethodsError, mergeTargets, mergeOpen, onMergeOpen, onMergeClose, onMergeInto, onPatch, onItemRemove, onItemQty, onDelete, onSubmit, onDismissError }) {
  const subtotal = poSubtotal(po.items);
  const fp = freightProgress(po.items, threshold);
  const isLocked = po.status !== "draft";

  return (
    <div className="bg-white border border-slate-100 rounded-xl p-5 space-y-5">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <input
            value={po.reference || ""}
            onChange={(e) => onPatch({ reference: e.target.value })}
            disabled={isLocked}
            maxLength={!isLocked && po.supplier === "AS Colour" ? AC_REFERENCE_MAX : undefined}
            className={`text-lg font-bold bg-transparent border-b border-transparent hover:border-slate-200 focus:border-indigo-400 focus:outline-none w-full disabled:text-slate-500 ${
              (po.reference || "").length > AC_REFERENCE_MAX && po.supplier === "AS Colour" && !isLocked
                ? "text-red-600"
                : "text-slate-800"
            }`}
            placeholder="PO reference"
          />
          {!isLocked && po.supplier === "AS Colour" && (
            <div className={`text-[10px] mt-0.5 ${
              (po.reference || "").length > AC_REFERENCE_MAX ? "text-red-500" : "text-slate-400"
            }`}>
              {(po.reference || "").length}/{AC_REFERENCE_MAX} (AS Colour limit)
            </div>
          )}
        </div>
        {!isLocked && (
          <div className="flex items-center gap-1 relative">
            {mergeTargets?.length > 0 && (
              <>
                <button
                  onClick={onMergeOpen}
                  title="Combine this draft into another draft to hit free freight"
                  className="text-slate-400 hover:text-indigo-600 p-1.5 rounded-lg hover:bg-indigo-50"
                >
                  <GitMerge className="w-4 h-4" />
                </button>
                {mergeOpen && (
                  <MergePicker
                    targets={mergeTargets}
                    onClose={onMergeClose}
                    onPick={onMergeInto}
                  />
                )}
              </>
            )}
            <button onClick={onDelete} className="text-slate-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Free-freight bar */}
      {threshold > 0 && (
        <div className="bg-slate-50 rounded-lg p-3">
          <div className="flex items-center justify-between text-xs font-semibold mb-1.5">
            <span className={fp.qualifies ? "text-emerald-700" : "text-slate-700"}>
              {fp.qualifies ? "Free freight unlocked" : `${fmtMoney(fp.remaining)} to free freight`}
            </span>
            <span className="text-slate-500">
              {fmtMoney(subtotal)} / {fmtMoney(threshold)}
            </span>
          </div>
          <div className="h-2 bg-white rounded-full overflow-hidden">
            <div
              className={`h-full transition-all ${fp.qualifies ? "bg-emerald-500" : "bg-indigo-500"}`}
              style={{ width: `${fp.percentage}%` }}
            />
          </div>
        </div>
      )}

      {/* Add items picker */}
      {!isLocked && (
        <AddItemsPanel
          supplier={po.supplier}
          onAddItems={(updater) => onPatch({ items: typeof updater === "function" ? updater(po.items || []) : updater })}
        />
      )}

      {/* Items */}
      <div>
        <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Items</div>
        {!po.items?.length ? (
          <div className="text-sm text-slate-400 border border-dashed border-slate-200 rounded-lg p-6 text-center">
            No items yet. Add them from the AS Colour catalog or inventory.
          </div>
        ) : (
          <div className="border border-slate-100 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                <tr>
                  <th className="text-left px-3 py-2">SKU</th>
                  <th className="text-left px-3 py-2">Color / Size</th>
                  <th className="text-right px-3 py-2">Qty</th>
                  <th className="text-right px-3 py-2">Unit</th>
                  <th className="text-right px-3 py-2">Line</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {po.items.map((it, i) => (
                  <tr key={`${it.sku}-${it.warehouse ?? ""}-${i}`}>
                    <td className="px-3 py-2 font-mono text-xs text-slate-700">{it.sku}</td>
                    <td className="px-3 py-2 text-slate-600">{[it.color, it.size].filter(Boolean).join(" · ")}</td>
                    <td className="px-3 py-2 text-right">
                      {isLocked ? (
                        it.quantity
                      ) : (
                        <input
                          type="number"
                          min="0"
                          value={it.quantity}
                          onChange={(e) => onItemQty(i, e.target.value)}
                          className="w-16 text-right border border-slate-200 rounded px-1.5 py-0.5"
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-600">{fmtMoney(it.unitPrice || 0)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-800">
                      {fmtMoney((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0))}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {!isLocked && (
                        <button
                          onClick={() => onItemRemove(i)}
                          className="text-slate-300 hover:text-red-500 p-1"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 text-sm font-semibold">
                <tr>
                  <td colSpan={4} className="px-3 py-2 text-right text-slate-500">Subtotal</td>
                  <td className="px-3 py-2 text-right text-slate-800">{fmtMoney(subtotal)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Ship-to / shipping method / notes */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Ship to</div>
          <ShipToEditor
            value={po.ship_to || {}}
            disabled={isLocked}
            onChange={(ship_to) => onPatch({ ship_to })}
          />
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">Shipping method</label>
            <select
              value={po.shipping_method || ""}
              onChange={(e) => onPatch({ shipping_method: e.target.value })}
              disabled={isLocked || shippingMethodsLoading}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white"
            >
              <option value="">
                {shippingMethodsLoading ? "Loading…" : "Select a method"}
              </option>
              {/* Keep the saved value selectable even if the API didn't
                  return it (older PO, supplier changed offerings). */}
              {po.shipping_method && !shippingMethods.includes(po.shipping_method) && (
                <option value={po.shipping_method}>{po.shipping_method} (saved)</option>
              )}
              {shippingMethods.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            {shippingMethodsError && (
              <div className="text-[10px] text-red-500 mt-1">{shippingMethodsError}</div>
            )}
          </div>
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">Warehouse</label>
            <select
              value={po.warehouse || "Carson, CA"}
              onChange={(e) => onPatch({ warehouse: e.target.value })}
              disabled={isLocked}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white"
            >
              <option value="Carson, CA">Carson, CA (West Coast)</option>
              <option value="Charlotte, NC">Charlotte, NC (East Coast)</option>
            </select>
            <div className="text-[10px] text-slate-400 mt-1">
              AS Colour US warehouse this order ships from. Applied to all items.
            </div>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">Order notes</label>
            <textarea
              value={po.notes || ""}
              onChange={(e) => onPatch({ notes: e.target.value })}
              disabled={isLocked}
              rows={2}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">Courier instructions</label>
            <textarea
              value={po.courier_instructions || ""}
              onChange={(e) => onPatch({ courier_instructions: e.target.value })}
              disabled={isLocked}
              rows={2}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2"
            />
          </div>
        </div>
      </div>

      {/* Submit / status */}
      {isLocked ? (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-800 flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            Submitted to {po.supplier}
            {po.supplier_order_id && <> · supplier order ID <code className="font-mono">{po.supplier_order_id}</code></>}
            {po.submitted_at && <> · {new Date(po.submitted_at).toLocaleString()}</>}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {submitError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div className="flex-1 whitespace-pre-line">{submitError}</div>
              <button onClick={onDismissError} className="text-red-400 hover:text-red-600">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          <button
            onClick={onSubmit}
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-4 py-2.5 rounded-xl transition disabled:opacity-60"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />}
            Submit to {po.supplier}
          </button>
        </div>
      )}
    </div>
  );
}

function ShipToEditor({ value, disabled, onChange }) {
  function field(key, placeholder, { required } = {}) {
    const isMissing = required && !value[key];
    return (
      <input
        value={value[key] || ""}
        onChange={(e) => onChange({ ...value, [key]: e.target.value })}
        disabled={disabled}
        placeholder={required ? `${placeholder} *` : placeholder}
        className={`w-full text-sm border rounded-lg px-2.5 py-1.5 ${
          isMissing ? "border-red-300 bg-red-50/30" : "border-slate-200"
        }`}
      />
    );
  }
  return (
    <div className="space-y-2">
      {field("company", "Company")}
      <div className="grid grid-cols-2 gap-2">
        {field("firstName", "First name", { required: true })}
        {field("lastName", "Last name", { required: true })}
      </div>
      {field("address1", "Street address", { required: true })}
      {field("address2", "Apt / suite (optional)")}
      <div className="grid grid-cols-3 gap-2">
        {field("city", "City", { required: true })}
        {field("state", "State")}
        {field("zip", "ZIP", { required: true })}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {field("countryCode", "Country (e.g. US)", { required: true })}
        {field("phone", "Phone")}
      </div>
      <div className="text-[10px] text-slate-400">* required by AS Colour</div>
    </div>
  );
}

// Small popover that lists other open drafts (same supplier) the
// current PO can be merged into. Click one → onPick(target) which
// the parent confirms + executes.
function MergePicker({ targets, onClose, onPick }) {
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="absolute right-0 top-9 z-40 w-72 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
        <div className="px-3 py-2 border-b border-slate-100 text-xs font-bold text-slate-500 uppercase tracking-wider">
          Merge into…
        </div>
        <div className="max-h-72 overflow-y-auto">
          {targets.map((t) => {
            const subtotal = poSubtotal(t.items);
            return (
              <button
                key={t.id}
                onClick={() => onPick(t)}
                className="w-full text-left px-3 py-2 hover:bg-slate-50 transition border-b border-slate-100 last:border-b-0"
              >
                <div className="text-sm font-semibold text-slate-800 truncate">
                  {t.reference || "Untitled PO"}
                </div>
                <div className="text-[11px] text-slate-400">
                  {t.items?.length || 0} items · {fmtMoney(subtotal)}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
