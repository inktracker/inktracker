import { useState, useEffect, useMemo } from "react";
import AttachmentGallery from "../shared/AttachmentGallery";
import ArtworkPreviewOverlay from "../shared/ArtworkPreviewOverlay";
import SendInvoiceModal from "../invoices/SendInvoiceModal";
import { createPortal } from "react-dom";
import { base44, supabase } from "@/api/supabaseClient";
import CollapsibleSection from "../shared/CollapsibleSection";
import { buildShortfallReorderPayloads, totalOrderShortfall } from "@/lib/orders/shortfallReorder";
import { notify } from "@/lib/notify";
import { artApprovalUrl, orderStatusUrl } from "@/lib/publicUrls";
import {
  countGoodsProgress,
  autoCheckOrderGoodsTask,
  bulkSetOrderGoodsStep,
  nextGoodsStatusOnTap,
  unreceivedCount,
} from "@/lib/orderGoodsProgress";
import { normalizePresses, normalizeAssignedPress } from "@/lib/presses/normalizePresses";
import { Paperclip } from "lucide-react";
import {
  getDisplayName,
  O_STATUSES,
} from "../shared/pricing";
// Per-stage checklist tasks now live in src/lib/productionTasks.js so
// each shop can customize them via Account → Production Tasks. The
// helper falls back to the shipped defaults when a stage isn't
// customized. Auto-derived "Place blank order" / "Receive goods" on
// Order Goods only fire when those canonical names are in the list.
import { getStageTasks } from "@/lib/productionTasks";
import { todayInShopTz } from "@/lib/shopTimezone";
import OrderDetailHeader from "./orderDetail/OrderDetailHeader";
import OrderLineItems from "./orderDetail/OrderLineItems";
import FloorModePanel from "./orderDetail/FloorModePanel";
import OrderShippingSection from "./orderDetail/OrderShippingSection";
import OrderJobCostSection from "./orderDetail/OrderJobCostSection";
import OrderInvoiceActions from "./orderDetail/OrderInvoiceActions";
import OrderUtilityActions from "./orderDetail/OrderUtilityActions";
import OrderMessagesSection from "./orderDetail/OrderMessagesSection";
import { useOrderShipping } from "./orderDetail/useOrderShipping";
import { useOrderInvoice } from "./orderDetail/useOrderInvoice";
import { getNextStatus, getPreviousStatus, getOrderArtwork } from "./orderDetail/orderDetailHelpers";

