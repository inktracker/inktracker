import { useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { base44, supabase } from "@/api/supabaseClient";
import { ListCardsSkeleton } from "@/components/shared/Skeletons";
import { fmtMoney } from "@/components/shared/pricing";
import { placeOrder, getShippingMethods, SUPPLIERS } from "@/api/suppliers";
import { comparePoSuppliers, savingsVsCurrent, repriceItemsForSupplier, candidateSuppliers } from "@/lib/suppliers/sourcingOptions";
import {
  poSubtotal,
  freightProgress,
  removeItem,
  updateItemQty,
  validateForSubmit,
  buildSubmitPayload,
  buildSsSubmitPayload,
  buildSmSubmitPayload,
  mergePOItems,
  mergeableDestinations,
  buildMergedPO,
  combinedReference,
  AC_REFERENCE_MAX,
  applyPOItemsToGoodsProgress,
  setItemCheckedIn,
  applyCheckInToOrder,
} from "@/lib/purchaseOrders";
import AddItemsPanel from "@/components/purchaseOrders/AddItemsPanel";
import ConsolidateBuyingModal from "@/components/purchaseOrders/ConsolidateBuyingModal";
import POReceivingPanel from "@/components/purchaseOrders/POReceivingPanel";
import SupplierConnectionBanner from "@/components/purchaseOrders/SupplierConnectionBanner";
import { buildPOCsv, buildPOCsvFilename } from "@/lib/orders/poCsv";
import { Plus, Trash2, Loader2, Truck, CheckCircle2, AlertCircle, X, GitMerge, Check, Download, PackageCheck, TrendingDown, Scale } from "lucide-react";
import { notify } from "@/lib/notify";
import { shopScope } from "@/lib/shopScope";
import { useReadOnly } from "@/lib/billing-gate";
import ReactivateLink from "@/components/shared/ReactivateLink";

const STATUS_LABEL = { draft: "Draft", submitted: "Submitted", cancelled: "Cancelled" };

// Free-text field that edits LOCALLY and only persists on blur. The PO detail
// inputs used to await a DB write on every keystroke and rebind to the server
// row — so under latency an out-of-order response snapped typed characters
// back. Local draft state fixes both the snapback and the per-keystroke write.
// Mount with key={`${po.id}-<field>`} so switching to a different PO remounts
// it with the new value (editable fields must not effect-sync, but must reseed
// on identity change).
function BlurField({ value, onCommit, textarea = false, ...props }) {
  const [draft, setDraft] = useState(value ?? "");
  const commit = () => { if ((draft ?? "") !== (value ?? "")) onCommit(draft); };
  const common = { ...props, value: draft, onChange: (e) => setDraft(e.target.value), onBlur: commit };
  return textarea ? <textarea {...common} /> : <input {...common} />;
}

export default function PurchaseOrders() {
  const [user, setUser] = useState(null);
  // Read-only gate — declared AFTER the user useState so it never
  // references `user` before initialization. Writable users default
  // to not-read-only (computeReadOnly returns false for no/active user).
  const { readOnly, reason, reactivateHref } = useReadOnly(user);
  const [pos, setPos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("drafts"); // drafts | history
  const [selectedId, setSelectedId] = useState(null);
  const [creating, setCreating] = useState(false);
  // Deep-link: land on a specific PO when arriving from an order's "Create PO"
  // / "View Pending PO" / "Ordered" button (?po=<id> or ?order=<orderId>), so
  // there's no hunting for it in the list. Applied once, then the param is
  // cleared so later manual selection isn't fought.
  const [searchParams, setSearchParams] = useSearchParams();
  const appliedDeepLink = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [consolidateOpen, setConsolidateOpen] = useState(false);
  // Cross-supplier price comparison for the selected draft PO. Keyed by PO id
  // so a stale result never bleeds onto a different PO.
  const [comparison, setComparison] = useState(null); // { forPoId, current, alternatives, best, savings }
  const [comparing, setComparing] = useState(false);
  const [receiving, setReceiving] = useState(false);

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
      try {
        const rows = await base44.entities.PurchaseOrder.filter({ shop_owner: shopScope(u) });
        setPos([...rows].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")));
      } catch (err) {
        notify.error("Couldn't load purchase orders", err);
      } finally {
        setLoading(false);
      }
    }).catch((err) => {
      notify.error("Couldn't load purchase orders", err);
      setLoading(false);
    });
  }, []);

  // Once POs are loaded, honor a ?po=<id> / ?order=<orderId> deep link by
  // opening that PO (right tab + selected), then strip the param so it's a
  // one-shot. Runs a single time.
  useEffect(() => {
    if (appliedDeepLink.current || loading) return;
    const poId = searchParams.get("po");
    const orderId = searchParams.get("order");
    if (!poId && !orderId) return;
    let match = poId ? pos.find((p) => p.id === poId) : null;
    if (!match && orderId) {
      match = pos.find(
        (p) =>
          p.status !== "cancelled" &&
          (p.source_order_id === orderId ||
            (Array.isArray(p.source_order_ids) && p.source_order_ids.includes(orderId))),
      );
    }
    if (match) {
      setTab(match.status === "submitted" ? "history" : "drafts");
      setSelectedId(match.id);
    }
    appliedDeepLink.current = true;
    const next = new URLSearchParams(searchParams);
    next.delete("po");
    next.delete("order");
    setSearchParams(next, { replace: true });
  }, [loading, pos, searchParams, setSearchParams]);

  // Suppliers actually present on this shop's POs — used to populate
  // the filter pills. Sorted alphabetically so the order is stable as
  // POs come and go.
  const supplierOptions = useMemo(() => {
    const set = new Set();
    for (const p of pos) if (p.supplier) set.add(p.supplier);
    return ["All", ...Array.from(set).sort()];
  }, [pos]);

  const visible = useMemo(() => {
    // History shows only SUBMITTED orders; "cancelled" (archived merge sources)
    // stay in the DB for the record but don't clutter either list.
    let list = tab === "drafts"
      ? pos.filter((p) => p.status === "draft")
      : pos.filter((p) => p.status === "submitted");
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
    if (!user || readOnly) return;
    setCreating(true);
    try {
      const defaults = {
        shop_owner: shopScope(user),
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
    if (!selected || readOnly) return;
    const updated = await base44.entities.PurchaseOrder.update(selected.id, patch);
    setPos((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  }

  // Price this draft PO through its candidate suppliers (S&S ↔ SanMar) and
  // stash the result so the detail can show a "you'd save $X through Y" callout.
  async function compareSuppliers(po = selected, { silent = false } = {}) {
    if (!po) return;
    setComparing(true);
    try {
      const cmp = await comparePoSuppliers(po, { thresholds });
      setComparison({ forPoId: po.id, ...cmp, savings: savingsVsCurrent(cmp) });
      // Refresh the draft's stored line prices to the current supplier's LIVE
      // (sale-aware) cost, so the subtotal is what you'll actually pay — not a
      // stale quote-time estimate. Only when that supplier prices every line.
      if (po.status === "draft" && !readOnly && cmp.current?.coversAll) {
        await repriceToLive(po, cmp.current);
      }
    } catch (err) {
      if (!silent) notify.error("Couldn't compare supplier pricing", err);
    } finally {
      setComparing(false);
    }
  }

  // Persist live unit prices onto a draft PO's items (only lines that actually
  // changed, never overwriting with a 0/unknown price). Silent — it just keeps
  // the number honest.
  async function repriceToLive(po, currentResult) {
    const lines = currentResult?.lines || [];
    let changed = false;
    const items = (po.items || []).map((it, i) => {
      const live = Number(lines[i]?.unitPrice) || 0;
      if (live > 0 && Math.abs(live - (Number(it.unitPrice) || 0)) > 0.005) {
        changed = true;
        return { ...it, unitPrice: live };
      }
      return it;
    });
    if (!changed) return;
    try {
      const updated = await base44.entities.PurchaseOrder.update(po.id, { items });
      setPos((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    } catch (e) {
      console.warn("[reprice] couldn't refresh live prices:", e);
    }
  }

  // Move the WHOLE PO to another supplier — re-prices every line at the target's
  // cost and re-stamps SKUs. Keeps it one PO, so pooling is preserved.
  async function switchSupplier(targetSupplier) {
    if (!selected || readOnly || !comparison || comparison.forPoId !== selected.id) return;
    const targetResult =
      comparison.best?.supplier === targetSupplier
        ? comparison.best
        : comparison.alternatives?.find((a) => a.supplier === targetSupplier);
    if (!targetResult) return;
    if (!confirm(`Switch this PO from ${selected.supplier} to ${targetSupplier}?\n\nEvery line is re-priced at ${targetSupplier}'s cost.`)) return;
    const items = repriceItemsForSupplier(selected.items, targetResult, targetSupplier);
    try {
      await patchSelected({ supplier: targetSupplier, items });
      setComparison(null); // stale after the switch; auto-compare re-fires
      notify.success(`Switched to ${targetSupplier} — re-priced at their cost.`);
    } catch (err) {
      notify.error("Couldn't switch supplier", err);
    }
  }

  // Auto-compare: the moment a draft S&S/SanMar PO with items is opened, price
  // it through both suppliers so the best option is shown WITHOUT a click.
  // Lookups are memoized in sourcingOptions, so re-opening is cheap. Skips AS
  // Colour (no cross-supplier identity) and anything already compared.
  useEffect(() => {
    if (!selected || selected.status !== "draft") return;
    if (!(selected.items?.length > 0)) return;
    if (candidateSuppliers(selected.supplier).length <= 1) return;
    if (comparison?.forPoId === selected.id) return;
    compareSuppliers(selected, { silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.supplier, selected?.items?.length, comparison?.forPoId]);

  // Tick "goods ordered" on EVERY order this PO covers — the scalar
  // source_order_id (single-order PO) AND source_order_ids (consolidated PO
  // batching several jobs). applyPOItemsToGoodsProgress matches each order's own
  // line items, so an order is only marked for the sizes it actually contributed.
  // Best-effort per order — a failure just leaves that Floor panel un-ticked.
  async function markGoodsOrderedOnSourceOrders(po, supplierOrderId) {
    const ids = new Set();
    if (po?.source_order_id) ids.add(String(po.source_order_id));
    for (const oid of Array.isArray(po?.source_order_ids) ? po.source_order_ids : []) {
      if (oid) ids.add(String(oid));
    }
    for (const oid of ids) {
      try {
        const sourceOrder = await base44.entities.Order.get(oid);
        if (sourceOrder) {
          const newChecklist = applyPOItemsToGoodsProgress(sourceOrder, po.items, supplierOrderId);
          await base44.entities.Order.update(oid, { checklist: newChecklist });
        }
      } catch (autoMarkErr) {
        console.warn("[PO submit] goods auto-mark failed for order", oid, autoMarkErr);
      }
    }
  }

  async function deleteSelected() {
    if (!selected || readOnly) return;
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
    if (!user || readOnly || mergeSelection.size < 2) return;
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
      // CANCEL the sources rather than delete them (audit B7): no data loss,
      // and a cancelled PO can't be submitted — so a partial failure can never
      // leave the merged draft AND a still-submittable original, which would
      // place a DUPLICATE supplier order. Only remove the ones that actually
      // cancelled from the list; report any that didn't so the shop can clear
      // them by hand.
      const results = await Promise.allSettled(
        sources.map((s) => base44.entities.PurchaseOrder.update(s.id, { status: "cancelled" })),
      );
      const cancelledIds = new Set();
      const failedRefs = [];
      sources.forEach((s, i) => {
        if (results[i].status === "fulfilled") cancelledIds.add(s.id);
        else failedRefs.push(s.reference || s.id);
      });
      setPos((prev) => [created, ...prev.filter((p) => !cancelledIds.has(p.id))]);
      setSelectedId(created.id);
      setMergeMode(false);
      setMergeSelection(new Set());
      if (failedRefs.length) {
        notify.error(
          "Merged, but couldn't archive some originals",
          `Still open: ${failedRefs.join(", ")}. Delete them so you don't order twice.`,
        );
      }
    } catch (err) {
      notify.error("Merge failed", err);
    } finally {
      setMerging(false);
    }
  }

  // Merge `selected` INTO targetPO: combine items (mergeItem dedupes
  // SKUs, sums quantities), update target, delete source. Destination's
  // ship_to / shipping_method / notes are kept as-is.
  async function mergeSelectedInto(targetPO) {
    if (!selected || !targetPO || readOnly) return;
    const sourceLabel = selected.reference || "this draft";
    const destLabel = targetPO.reference || "the destination";
    if (!confirm(
      `Merge "${sourceLabel}" into "${destLabel}"?\n\n` +
      `${selected.items?.length || 0} item(s) will move into "${destLabel}". ` +
      `Duplicate SKUs are summed. "${sourceLabel}" is archived afterwards.`,
    )) return;
    setMergeOpen(false);
    const mergedItems = mergePOItems(selected.items, targetPO.items);
    // Carry the SOURCE's order linkage into the target too (B7 dropped it), so
    // the target still ticks every covered order on submit. Union both sides'
    // scalar + array links.
    const mergedOrderIds = [...new Set([
      ...(targetPO.source_order_id ? [String(targetPO.source_order_id)] : []),
      ...(Array.isArray(targetPO.source_order_ids) ? targetPO.source_order_ids.map(String) : []),
      ...(selected.source_order_id ? [String(selected.source_order_id)] : []),
      ...(Array.isArray(selected.source_order_ids) ? selected.source_order_ids.map(String) : []),
    ].filter(Boolean))];
    const updated = await base44.entities.PurchaseOrder.update(targetPO.id, {
      items: mergedItems,
      source_order_ids: mergedOrderIds,
    });
    // Cancel (not delete) the source — no data loss, and a cancelled PO can't be
    // submitted, so it can't become a duplicate of the merged order (B7).
    try {
      await base44.entities.PurchaseOrder.update(selected.id, { status: "cancelled" });
      setPos((prev) => prev.filter((p) => p.id !== selected.id).map((p) => (p.id === updated.id ? updated : p)));
    } catch {
      setPos((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      notify.error("Merged, but couldn't archive the original", `"${sourceLabel}" is still open — delete it so you don't order twice.`);
    }
    setSelectedId(updated.id);
  }

  // ── Receiving ──────────────────────────────────────────────────────────
  // "Received" (PO-level) — the shipment showed up. Separate from check-in.
  async function toggleReceived(on) {
    if (!selected || readOnly) return;
    setReceiving(true);
    try {
      await patchSelected({ received_at: on ? new Date().toISOString() : null });
    } finally {
      setReceiving(false);
    }
  }

  // Reconcile a PO's checked-in counts to every covered order's floor panel:
  // mark matching sizes 'received' with the count, and (single-order PO only)
  // record under-receipts as _shortfall so Reorder Shortfall can top them up.
  async function reconcileCheckIn(po) {
    const ids = [
      ...new Set([po.source_order_id, ...(Array.isArray(po.source_order_ids) ? po.source_order_ids : [])]
        .filter(Boolean)
        .map(String)),
    ];
    const single = ids.length === 1;
    for (const oid of ids) {
      try {
        const order = await base44.entities.Order.get(oid);
        if (order) await base44.entities.Order.update(oid, applyCheckInToOrder(order, po.items, { computeShortfall: single }));
      } catch (e) {
        console.warn("[PO check-in] reconcile failed for order", oid, e);
      }
    }
  }

  // "Checked in" (per line) — count the garments in. Stores the count on the PO
  // item, then reconciles the covered orders' floor.
  async function checkInItem(index, count) {
    if (!selected || readOnly) return;
    setReceiving(true);
    try {
      const items = setItemCheckedIn(selected.items, index, count);
      const updated = await base44.entities.PurchaseOrder.update(selected.id, { items });
      setPos((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      await reconcileCheckIn(updated);
    } catch (err) {
      notify.error("Couldn't check in that line", err);
    } finally {
      setReceiving(false);
    }
  }

  async function submitSelected() {
    if (!selected || readOnly) return;
    // SanMar PO submission ships DORMANT: the smPlaceOrder edge function is
    // hard-gated by the SANMAR_PO_ENABLED secret and the submitPO schema is
    // still being verified against SanMar's WSDL. Until the frontend flag
    // (VITE_SANMAR_PO_ENABLED) is turned on, keep the current UX exactly —
    // an immediate "place it directly, then Mark submitted" note, no dialog.
    // The edge function is the real safety gate (returns needsManual); this
    // flag just avoids a misleading confirm during the pending window.
    if (selected.supplier === SUPPLIERS.SANMAR && import.meta.env.VITE_SANMAR_PO_ENABLED !== "true") {
      setSubmitError("SanMar orders can't be placed through InkTracker yet — order it directly with SanMar, then use “Mark submitted”.");
      return;
    }
    const errors = validateForSubmit(selected, selected.supplier);
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
      // idempotencyKey = the PO's stable UUID, so a double-submit / retry
      // can't place a second real order (audit INT-02). Payload shape differs
      // per supplier (AS Colour vs S&S vs SanMar).
      let base;
      if (selected.supplier === SUPPLIERS.SS) base = buildSsSubmitPayload(selected);
      else if (selected.supplier === SUPPLIERS.SANMAR) base = buildSmSubmitPayload(selected);
      else base = buildSubmitPayload(selected);
      const payload = { ...base, idempotencyKey: selected.id };
      const result = await placeOrder(selected.supplier, payload);
      // Defense in depth: even with the frontend flag on, the edge function
      // returns { needsManual: true } while its own SANMAR_PO_ENABLED secret
      // is off. Treat that as "nothing was placed" — show the note, don't
      // mark the PO submitted.
      if (result?.needsManual) {
        setSubmitError(result.message || "This supplier order must be placed directly, then marked submitted.");
        return;
      }
      // AS Colour returns order.id; S&S returns order.orderNumber/OrderNumber/orderId;
      // SanMar returns order.poNumber.
      const o = result?.order || {};
      const rawId = o.id ?? o.orderNumber ?? o.OrderNumber ?? o.orderId ?? o.poNumber ?? null;
      const supplierOrderId = rawId != null ? String(rawId) : null;
      await patchSelected({
        status: "submitted",
        supplier_order_id: supplierOrderId,
        submit_response: result ?? null,
        submitted_at: new Date().toISOString(),
      });
      // Auto-mark matching sizes as "ordered" on every covered order's Floor
      // Mode panel (single-order and consolidated). Non-fatal — the operator
      // can still toggle manually if a patch fails.
      await markGoodsOrderedOnSourceOrders(selected, supplierOrderId);
    } catch (err) {
      setSubmitError(err?.message || "Order submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  // Mark a PO submitted WITHOUT calling the supplier API — for when the
  // operator placed the order themselves (e.g. downloaded the CSV and pasted
  // it into AS Colour's Order Assistant). Only requires items; skips the
  // shipping-method / ship-to validation that the API submit needs, since
  // those were handled in the supplier's tool. Still runs the source-order
  // goods auto-mark so the Floor panel reflects the order.
  async function markSubmittedManually() {
    if (!selected || readOnly) return;
    if (!Array.isArray(selected.items) || selected.items.length === 0) {
      setSubmitError("Add at least one item before marking this PO submitted.");
      return;
    }
    if (!confirm(`Mark "${selected.reference}" as submitted?\n\nUse this when you've already placed this order yourself (e.g. via the downloaded CSV / Order Assistant). Nothing is sent to ${selected.supplier} — it just marks the PO complete.`)) {
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      await patchSelected({
        status: "submitted",
        submitted_at: new Date().toISOString(),
        submit_response: { manual: true },
      });
      await markGoodsOrderedOnSourceOrders(selected, null);
    } catch (err) {
      setSubmitError(err?.message || "Couldn't mark as submitted");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <ListCardsSkeleton rows={6} />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Purchase Orders</h2>
          <p className="text-sm text-slate-500 mt-0.5">
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
              disabled={readOnly}
              title={readOnly ? reason : undefined}
              className={`flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-xl transition border disabled:opacity-50 disabled:cursor-not-allowed ${
                mergeMode
                  ? "bg-teal-50 border-teal-300 text-teal-700"
                  : "bg-white border-slate-200 text-slate-600 hover:border-teal-300"
              }`}
            >
              <GitMerge className="w-4 h-4" /> {mergeMode ? "Exit merge mode" : "Merge POs"}
            </button>
          )}
          <ReactivateLink show={readOnly} href={reactivateHref} />
          <button
            onClick={() => setConsolidateOpen(true)}
            disabled={readOnly}
            title={readOnly ? reason : "Order blanks for all open jobs in one PO per supplier"}
            className="flex items-center gap-1.5 border border-teal-600 text-teal-700 hover:bg-teal-50 text-sm font-semibold px-3 py-2 rounded-xl transition disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <PackageCheck className="w-4 h-4" /> Consolidate buying
          </button>
          <button
            onClick={createDraft}
            disabled={creating || readOnly}
            title={readOnly ? reason : undefined}
            className="flex items-center gap-1.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-3 py-2 rounded-xl transition shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
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
                  ? "bg-teal-600 border-teal-600 text-white"
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
                ? "text-teal-600 border-b-2 border-teal-600 -mb-px"
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
            <div className="text-sm text-slate-500 bg-white border border-slate-100 rounded-xl p-6 text-center">
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
                    ? "border-teal-500 ring-2 ring-teal-200"
                    : isSel
                      ? "border-teal-400 ring-2 ring-teal-100"
                      : "border-slate-100 hover:border-slate-300"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0 flex-1">
                    {mergeMode && (
                      <div className={`mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                        isChecked
                          ? "bg-teal-600 border-teal-600"
                          : "border-slate-300 bg-white"
                      }`}>
                        {isChecked && <Check className="w-3 h-3 text-white" />}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-sm text-slate-800 truncate">{po.reference || "Untitled PO"}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
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
                        className={`h-full transition-all ${fp.qualifies ? "bg-emerald-500" : "bg-teal-500"}`}
                        style={{ width: `${fp.percentage}%` }}
                      />
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1">
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
            <div className="text-sm text-slate-500 bg-white border border-slate-100 rounded-xl p-10 text-center">
              Select a PO to view details, or click <strong>New PO</strong>.
            </div>
          ) : (
            <PoDetail
              po={selected}
              readOnly={readOnly}
              reason={reason}
              reactivateHref={reactivateHref}
              defaultWarehouse={user?.default_ac_warehouse || "CA"}
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
              onItemSku={(idx, sku) => {
                const next = [...selected.items];
                next[idx] = { ...next[idx], sku };
                patchSelected({ items: next });
              }}
              onDelete={deleteSelected}
              onSubmit={submitSelected}
              onMarkSubmitted={markSubmittedManually}
              onDismissError={() => setSubmitError(null)}
              receiving={receiving}
              onToggleReceived={toggleReceived}
              onCheckInItem={checkInItem}
              comparison={comparison?.forPoId === selected.id ? comparison : null}
              comparing={comparing}
              onCompareSuppliers={compareSuppliers}
              onSwitchSupplier={switchSupplier}
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
            disabled={mergeSelection.size < 2 || merging || readOnly}
            title={readOnly ? reason : undefined}
            className="flex items-center gap-1.5 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition"
          >
            {merging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitMerge className="w-3.5 h-3.5" />}
            Merge {mergeSelection.size >= 2 ? mergeSelection.size : ""}
          </button>
        </div>
      )}

      {consolidateOpen && (
        <ConsolidateBuyingModal
          user={user}
          existingPos={pos}
          onClose={() => setConsolidateOpen(false)}
          onCreated={(created, info = {}) => {
            setPos((prev) => [created, ...prev]);
            setSelectedId(created.id);
            setTab("drafts");
            setConsolidateOpen(false);
            const missing = (info.unresolved?.length || 0) + (info.lookupErrors?.length || 0);
            notify.success(
              "Consolidated draft PO created",
              missing
                ? `${created.items.length} line(s) added. ${missing} item(s) didn't resolve — add them on the PO.`
                : "Review and submit it below.",
            );
          }}
        />
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

function PoDetail({ po, readOnly = false, reason = "", reactivateHref, defaultWarehouse = "CA", threshold, submitting, submitError, shippingMethods, shippingMethodsLoading, shippingMethodsError, mergeTargets, mergeOpen, onMergeOpen, onMergeClose, onMergeInto, onPatch, onItemRemove, onItemQty, onItemSku, onDelete, onSubmit, onMarkSubmitted, onDismissError, receiving = false, onToggleReceived, onCheckInItem, comparison = null, comparing = false, onCompareSuppliers, onSwitchSupplier }) {
  const subtotal = poSubtotal(po.items);
  const fp = freightProgress(po.items, threshold);
  const isLocked = po.status !== "draft";
  // Editing is off when the PO is already submitted (isLocked) OR the
  // shop is read-only. `isLocked` HIDES edit UI (submitted POs); when the
  // shop is merely read-only on a still-editable draft we keep the fields
  // visible but DISABLED with a reactivate hint. `editDisabled` gates the
  // form inputs; the action buttons OR readOnly into their own disabled.
  const editDisabled = isLocked || readOnly;

  return (
    <div className="bg-white border border-slate-100 rounded-xl p-5 space-y-5">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <BlurField
            key={`${po.id}-reference`}
            value={po.reference || ""}
            onCommit={(v) => onPatch({ reference: v })}
            disabled={editDisabled}
            title={readOnly && !isLocked ? reason : undefined}
            maxLength={!isLocked && po.supplier === "AS Colour" ? AC_REFERENCE_MAX : undefined}
            className={`text-lg font-bold bg-transparent border-b border-transparent hover:border-slate-200 focus:border-teal-400 focus:outline-none w-full disabled:text-slate-500 ${
              (po.reference || "").length > AC_REFERENCE_MAX && po.supplier === "AS Colour" && !isLocked
                ? "text-red-600"
                : "text-slate-800"
            }`}
            placeholder="PO reference"
          />
          {!isLocked && po.supplier === "AS Colour" && (
            <div className={`text-[10px] mt-0.5 ${
              (po.reference || "").length > AC_REFERENCE_MAX ? "text-red-500" : "text-slate-500"
            }`}>
              {(po.reference || "").length}/{AC_REFERENCE_MAX} (AS Colour limit)
            </div>
          )}
          {/* Supplier — editable while the PO is a draft so one "New PO" can
              target any supplier (defaults to AS Colour on create). Locked
              once submitted. Changing it re-evaluates the connection banner
              and the supplier's shipping methods. */}
          {!isLocked ? (
            <label className="flex items-center gap-1.5 mt-1.5 text-xs font-semibold text-slate-500">
              Supplier:
              <select
                value={po.supplier}
                onChange={(e) => onPatch({ supplier: e.target.value })}
                disabled={editDisabled}
                title={readOnly ? reason : undefined}
                className="text-xs font-semibold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {Object.values(SUPPLIERS).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
          ) : (
            <div className="mt-1 text-xs font-semibold text-slate-500">{po.supplier}</div>
          )}
        </div>
        {!isLocked && (
          <div className="flex items-center gap-1 relative">
            <ReactivateLink show={readOnly} href={reactivateHref} className="mr-1" />
            {mergeTargets?.length > 0 && (
              <>
                <button
                  onClick={onMergeOpen}
                  disabled={readOnly}
                  title={readOnly ? reason : "Combine this draft into another draft to hit free freight"}
                  className="text-slate-500 hover:text-teal-600 p-1.5 rounded-lg hover:bg-teal-50 disabled:opacity-50 disabled:cursor-not-allowed"
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
            <button
              onClick={onDelete}
              disabled={readOnly}
              title={readOnly ? reason : undefined}
              className="text-slate-500 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
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
              className={`h-full transition-all ${fp.qualifies ? "bg-emerald-500" : "bg-teal-500"}`}
              style={{ width: `${fp.percentage}%` }}
            />
          </div>
        </div>
      )}

      {/* Add items picker */}
      {!isLocked && (
        <AddItemsPanel
          supplier={po.supplier}
          defaultWarehouse={defaultWarehouse}
          disabled={readOnly}
          disabledReason={reason}
          onAddItems={(updater) => onPatch({ items: typeof updater === "function" ? updater(po.items || []) : updater })}
        />
      )}

      {/* Items */}
      <div>
        <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Items</div>
        {/* Cross-supplier price comparison — auto-runs for S&S/SanMar drafts
            with items (they share brand style numbers, so each is a real
            alternative). Prices the WHOLE PO through both (sale- + freight-
            aware) and, if the other is a better total, offers a whole-PO switch
            (keeps it one PO → pooling intact). */}
        {!isLocked && po.items?.length > 0 && candidateSuppliers(po.supplier).length > 1 && (
          <div className="mb-3">
            {!comparison ? (
              comparing ? (
                <div className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking best price across S&S & SanMar…
                </div>
              ) : (
                <button
                  type="button"
                  onClick={onCompareSuppliers}
                  disabled={readOnly}
                  title={readOnly ? reason : undefined}
                  className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50 disabled:opacity-60"
                >
                  <Scale className="w-3.5 h-3.5" /> Compare supplier pricing
                </button>
              )
            ) : comparison.savings ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                <div className="flex items-start gap-2.5">
                  <TrendingDown className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
                  <div className="flex-1 text-sm text-emerald-900">
                    <div className="font-bold">
                      Order through {comparison.savings.supplier} and save {fmtMoney(comparison.savings.totalSaved)}
                      {comparison.savings.perPiece > 0 && <span className="font-semibold"> ({fmtMoney(comparison.savings.perPiece)}/pc)</span>}
                    </div>
                    <div className="text-emerald-800 text-xs mt-0.5">
                      {fmtMoney(comparison.savings.altTotal)} through {comparison.savings.supplier} vs {fmtMoney(comparison.savings.currentTotal)} here ({po.supplier}).
                      {comparison.best?.hasSale && <span className="font-semibold"> {comparison.savings.supplier}&apos;s sale price applied.</span>}
                    </div>
                    {/* Freight-aware caution: the goods-cheaper supplier might not
                        clear free freight while the current one does (pooling). */}
                    {comparison.best?.clearsFreight === false && comparison.current?.clearsFreight === true && (
                      <div className="text-amber-700 text-xs mt-1 flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5" />
                        {comparison.savings.supplier} is {fmtMoney(comparison.best.freightGap)} short of free freight; {po.supplier} clears it — shipping may erase the savings.
                      </div>
                    )}
                    {comparison.best?.clearsFreight === true && (
                      <div className="text-emerald-700 text-xs mt-1 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Clears free freight at {comparison.savings.supplier}.
                      </div>
                    )}
                    {comparison.savings.shortStock?.length > 0 && (
                      <div className="text-amber-700 text-xs mt-1 flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5" />
                        {comparison.savings.shortStock.length} line{comparison.savings.shortStock.length === 1 ? "" : "s"} may be low/out of stock at {comparison.savings.supplier} — check before switching.
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onSwitchSupplier(comparison.savings.supplier)}
                    disabled={readOnly}
                    className="shrink-0 inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-60"
                  >
                    <Truck className="w-3.5 h-3.5" /> Switch to {comparison.savings.supplier}
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                <div>
                  <span className="font-semibold text-slate-700">{po.supplier} is your cheapest option</span> for these items
                  {comparison.current && comparison.current.total > 0 && (
                    <> at {fmtMoney(comparison.current.total)}
                      {comparison.current.perPiece > 0 && <span> ({fmtMoney(comparison.current.perPiece)}/pc)</span>}
                      {comparison.current.hasSale && <span className="font-semibold text-emerald-700"> — sale price applied</span>}
                      {comparison.current.clearsFreight === true && <span className="text-emerald-700"> · clears free freight ✓</span>}
                      {comparison.current.clearsFreight === false && comparison.current.freightGap > 0 && <span className="text-amber-700"> · {fmtMoney(comparison.current.freightGap)} from free freight</span>}
                    </>
                  )}.
                  {comparison.alternatives?.some((a) => a.coversAll) && (() => {
                    const alt = comparison.alternatives.filter((a) => a.coversAll).sort((a, b) => a.total - b.total)[0];
                    return alt ? <span className="text-slate-500"> {alt.supplier} would be {fmtMoney(alt.total)}{alt.hasSale ? " (incl. their sale)" : ""}.</span> : null;
                  })()}
                  {comparison.alternatives?.some((a) => !a.coversAll) && (
                    <span className="text-slate-500"> ({comparison.alternatives.filter((a) => !a.coversAll).map((a) => a.supplier).join(", ")} doesn&apos;t carry every line.)</span>
                  )}
                  <button type="button" onClick={onCompareSuppliers} disabled={comparing} className="ml-2 text-xs font-semibold text-teal-700 hover:underline disabled:opacity-60">re-check</button>
                </div>
              </div>
            )}
          </div>
        )}
        {!po.items?.length ? (
          <div className="text-sm text-slate-500 border border-dashed border-slate-200 rounded-lg p-6 text-center">
            No items yet. Look up a style above, or generate the PO from an order.
          </div>
        ) : (
          <div className="border border-slate-100 rounded-lg overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-slate-50 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                <tr>
                  <th className="text-left px-3 py-2">SKU</th>
                  <th className="text-left px-3 py-2">Color / Size</th>
                  <th className="text-center px-2 py-2">WH</th>
                  <th className="text-right px-3 py-2">Qty</th>
                  <th className="text-right px-3 py-2">Unit</th>
                  <th className="text-right px-3 py-2">Line</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {po.items.map((it, i) => (
                  <tr key={`${it.sku}-${it.warehouse ?? ""}-${i}`}>
                    <td className="px-3 py-2 font-mono text-xs">
                      {isLocked ? (
                        <span className="text-slate-700">{it.sku}</span>
                      ) : (
                        <input
                          value={it.sku || ""}
                          onChange={(e) => onItemSku(i, e.target.value)}
                          disabled={editDisabled}
                          title={readOnly ? reason : undefined}
                          className="w-full font-mono text-xs text-slate-700 border border-slate-200 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-teal-300 disabled:opacity-60 disabled:cursor-not-allowed"
                          placeholder="e.g. 5102-WHI_M-H-M"
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{[it.color, it.size].filter(Boolean).join(" · ")}</td>
                    <td className="px-2 py-2 text-center">
                      {isLocked ? (
                        <span className="text-[10px] font-bold text-slate-600">{it.warehouse || defaultWarehouse}</span>
                      ) : (
                        <select
                          value={it.warehouse || defaultWarehouse}
                          onChange={(e) => {
                            const next = [...po.items];
                            next[i] = { ...next[i], warehouse: e.target.value };
                            onPatch({ items: next });
                          }}
                          disabled={editDisabled}
                          className={`text-[10px] font-bold rounded px-1 py-0.5 border disabled:opacity-60 disabled:cursor-not-allowed ${
                            it.warehouse && it.warehouse !== defaultWarehouse
                              ? "border-amber-300 bg-amber-50 text-amber-700"
                              : "border-slate-200 bg-white text-slate-700"
                          }`}
                          title={
                            readOnly
                              ? reason
                              : it.warehouse && it.warehouse !== defaultWarehouse
                                ? `Routed to ${it.warehouse} (default is ${defaultWarehouse})`
                                : `Default warehouse ${defaultWarehouse}`
                          }
                        >
                          <option value="CA">CA</option>
                          <option value="NC">NC</option>
                        </select>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {isLocked ? (
                        it.quantity
                      ) : (
                        <input
                          type="number"
                          min="0"
                          value={it.quantity}
                          onChange={(e) => onItemQty(i, e.target.value)}
                          disabled={editDisabled}
                          title={readOnly ? reason : undefined}
                          className="w-16 text-right border border-slate-200 rounded px-1.5 py-0.5 disabled:opacity-60 disabled:cursor-not-allowed"
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
                          disabled={readOnly}
                          title={readOnly ? reason : undefined}
                          className="text-slate-300 hover:text-red-500 p-1 disabled:opacity-50 disabled:cursor-not-allowed"
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
                  <td colSpan={5} className="px-3 py-2 text-right text-slate-500">Subtotal</td>
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
          <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Ship to</div>
          <ShipToEditor
            key={`${po.id}-shipto`}
            value={po.ship_to || {}}
            disabled={editDisabled}
            title={readOnly ? reason : undefined}
            onChange={(ship_to) => onPatch({ ship_to })}
          />
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">Shipping method</label>
            <select
              value={po.shipping_method || ""}
              onChange={(e) => onPatch({ shipping_method: e.target.value })}
              disabled={editDisabled || shippingMethodsLoading}
              title={readOnly ? reason : undefined}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white disabled:opacity-60 disabled:cursor-not-allowed"
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
          {/* Warehouse is now routed per-item based on stock availability
              (see auto-routing in AddItemsPanel + ACOrderModal). The
              shop's default warehouse comes from Account → Default AS
              Colour warehouse. Items show their routed warehouse next
              to the SKU. */}
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">Order notes</label>
            <BlurField
              textarea
              key={`${po.id}-notes`}
              value={po.notes || ""}
              onCommit={(v) => onPatch({ notes: v })}
              disabled={editDisabled}
              title={readOnly ? reason : undefined}
              rows={2}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 disabled:opacity-60 disabled:cursor-not-allowed"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">Courier instructions</label>
            <BlurField
              textarea
              key={`${po.id}-courier`}
              value={po.courier_instructions || ""}
              onCommit={(v) => onPatch({ courier_instructions: v })}
              disabled={editDisabled}
              title={readOnly ? reason : undefined}
              rows={2}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 disabled:opacity-60 disabled:cursor-not-allowed"
            />
          </div>
        </div>
      </div>

      {/* Submit / status */}
      {isLocked ? (
        <div className="space-y-3">
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-800 space-y-2">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                Submitted to {po.supplier}
                {po.supplier_order_id && <> · supplier order ID <code className="font-mono">{po.supplier_order_id}</code></>}
                {po.submitted_at && <> · {new Date(po.submitted_at).toLocaleString()}</>}
              </div>
              {po.supplier_order_id && po.supplier === "AS Colour" && (
                <VerifyOrderButton orderId={po.supplier_order_id} />
              )}
            </div>
          </div>
          {po.status === "submitted" && (
            <POReceivingPanel
              po={po}
              readOnly={readOnly}
              busy={receiving}
              onToggleReceived={onToggleReceived}
              onCheckInItem={onCheckInItem}
            />
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <SupplierConnectionBanner supplier={po.supplier} />
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
            disabled={submitting || readOnly}
            title={readOnly ? reason : undefined}
            className="w-full flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-700 text-white font-semibold px-4 py-2.5 rounded-xl transition disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />}
            Submit to {po.supplier}
          </button>
          {/* Manual completion path — for operators who placed the order
              themselves (CSV / Order Assistant) and just need the PO marked
              done. No API call. */}
          <button
            onClick={onMarkSubmitted}
            disabled={submitting || readOnly}
            title={readOnly ? reason : "Already placed this order yourself (CSV / Order Assistant)? Mark it submitted without sending anything to the supplier."}
            className="w-full flex items-center justify-center gap-2 text-sm font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 hover:border-slate-300 px-4 py-2 rounded-xl transition disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <CheckCircle2 className="w-4 h-4" />
            Mark as Submitted (ordered manually)
          </button>
          <div className="flex justify-center">
            <ReactivateLink show={readOnly} href={reactivateHref} />
          </div>
        </div>
      )}

      {/* Download CSV — works for both draft and submitted POs.
          Operators paste/upload the file into AS Colour's Order
          Assistant (or any supplier tool that accepts CSV). Lives
          outside the lock branch so a shop can re-download the
          file later — useful for audit trail or for re-submitting
          after a partial failure. */}
      {po.items?.length > 0 && (
        <button
          onClick={() => {
            const csv = buildPOCsv(po);
            if (!csv) return;
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = buildPOCsvFilename(po);
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }}
          className="w-full mt-2 flex items-center justify-center gap-2 text-sm font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 hover:border-slate-300 px-4 py-2 rounded-xl transition"
          title={
            po.supplier === "AS Colour"
              ? "Download CSV to paste into AS Colour's Order Assistant"
              : "Download CSV (Style, Color, Size, Quantity, SKU) for supplier paste / email"
          }
        >
          <Download className="w-4 h-4" />
          Download CSV for Order Assistant
        </button>
      )}
    </div>
  );
}

function ShipToEditor({ value, disabled, title, onChange }) {
  function field(key, placeholder, { required } = {}) {
    const isMissing = required && !value[key];
    return (
      <BlurField
        value={value[key] || ""}
        onCommit={(v) => onChange({ ...value, [key]: v })}
        disabled={disabled}
        title={title}
        placeholder={required ? `${placeholder} *` : placeholder}
        className={`w-full text-sm border rounded-lg px-2.5 py-1.5 disabled:opacity-60 disabled:cursor-not-allowed ${
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
      <div className="text-[10px] text-slate-500">* required by AS Colour</div>
    </div>
  );
}

// Click → GET /v1/orders/{id} against AS Colour, show whether the
// order really lives there + which account email it's under. Critical
// for "AS Colour says they don't see my order" debugging.
function VerifyOrderButton({ orderId }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function verify() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke("acGetOrder", {
        body: { id: orderId },
      });
      if (invokeErr) {
        // FunctionsHttpError — read the wrapped body so AS Colour's
        // actual rejection surfaces (e.g. 404 if the order doesn't exist).
        const ctxRes = (invokeErr.context && typeof invokeErr.context.text === "function")
          ? invokeErr.context
          : invokeErr.context?.response;
        if (ctxRes?.text) {
          const body = await ctxRes.text().catch(() => "");
          let parsed = null;
          try { parsed = JSON.parse(body); } catch {}
          throw new Error(parsed?.error || body || invokeErr.message);
        }
        throw invokeErr;
      }
      setResult(data);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={verify}
        disabled={loading}
        className="text-[11px] font-semibold px-2 py-1 rounded-md bg-white border border-emerald-300 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
      >
        {loading ? "Checking…" : "Verify with AS Colour"}
      </button>
      {error && (
        <div className="text-[10px] text-red-600 max-w-xs text-right whitespace-pre-wrap">
          {error}
        </div>
      )}
      {result && (
        <div className="text-[10px] text-slate-700 bg-white border border-emerald-200 rounded p-2 max-w-md text-left whitespace-pre-wrap font-mono">
          <div className="font-bold not-italic mb-1">
            Account email: {result.accountEmail || "(not returned)"}
          </div>
          {JSON.stringify(result.order, null, 2)}
        </div>
      )}
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
                <div className="text-[11px] text-slate-500">
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