export default function OrderDetailModal({
  order,
  // The Customer entity for this order (parent looks it up via
  // customers[order.customer_id]). Passed in so the header / client
  // chip can show company first, falling back to contact name —
  // matching how QuoteDetailModal and the list views render.
  customer,
  onClose,
  onAdvance,
  onDelete,
  onComplete,
  onRevert,
  onTogglePaid,
  onOrderFromAC,
  // PO that was created from this order, if any. Drives the button's
  // tri-state: no PO → "Order from AS Colour"; draft PO → "View Pending PO";
  // submitted PO → "✓ Ordered". Parent fetches it (cheap lookup, scoped by
  // shop_owner + source_order_id index added in 20260526).
  sourcePO,
  // Called when the user clicks "Preview Invoice" for the already-
  // invoiced order. Receives the invoice row. The parent (Production /
  // Orders / Invoices / Calendar page) handles the modal display so we
  // avoid a circular import with InvoiceDetailModal.
  onShowInvoice,
  // Notifies the parent list of an in-place order update (e.g. attachment
  // add/remove) so reopening the modal doesn't re-seed from a stale order —
  // the "removed attachment comes back" bug.
  onUpdated,
}) {
  const [shopName, setShopName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [reordered, setReordered] = useState(false);
  const [copied, setCopied] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [localArtwork, setLocalArtwork] = useState(order.selected_artwork || []);
  // Read-only sync: artwork can land on the order from outside this
  // modal (Quote → art approval, customer upload via ArtApproval page).
  // Without this, a freshly-attached proof wouldn't appear until the
  // modal was closed and reopened.
  useEffect(() => { setLocalArtwork(order.selected_artwork || []); }, [order.selected_artwork]);
  // In-modal preview: when set, the order content is hidden behind an
  // overlay that renders the artwork inline (PDF/image) so the user
  // doesn't lose their place by bouncing to a new browser tab.
  const [previewArt, setPreviewArt] = useState(null);
  // Floor Mode collapsed state — persisted per-order so each shop can
  // remember whether they want the panel open by default. Defaults to
  // collapsed so users browsing for costs/status aren't hit with a
  // big panel they have to scroll past.
  const floorStorageKey = `order-floor-mode-collapsed-${order.id}`;
  const [floorCollapsed, setFloorCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem(floorStorageKey);
      if (stored === "false") return false;
      if (stored === "true")  return true;
    } catch (_) { /* ignore */ }
    return true;
  });
  useEffect(() => {
    try { localStorage.setItem(floorStorageKey, floorCollapsed ? "true" : "false"); }
    catch (_) { /* ignore */ }
  }, [floorStorageKey, floorCollapsed]);
  const [showJobCost, setShowJobCost] = useState(false);
  const [actualCost, setActualCost] = useState(order.actual_cost ?? "");
  const [laborHours, setLaborHours] = useState(order.actual_labor_hours ?? "");
  // Estimated press time — drives the Press Scheduler's capacity bar.
  // Distinct from actual labor hours (which gets stamped after the
  // job runs). Empty string when unset; saved as a number.
  const [estimatedHours, setEstimatedHours] = useState(order.estimated_hours ?? "");
  const [laborCost, setLaborCost] = useState(order.actual_labor_cost ?? "");
  // Normalize on initial read so a legacy JSON-string-shaped value
  // matches the dropdown options (which are plain press names).
  // Without this the <select> shows no selected value when the row
  // was written by the old `assigned_press: pressObject` writer.
  const [assignedPress, setAssignedPress] = useState(normalizeAssignedPress(order.assigned_press));
  const [assignedOperator, setAssignedOperator] = useState(order.assigned_operator || "");
  const [stepNotes, setStepNotes] = useState(order.step_notes || {});
  // Read-only sync: step notes are appended on every status change
  // (handleAdvance, updateStatus) and are visible in the timeline. If
  // the parent's order prop updates, the timeline should reflect the
  // new note instead of the snapshot taken at modal open.
  useEffect(() => { setStepNotes(order.step_notes || {}); }, [order.step_notes]);
  const [savingCost, setSavingCost] = useState(false);
  const [costSaved, setCostSaved] = useState(false);
  const [liveOrder, setLiveOrder] = useState(order);
  // Re-sync liveOrder whenever the parent passes a new order prop —
  // happens after auto-advance fires onAdvance and the parent's
  // setViewing(updated) feeds the fresh row back in. Without this,
  // Floor Mode renders the OLD stage's checklist forever because
  // useState only reads the prop on mount.
  useEffect(() => { setLiveOrder(order); }, [order]);
  // Related invoice + Create/Send flow — extracted into a hook.
  const {
    relatedInvoice,
    sendingInvoice, setSendingInvoice,
    sendCustomer,
    creatingInvoice,
    qbPushNote,
    lookupRelatedInvoice,
    handleCreateInvoice,
    handleOpenSend,
  } = useOrderInvoice({ order, customer, onComplete, callAction });
  // Shop-configured press list (Account → Production Setup) + this
  // shop's employees, used to populate the two Assigned dropdowns
  // below the cost fields. Empty arrays just mean the dropdown shows
  // no options — the UI gracefully falls back to a free-text input
  // when there's nothing to pick from.
  const [presses, setPresses] = useState([]);
  const [employees, setEmployees] = useState([]);

  // Shipping — FedEx state + handlers extracted into a hook.
  const {
    showShipping, setShowShipping,
    shipStreet, setShipStreet,
    shipCity, setShipCity,
    shipState, setShipState,
    shipZip, setShipZip,
    shipCountry, setShipCountry,
    shipWeight, setShipWeight,
    shipLength, setShipLength,
    shipWidth, setShipWidth,
    shipHeight, setShipHeight,
    shipService, setShipService,
    shipRates,
    loadingRates,
    creatingLabel,
    shipTracking,
    shipLabelUrl,
    shipStatus,
    savingShipping,
    shippingSaved,
    shipError,
    handleGetRates,
    handleCreateLabel,
    handleSaveShipping,
    handleTrackShipment,
  } = useOrderShipping(order);

  // Stage-complete check + auto-advance. Mirrors ShopFloor.jsx so the
  // two surfaces behave the same way: when every task in the current
  // stage is done (including auto-derived "Receive goods" from per-size
  // counts), kick the order to the next stage via onAdvance.
  //
  // Capped at Printing — the Printing → Completed transition involves
  // invoice creation downstream, so we make the operator press the
  // explicit "Order Status Complete →" button for that one and review
  // before the modal closes.
  function isStageComplete(order, stage) {
    const tasks = getStageTasks(stage);
    if (tasks.length === 0) return false;
    const stepChecks = order.checklist?.[stage] || {};
    const counts = countGoodsProgress(order);
    return tasks.every((task) => {
      const auto = autoCheckOrderGoodsTask(stage, task, counts);
      return auto === null ? !!stepChecks[task] : auto;
    });
  }

  function maybeAutoAdvance(order) {
    if (!onAdvance) return;
    const current = order.status || "Pre-Press";
    const idx = O_STATUSES.indexOf(current);
    if (idx < 0 || idx >= O_STATUSES.length - 1) return;
    if (!isStageComplete(order, current)) return;
    const next = O_STATUSES[idx + 1];
    if (next === "Completed") return;
    onAdvance(order.id);
  }

  async function floorToggleTask(task) {
    const step = liveOrder.status || "Pre-Press";
    const checklist = { ...(liveOrder.checklist || {}) };
    if (!checklist[step]) checklist[step] = {};
    checklist[step][task] = checklist[step][task] ? null : { by: shopName || "Admin", at: new Date().toISOString() };
    const updated = await base44.entities.Order.update(liveOrder.id, { checklist });
    setLiveOrder(prev => ({ ...prev, ...updated }));
    maybeAutoAdvance(updated);
  }

  async function floorTogglePrint(liIdx, size, impIdx) {
    const checklist = { ...(liveOrder.checklist || {}) };
    const pp = { ...(checklist.print_progress || {}) };
    const key = `${liIdx}-${size}-${impIdx}`;
    pp[key] = pp[key] ? null : { by: shopName || "Admin", at: new Date().toISOString() };
    checklist.print_progress = pp;
    const updated = await base44.entities.Order.update(liveOrder.id, { checklist });
    setLiveOrder(prev => ({ ...prev, ...updated }));
    maybeAutoAdvance(updated);
  }

  // Per-size goods tap — cycles blank → ordered → received → blank
  // (decision in lib/orderGoodsProgress). A `null` return from
  // nextGoodsStatusOnTap means "clear" — delete the entry so the
  // size goes back to blank.
  async function floorToggleGoods(liIdx, size) {
    const checklist = { ...(liveOrder.checklist || {}) };
    const gp = { ...(checklist.goods_progress || {}) };
    const key = `${liIdx}-${size}`;
    const next = nextGoodsStatusOnTap(gp[key]?.status);
    if (next === null) {
      delete gp[key];
    } else {
      gp[key] = { status: next, by: shopName || "Admin", at: new Date().toISOString() };
    }
    checklist.goods_progress = gp;
    const updated = await base44.entities.Order.update(liveOrder.id, { checklist });
    setLiveOrder(prev => ({ ...prev, ...updated }));
    maybeAutoAdvance(updated);
  }

  // Bulk override for the Order Goods parent tasks. Lets a shop whose
  // blanks don't flow through the AS Colour PO integration mark all
  // sizes as ordered/received in one click instead of tapping each.
  async function bulkOrderGoodsStep(target) {
    const checklist = { ...(liveOrder.checklist || {}) };
    checklist.goods_progress = bulkSetOrderGoodsStep(liveOrder, target, shopName || "Admin");
    const updated = await base44.entities.Order.update(liveOrder.id, { checklist });
    setLiveOrder(prev => ({ ...prev, ...updated }));
    maybeAutoAdvance(updated);
  }

  // Per-size shortfall tracking. Capacity isn't deducted from line.sizes
  // (that's the originally-quoted qty — Quote Snapshot Invariant); the
  // misprinted/lost count goes into _shortfall: { S: 1, M: 2 } on the
  // line item. getCompletedQty / getShortfallQty in pricing.jsx surface
  // the derived numbers. Pricing / invoice totals untouched — billing
  // adjustment for shortfall (credit / reorder) is a separate decision
  // (Phase B).
  // Phase B — Reorder Shortfall. Creates a draft PurchaseOrder
  // pre-populated with the shortfall items from this order. Shop
  // reviews + sends from /PurchaseOrders. Defaults supplier to AC
  // (operator can switch in the PO editor). Best-effort: failure
  // surfaces a notify.error; the shortfall data already persisted.
  const [reorderCreating, setReorderCreating] = useState(false);
  async function handleReorderShortfall() {
    const total = totalOrderShortfall(liveOrder);
    if (total === 0) return;
    if (reorderCreating) return;
    // Build per-supplier payloads up front so the confirm message
    // tells the operator exactly how many drafts they're about to
    // create. A mixed S&S + AC order will produce two POs — the
    // confirm copy needs to make that obvious before they click OK.
    const payloads = buildShortfallReorderPayloads(liveOrder, { email: liveOrder.shop_owner });
    if (payloads.length === 0) {
      notify.error("Nothing to reorder", "No shortfall recorded on this order.");
      return;
    }
    const supplierList = payloads.map((p) => p.supplier).join(" + ");
    const msg = payloads.length === 1
      ? `Create a draft purchase order for ${total} replacement piece${total === 1 ? "" : "s"}?\n\n` +
        `Supplier: ${supplierList}. You'll review and send it from the Purchase Orders page.`
      : `Create ${payloads.length} draft purchase orders for ${total} replacement pieces?\n\n` +
        `One PO per supplier: ${supplierList}. You'll review and send each from the Purchase Orders page.`;
    if (!window.confirm(msg)) return;
    setReorderCreating(true);
    try {
      const created = await Promise.all(
        payloads.map((p) => base44.entities.PurchaseOrder.create(p)),
      );
      const refs = created.map((c) => c.reference).join(", ");
      notify.success(
        created.length === 1 ? "Draft PO created" : `${created.length} draft POs created`,
        `In Purchase Orders → ${refs}.`,
      );
    } catch (err) {
      notify.error("Couldn't create reorder PO(s)", err);
    } finally {
      setReorderCreating(false);
    }
  }

  async function saveShortfall(lineItemId, size, rawValue) {
    const n = Math.max(0, parseInt(rawValue, 10) || 0);
    const nextLineItems = (liveOrder.line_items || []).map((li) => {
      if (li.id !== lineItemId) return li;
      const nextShortfall = { ...(li._shortfall || {}) };
      if (n === 0) {
        delete nextShortfall[size];
      } else {
        nextShortfall[size] = n;
      }
      return { ...li, _shortfall: nextShortfall };
    });
    // Optimistic local update so the input doesn't visibly bounce.
    setLiveOrder((prev) => ({ ...prev, line_items: nextLineItems }));
    try {
      const updated = await base44.entities.Order.update(liveOrder.id, { line_items: nextLineItems });
      setLiveOrder((prev) => ({ ...prev, ...updated }));
    } catch (err) {
      console.error("[saveShortfall] update failed:", err);
    }
  }

  // Soft-warn version of onAdvance. Override allowed for partial-ship.
  function advanceWithGoodsGuard() {
    if (!onAdvance) return;
    if (liveOrder.status === "Order Goods") {
      const missing = unreceivedCount(liveOrder);
      const total = countGoodsProgress(liveOrder).total;
      if (missing > 0) {
        const ok = window.confirm(
          `${missing} of ${total} sizes haven't been marked received.\n\nMove to Pre-Press anyway?`
        );
        if (!ok) return;
      }
    }
    // Keep the modal open as the order walks through the production
    // pipeline — parent's handleAdvance does setViewing(updated) so
    // the modal re-renders with the new status and the next pair of
    // prev/next buttons. Closing on every click made you lose your
    // place every time you advanced.
    return callAction(onAdvance, order.id);
  }

  async function handleSaveJobCost() {
    setSavingCost(true);
    try {
      const ac = parseFloat(actualCost) || 0;
      const lh = parseFloat(laborHours) || 0;
      const lc = parseFloat(laborCost) || 0;
      const eh = estimatedHours === "" ? null : parseFloat(estimatedHours);
      await base44.entities.Order.update(order.id, {
        actual_cost: ac,
        actual_labor_hours: lh,
        actual_labor_cost: lc,
        estimated_hours: Number.isFinite(eh) ? eh : null,
        assigned_press: assignedPress,
        assigned_operator: assignedOperator,
        step_notes: stepNotes,
      });
      setCostSaved(true);
      setTimeout(() => setCostSaved(false), 2000);
    } catch (err) {
      notify.error("Couldn't save job cost", err);
    } finally {
      setSavingCost(false);
    }
  }

  async function handleArtworkUpload(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true);
    setUploadError("");

    try {
      const newArtwork = [...(order.selected_artwork || [])];

      for (const file of files) {
        const ext = file.name.split(".").pop();
        const path = `${order.id}_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("artwork")
          .upload(path, file, { upsert: false });
        if (upErr) throw upErr;

        // The artwork bucket is private (M-1) — a getPublicUrl() here would 400.
        // `path` is the canonical reference; readers sign a URL from it directly.
        newArtwork.push({
          id: path,
          name: file.name,
          path,
          note: "",
          colors: "",
          source: "Uploaded to order",
        });
      }

      await base44.entities.Order.update(order.id, { selected_artwork: newArtwork });
      setLocalArtwork(newArtwork);
      onUpdated?.({ ...order, selected_artwork: newArtwork });
    } catch (err) {
      setUploadError(err.message || "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function removeArtwork(art) {
    const key = art?.id || art?.url || art?.name;
    const next = (localArtwork || []).filter((a) => (a.id || a.url || a.name) !== key);
    try {
      await base44.entities.Order.update(order.id, { selected_artwork: next });
      setLocalArtwork(next);
      onUpdated?.({ ...order, selected_artwork: next });
    } catch (err) {
      setUploadError(err?.message || "Couldn't remove attachment.");
    }
  }

  function copyLink(type) {
    // The token gates anonymous access. Customer must have this exact URL
    // (which we email them) to view art / order status. Always use the
    // customer-facing production domain — see lib/publicUrls.js.
    const url = type === "art"
      ? artApprovalUrl(order.id, order.public_token)
      : orderStatusUrl(order.id, order.public_token);
    navigator.clipboard.writeText(url).then(() => {
      setCopied(type);
      setTimeout(() => setCopied(null), 2000);
    }).catch(() => {});
  }

  async function handleReorder() {
    setSaving(true);
    try {
      const newQuoteId = `Q-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase().slice(-4)}`;
      await base44.entities.Quote.create({
        quote_id: newQuoteId,
        shop_owner: order.shop_owner,
        customer_id: order.customer_id || "",
        customer_name: order.customer_name || "",
        job_title: order.job_title || "",
        // Shop-tz, not UTC. Reorder quotes were stamping tomorrow's
        // date for any shop west of London past ~5pm local.
        date: todayInShopTz(),
        due_date: null,
        status: "Draft",
        notes: order.notes || "",
        rush_rate: order.rush_rate || 0,
        extras: order.extras || {},
        line_items: order.line_items || [],
        discount: order.discount || 0,
        discount_type: order.discount_type || "percent",
        tax_rate: order.tax_rate || 0,
        deposit_pct: 50,
        deposit_paid: false,
      });
      setReordered(true);
      setTimeout(() => setReordered(false), 3000);
    } catch (err) {
      notify.error("Reorder failed", err);
    } finally {
      setSaving(false);
    }
  }

  async function callAction(fn, ...args) {
    if (!fn) return;
    setSaving(true);
    try {
      await fn(...args);
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    base44.auth
      .me()
      .then((u) => {
        if (u) {
          setShopName(u.shop_name || "");
          setLogoUrl(u.logo_url || "");
        }
      })
      .catch(() => {});
  }, []);

  // Load the shop's configured press list + this shop's employees so
  // the two Assigned dropdowns have real options. Best-effort — empty
  // arrays just collapse the dropdowns to "no options" + fall back to
  // a free-text input so the field still works.
  useEffect(() => {
    if (!order?.shop_owner) { setPresses([]); setEmployees([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const { data: shop } = await supabase
          .from("shops")
          .select("presses")
          .eq("owner_email", order.shop_owner)
          .maybeSingle();
        if (!cancelled) setPresses(normalizePresses(shop?.presses));
      } catch {
        if (!cancelled) setPresses([]);
      }
      try {
        const all = await base44.entities.User.list();
        if (cancelled) return;
        // Pull employees + managers — both are eligible to run a job
        // (manager doubles as senior operator at small shops). Filter
        // to people whose assigned_shops actually includes this shop.
        const team = (all || []).filter(u =>
          (u.role === "employee" || u.role === "manager") &&
          (u.assigned_shops || []).includes(order.shop_owner)
        );
        setEmployees(team);
      } catch {
        if (!cancelled) setEmployees([]);
      }
    })();
    return () => { cancelled = true; };
  }, [order?.shop_owner]);

  const isBrokerOrder = Boolean(order?.broker_id || order?.broker_email || order?.brokerId);
  const displayClient = isBrokerOrder
    ? (order?.broker_name || order?.broker_company || order?.customer_name || "Unknown")
    : getDisplayName(customer || order.customer_name);
  const displayJobTitle = isBrokerOrder
    ? (order?.job_title || order?.broker_client_name || "")
    : "";

  const discVal = parseFloat(order.discount) || 0;
  const isFlat = order.discount_type === "flat" || (discVal > 100 && order.discount_type !== "percent");
  // A FLAT discount applies to the order once. Per line, prorate it by the
  // line's share of the subtotal so the "After Discount" rows sum to the
  // order discount — not N× the full amount (the bug where every line showed
  // the entire flat discount deducted). Percent already distributes evenly.
  const orderSub = parseFloat(order.subtotal) || 0;
  const lineDiscountFactor = isFlat
    ? (orderSub > 0 ? Math.max(0, 1 - discVal / orderSub) : 1)
    : (1 - discVal / 100);
  const totals = order.line_items
    ? {
        sub: order.subtotal,
        afterDisc: isFlat ? Math.max(0, order.subtotal - discVal) : order.subtotal * (1 - discVal / 100),
        tax: order.tax,
        total: order.total,
      }
    : null;
  const nextStatus = getNextStatus(order.status);
  const prevStatus = getPreviousStatus(order.status);
  const artworkFiles = useMemo(
    () => getOrderArtwork({ ...order, selected_artwork: localArtwork }),
    [order, localArtwork]
  );

  // Render via Portal at document.body so the backdrop's `fixed`
  // positions against the true viewport, not whatever ancestor with
  // transform/filter the modal happens to live under. Same fix
  // pattern as QuoteEditorModal (PR #120).
  return createPortal(
    <div
      className="fixed bg-slate-900/60 backdrop-blur-sm z-[60] flex items-start justify-center p-2 sm:p-4 overflow-auto"
      style={{ top: 0, left: 0, right: 0, bottom: 0, width: "100vw", height: "100vh" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-4xl my-4"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <OrderDetailHeader
          order={order}
          displayClient={displayClient}
          displayJobTitle={displayJobTitle}
          artworkFiles={artworkFiles}
          onClose={onClose}
          onAdvance={onAdvance}
          onRevert={onRevert}
        />

        <div className="p-4 sm:p-6 space-y-5">
          <div className="bg-teal-50 border border-teal-100 rounded-2xl p-4">
              <CollapsibleSection
                title="Artwork for Approval"
                icon={<Paperclip className="w-4 h-4 text-teal-500" />}
                storageKey="order-artwork-collapsed"
              >
                <div className="text-sm text-slate-500 -mt-1 mb-3">
                  Files uploaded here appear on the customer art approval page.
                </div>
                <AttachmentGallery
                  record={{ ...liveOrder, selected_artwork: localArtwork }}
                  title={null}
                  backLabel="Back to order"
                  accept=".png,.jpg,.jpeg,.pdf,.ai,.eps,.psd"
                  onUpload={handleArtworkUpload}
                  onRemove={removeArtwork}
                  uploading={uploading}
                  uploadError={uploadError}
                />
              </CollapsibleSection>
            </div>

          {(liveOrder.line_items || []).length > 0 ? (
            <>
              <OrderLineItems
                order={order}
                liveOrder={liveOrder}
                isBrokerOrder={isBrokerOrder}
                totals={totals}
                isFlat={isFlat}
                discVal={discVal}
                lineDiscountFactor={lineDiscountFactor}
                setPreviewArt={setPreviewArt}
                handleReorderShortfall={handleReorderShortfall}
                reorderCreating={reorderCreating}
              />

              <FloorModePanel
                liveOrder={liveOrder}
                floorCollapsed={floorCollapsed}
                setFloorCollapsed={setFloorCollapsed}
                floorToggleTask={floorToggleTask}
                floorTogglePrint={floorTogglePrint}
                floorToggleGoods={floorToggleGoods}
                bulkOrderGoodsStep={bulkOrderGoodsStep}
                saveShortfall={saveShortfall}
              />

              <OrderShippingSection
                showShipping={showShipping}
                setShowShipping={setShowShipping}
                shipError={shipError}
                shipTracking={shipTracking}
                shipStatus={shipStatus}
                shipLabelUrl={shipLabelUrl}
                shipStreet={shipStreet}
                setShipStreet={setShipStreet}
                shipCity={shipCity}
                setShipCity={setShipCity}
                shipState={shipState}
                setShipState={setShipState}
                shipZip={shipZip}
                setShipZip={setShipZip}
                shipCountry={shipCountry}
                setShipCountry={setShipCountry}
                shipWeight={shipWeight}
                setShipWeight={setShipWeight}
                shipLength={shipLength}
                setShipLength={setShipLength}
                shipWidth={shipWidth}
                setShipWidth={setShipWidth}
                shipHeight={shipHeight}
                setShipHeight={setShipHeight}
                shipService={shipService}
                setShipService={setShipService}
                shipRates={shipRates}
                loadingRates={loadingRates}
                creatingLabel={creatingLabel}
                savingShipping={savingShipping}
                shippingSaved={shippingSaved}
                handleGetRates={handleGetRates}
                handleSaveShipping={handleSaveShipping}
                handleCreateLabel={handleCreateLabel}
                handleTrackShipment={handleTrackShipment}
              />

              <OrderJobCostSection
                order={order}
                showJobCost={showJobCost}
                setShowJobCost={setShowJobCost}
                estimatedHours={estimatedHours}
                setEstimatedHours={setEstimatedHours}
                laborHours={laborHours}
                setLaborHours={setLaborHours}
                actualCost={actualCost}
                setActualCost={setActualCost}
                laborCost={laborCost}
                setLaborCost={setLaborCost}
                assignedPress={assignedPress}
                setAssignedPress={setAssignedPress}
                assignedOperator={assignedOperator}
                setAssignedOperator={setAssignedOperator}
                presses={presses}
                employees={employees}
                handleSaveJobCost={handleSaveJobCost}
                savingCost={savingCost}
                costSaved={costSaved}
              />
            </>
          ) : (
            <div className="text-center py-8 text-slate-300 text-sm">
              No line items in this order.
            </div>
          )}
        </div>

        <OrderMessagesSection order={order} shopName={shopName} />

        <div className="px-4 sm:px-6 py-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-b-2xl space-y-2">
          <OrderInvoiceActions
            order={order}
            saving={saving}
            onRevert={onRevert}
            onAdvance={onAdvance}
            onShowInvoice={onShowInvoice}
            onComplete={onComplete}
            onTogglePaid={onTogglePaid}
            onClose={onClose}
            prevStatus={prevStatus}
            nextStatus={nextStatus}
            relatedInvoice={relatedInvoice}
            creatingInvoice={creatingInvoice}
            qbPushNote={qbPushNote}
            callAction={callAction}
            advanceWithGoodsGuard={advanceWithGoodsGuard}
            handleCreateInvoice={handleCreateInvoice}
            handleOpenSend={handleOpenSend}
          />

          <OrderUtilityActions
            order={order}
            liveOrder={liveOrder}
            customer={customer}
            shopName={shopName}
            logoUrl={logoUrl}
            copied={copied}
            copyLink={copyLink}
            onOrderFromAC={onOrderFromAC}
            sourcePO={sourcePO}
            saving={saving}
            onDelete={onDelete}
            callAction={callAction}
          />
        </div>
      </div>

      {previewArt && (
        <ArtworkPreviewOverlay
          art={previewArt}
          onClose={() => setPreviewArt(null)}
          backLabel="Back to order"
        />
      )}

      {sendingInvoice && relatedInvoice && (
        <SendInvoiceModal
          invoice={relatedInvoice}
          customer={sendCustomer}
          onClose={() => setSendingInvoice(false)}
          onSuccess={() => { lookupRelatedInvoice(); }}
        />
      )}
    </div>,
    document.body,
  );
}