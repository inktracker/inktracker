import { useState, useEffect, useMemo } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import MessagesTab from "../shared/MessagesTab";
import { orderThreadId, quoteThreadId } from "@/lib/messageThreads";
import { artApprovalUrl, orderStatusUrl } from "@/lib/publicUrls";
import { MessageSquare } from "lucide-react";
import {
  calcLinkedLinePrice,
  buildLinkedQtyMap,
  fmtDate,
  fmtMoney,
  getQty,
  BIG_SIZES,
  SIZES,
  getDisplayName,
  BROKER_MARKUP,
  O_STATUSES,
  sortSizeEntries,
} from "../shared/pricing";
import Badge from "../shared/Badge";
import { exportOrderToPDF } from "../shared/pdfExport";
import { Link2, Download, Eye, Trash2, ShoppingCart, CheckCircle2, Hammer, Truck, ExternalLink, Loader2 } from "lucide-react";

const STEP_TASKS = {
  "Art Approval": ["Receive artwork", "Review file specs", "Send proof to customer", "Get approval"],
  "Order Goods": ["Check inventory", "Place blank order", "Confirm delivery date", "Receive goods"],
  "Pre-Press": ["Burn screens", "Set up registration", "Mix ink colors", "Color match (if needed)"],
  "Printing": ["Mount screens on press", "Run test prints", "Get test approval", "Run full batch", "Spot check quality"],
  "Finishing": ["Flash/cure prints", "Quality inspect", "Fold & tag", "Count pieces"],
  "Quality Check": ["Verify quantities", "Check print quality", "Match against order", "Flag any issues"],
  "Packing": ["Sort by size", "Bag/box order", "Label packages", "Stage for pickup/shipping"],
};

const STATUS_ORDER = [
  "Art Approval",
  "Pre-Press",
  "Printing",
  "Finishing",
  "QC",
  "Ready for Pickup",
  "Completed",
];

function getNextStatus(currentStatus) {
  const idx = STATUS_ORDER.indexOf(currentStatus);
  return idx >= 0 && idx < STATUS_ORDER.length - 1 ? STATUS_ORDER[idx + 1] : null;
}

function getPreviousStatus(currentStatus) {
  const idx = STATUS_ORDER.indexOf(currentStatus);
  return idx > 0 ? STATUS_ORDER[idx - 1] : null;
}

function getImprintArtwork(imp) {
  if (!imp) return null;
  if (!imp.artwork_id && !imp.artwork_name && !imp.artwork_url) return null;

  return {
    id: imp.artwork_id || imp.artwork_url || imp.artwork_name || "",
    name: imp.artwork_name || "Attached Artwork",
    url: imp.artwork_url || "",
    note: imp.artwork_note || "",
    colors: imp.artwork_colors || "",
  };
}

function getOrderArtwork(order) {
  const map = new Map();

  (order?.selected_artwork || []).forEach((art) => {
    const key = art.id || art.url || art.name;
    if (!key || map.has(key)) return;

    map.set(key, {
      id: art.id || key,
      name: art.name || "Connected Artwork",
      url: art.url || art.file_url || "",
      note: art.note || "",
      colors: art.colors || art.artwork_colors || "",
      source: art.source || "Connected to quote",
      placements: [],
    });
  });

  (order?.line_items || []).forEach((li) => {
    (li.imprints || []).forEach((imp) => {
      const art = getImprintArtwork(imp);
      if (!art) return;

      const key = art.id || art.url || art.name;
      const existing = map.get(key);
      const placement = [imp.location, imp.title].filter(Boolean).join(" · ");

      if (existing) {
        if (placement && !existing.placements.includes(placement)) {
          existing.placements.push(placement);
        }
        if (!existing.colors && art.colors) existing.colors = art.colors;
        if (!existing.note && art.note) existing.note = art.note;
        if (!existing.url && art.url) existing.url = art.url;
        existing.source = "Linked to production imprints";
        return;
      }

      map.set(key, {
        ...art,
        source: "Linked to production imprints",
        placements: placement ? [placement] : [],
      });
    });
  });

  return Array.from(map.values());
}

export default function OrderDetailModal({
  order,
  onClose,
  onAdvance,
  onDelete,
  onComplete,
  onRevert,
  onTogglePaid,
  onOrderFromSS,
}) {
  const [shopName, setShopName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [reordered, setReordered] = useState(false);
  const [copied, setCopied] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [localArtwork, setLocalArtwork] = useState(order.selected_artwork || []);
  const [showJobCost, setShowJobCost] = useState(false);
  const [actualCost, setActualCost] = useState(order.actual_cost ?? "");
  const [laborHours, setLaborHours] = useState(order.actual_labor_hours ?? "");
  const [laborCost, setLaborCost] = useState(order.actual_labor_cost ?? "");
  const [assignedPress, setAssignedPress] = useState(order.assigned_press || "");
  const [assignedOperator, setAssignedOperator] = useState(order.assigned_operator || "");
  const [stepNotes, setStepNotes] = useState(order.step_notes || {});
  const [savingCost, setSavingCost] = useState(false);
  const [costSaved, setCostSaved] = useState(false);
  const [floorMode, setFloorMode] = useState(false);
  const [liveOrder, setLiveOrder] = useState(order);

  // Shipping
  const [showShipping, setShowShipping] = useState(false);
  const [shipStreet, setShipStreet] = useState(order.shipping_address_street || "");
  const [shipCity, setShipCity] = useState(order.shipping_address_city || "");
  const [shipState, setShipState] = useState(order.shipping_address_state || "");
  const [shipZip, setShipZip] = useState(order.shipping_address_zip || "");
  const [shipCountry, setShipCountry] = useState(order.shipping_address_country || "US");
  const [shipWeight, setShipWeight] = useState(order.shipping_weight || "");
  const [shipLength, setShipLength] = useState(order.shipping_length || "");
  const [shipWidth, setShipWidth] = useState(order.shipping_width || "");
  const [shipHeight, setShipHeight] = useState(order.shipping_height || "");
  const [shipService, setShipService] = useState(order.shipping_service_type || "");
  const [shipRates, setShipRates] = useState([]);
  const [loadingRates, setLoadingRates] = useState(false);
  const [creatingLabel, setCreatingLabel] = useState(false);
  const [shipTracking, setShipTracking] = useState(order.tracking_number || "");
  const [shipLabelUrl, setShipLabelUrl] = useState(order.shipping_label_url || "");
  const [shipStatus, setShipStatus] = useState(order.shipping_status || "");
  const [savingShipping, setSavingShipping] = useState(false);
  const [shippingSaved, setShippingSaved] = useState(false);
  const [shipError, setShipError] = useState("");

  async function floorToggleTask(task) {
    const step = liveOrder.status || "Pre-Press";
    const checklist = { ...(liveOrder.checklist || {}) };
    if (!checklist[step]) checklist[step] = {};
    checklist[step][task] = checklist[step][task] ? null : { by: shopName || "Admin", at: new Date().toISOString() };
    const updated = await base44.entities.Order.update(liveOrder.id, { checklist });
    setLiveOrder(prev => ({ ...prev, ...updated }));
  }

  async function floorTogglePrint(liIdx, size, impIdx) {
    const checklist = { ...(liveOrder.checklist || {}) };
    const pp = { ...(checklist.print_progress || {}) };
    const key = `${liIdx}-${size}-${impIdx}`;
    pp[key] = pp[key] ? null : { by: shopName || "Admin", at: new Date().toISOString() };
    checklist.print_progress = pp;
    const updated = await base44.entities.Order.update(liveOrder.id, { checklist });
    setLiveOrder(prev => ({ ...prev, ...updated }));
  }

  async function handleSaveJobCost() {
    setSavingCost(true);
    try {
      const ac = parseFloat(actualCost) || 0;
      const lh = parseFloat(laborHours) || 0;
      const lc = parseFloat(laborCost) || 0;
      await base44.entities.Order.update(order.id, {
        actual_cost: ac,
        actual_labor_hours: lh,
        actual_labor_cost: lc,
        assigned_press: assignedPress,
        assigned_operator: assignedOperator,
        step_notes: stepNotes,
      });
      setCostSaved(true);
      setTimeout(() => setCostSaved(false), 2000);
    } catch (err) {
      console.error("Failed to save job cost:", err);
    } finally {
      setSavingCost(false);
    }
  }

  const SUPABASE_FUNC_URL = import.meta.env.VITE_SUPABASE_URL;

  async function callFedEx(action, params) {
    setShipError("");
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${SUPABASE_FUNC_URL}/functions/v1/fedexShipping`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, accessToken: session?.access_token, ...params }),
    });
    const data = await res.json();
    if (data.error) setShipError(data.error);
    return data;
  }

  async function handleGetRates() {
    setLoadingRates(true);
    setShipRates([]);
    const data = await callFedEx("getRates", {
      shipTo: { street: shipStreet, city: shipCity, state: shipState, zip: shipZip, country: shipCountry },
      weight: shipWeight, length: shipLength, width: shipWidth, height: shipHeight,
    });
    if (data.rates) setShipRates(data.rates);
    setLoadingRates(false);
  }

  async function handleCreateLabel() {
    if (!shipService) { setShipError("Select a shipping service first"); return; }
    setCreatingLabel(true);
    const data = await callFedEx("createShipment", {
      shipTo: {
        street: shipStreet, city: shipCity, state: shipState, zip: shipZip, country: shipCountry,
        name: order.customer_name, company: "",
      },
      weight: shipWeight, length: shipLength, width: shipWidth, height: shipHeight,
      serviceType: shipService,
      orderId: order.id,
      customerName: order.customer_name,
    });
    if (data.trackingNumber) {
      setShipTracking(data.trackingNumber);
      setShipLabelUrl(data.labelUrl || "");
      setShipStatus("Label Created");
      // Also open the label for immediate printing
      if (data.encodedLabel) {
        const w = window.open("", "_blank");
        if (w) {
          w.document.write(`<iframe src="${data.encodedLabel}" style="width:100%;height:100%;border:none"></iframe>`);
        }
      }
    }
    setCreatingLabel(false);
  }

  async function handleSaveShipping() {
    setSavingShipping(true);
    try {
      await base44.entities.Order.update(order.id, {
        shipping_address_street: shipStreet,
        shipping_address_city: shipCity,
        shipping_address_state: shipState,
        shipping_address_zip: shipZip,
        shipping_address_country: shipCountry,
        shipping_weight: parseFloat(shipWeight) || null,
        shipping_length: parseFloat(shipLength) || null,
        shipping_width: parseFloat(shipWidth) || null,
        shipping_height: parseFloat(shipHeight) || null,
        shipping_service_type: shipService,
      });
      setShippingSaved(true);
      setTimeout(() => setShippingSaved(false), 2000);
    } catch (err) {
      console.error("Failed to save shipping:", err);
    } finally {
      setSavingShipping(false);
    }
  }

  async function handleTrackShipment() {
    if (!shipTracking) return;
    const data = await callFedEx("trackShipment", { trackingNumber: shipTracking });
    if (data.status) setShipStatus(data.status);
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

        const { data } = supabase.storage.from("artwork").getPublicUrl(path);
        newArtwork.push({
          id: path,
          name: file.name,
          url: data.publicUrl,
          note: "",
          colors: "",
          source: "Uploaded to order",
        });
      }

      await base44.entities.Order.update(order.id, { selected_artwork: newArtwork });
      setLocalArtwork(newArtwork);
    } catch (err) {
      setUploadError(err.message || "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
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
        date: new Date().toISOString().split("T")[0],
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
      console.error("Reorder failed:", err);
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

  const isBrokerOrder = Boolean(order?.broker_id || order?.broker_email || order?.brokerId);
  const displayClient = isBrokerOrder
    ? (order?.broker_name || order?.broker_company || order?.customer_name || "Unknown")
    : getDisplayName(order.customer_name);
  const displayJobTitle = isBrokerOrder
    ? (order?.job_title || order?.broker_client_name || "")
    : "";

  const discVal = parseFloat(order.discount) || 0;
  const isFlat = order.discount_type === "flat" || (discVal > 100 && order.discount_type !== "percent");
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

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-start justify-center p-4 overflow-auto"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-4xl my-4"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start px-4 sm:px-6 py-5 border-b border-slate-200 dark:border-slate-700">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1">
              {order.order_id} {order.quote_id && `· ${order.quote_id}`}
            </div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
              {displayClient}
            </h2>
            <div className="flex flex-wrap items-center gap-2 mt-0.5">
              {displayJobTitle && (
                <div className="text-sm text-slate-400">Job: {displayJobTitle}</div>
              )}
              {order.due_date && (
                <div className="text-sm text-slate-400">Due: {fmtDate(order.due_date)}</div>
              )}
              {artworkFiles.length > 0 && (
                <span className="text-[11px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded-full">
                  {artworkFiles.length} artwork file{artworkFiles.length === 1 ? "" : "s"}
                </span>
              )}
              {order.assigned_press && (
                <span className="text-[11px] font-semibold text-violet-700 bg-violet-50 border border-violet-100 px-2.5 py-1 rounded-full">
                  {order.assigned_press}
                </span>
              )}
              {order.assigned_operator && (
                <span className="text-[11px] font-semibold text-cyan-700 bg-cyan-50 border border-cyan-100 px-2.5 py-1 rounded-full">
                  {order.assigned_operator}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <Badge s={order.status} />
            {order.paid ? (
              <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
                Paid
              </span>
            ) : (
              <span className="text-xs font-semibold text-red-500 bg-red-50 border border-red-100 px-2.5 py-1 rounded-full">
                Unpaid
              </span>
            )}
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 text-lg leading-none"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Production Progress Pipeline */}
        <div className="px-4 sm:px-6 py-3 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 overflow-x-auto">
          <div className="flex items-center gap-0 min-w-max">
            {O_STATUSES.map((s, i) => {
              const currentIdx = O_STATUSES.indexOf(order.status);
              const done = i < currentIdx;
              const active = i === currentIdx;
              const future = i > currentIdx;
              return (
                <div key={s} className="flex items-center">
                  <div className="relative group">
                    <button
                      onClick={() => {
                        if (i === currentIdx) return;
                        if (onAdvance && i === currentIdx + 1) onAdvance(order.id);
                        else if (onRevert && i === currentIdx - 1) onRevert(order.id);
                      }}
                      disabled={Math.abs(i - currentIdx) > 1}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition whitespace-nowrap ${
                        active ? "bg-indigo-600 text-white shadow-sm" :
                        done ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 cursor-pointer" :
                        i === currentIdx + 1 ? "bg-white dark:bg-slate-900 text-slate-500 border border-slate-200 dark:border-slate-700 hover:border-indigo-300 hover:text-indigo-600 cursor-pointer" :
                        "bg-white dark:bg-slate-900 text-slate-300 border border-slate-100 dark:border-slate-700"
                      }`}
                    >
                      {done && <span>✓</span>}
                      {s}
                      {stepNotes[s] && <span className="text-amber-500 ml-0.5">•</span>}
                    </button>
                    {(done || active) && (
                      <div className="absolute top-full left-0 mt-1 w-48 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg p-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto z-30">
                        <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">{s} Note</div>
                        <input
                          type="text"
                          value={stepNotes[s] || ""}
                          onClick={e => e.stopPropagation()}
                          onChange={e => {
                            const val = e.target.value;
                            setStepNotes(prev => ({ ...prev, [s]: val }));
                          }}
                          onBlur={handleSaveJobCost}
                          placeholder="Add note..."
                          className="w-full text-xs border border-slate-200 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-300"
                        />
                      </div>
                    )}
                  </div>
                  {i < O_STATUSES.length - 1 && (
                    <div className={`w-4 h-0.5 mx-0.5 ${done ? "bg-emerald-300" : "bg-slate-200"}`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="p-4 sm:p-6 space-y-5">
          <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-widest text-indigo-400">
                    Artwork for Approval
                  </div>
                  <div className="text-sm text-slate-500 mt-1">
                    Files uploaded here appear on the customer art approval page.
                  </div>
                </div>
                <label className={`shrink-0 cursor-pointer px-3 py-1.5 text-xs font-semibold rounded-lg border transition ${uploading ? "opacity-50 pointer-events-none" : ""} text-indigo-600 border-indigo-200 bg-white hover:bg-indigo-50`}>
                  {uploading ? "Uploading…" : "+ Upload"}
                  <input
                    type="file"
                    multiple
                    accept="image/*,.pdf,.ai,.eps,.svg,.psd"
                    className="sr-only"
                    onChange={handleArtworkUpload}
                    disabled={uploading}
                  />
                </label>
              </div>

              {uploadError && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {uploadError}
                </div>
              )}

              {artworkFiles.length === 0 ? (
                <div className="text-center py-4 text-sm text-slate-400">
                  No artwork uploaded yet — use the Upload button above.
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {artworkFiles.map((art) => (
                    <div
                      key={art.id || art.url || art.name}
                      className="bg-white dark:bg-slate-900 border border-indigo-200 rounded-xl p-3 flex items-start justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">
                          {art.name}
                        </div>

                        {art.note && (
                          <div className="text-xs text-slate-400 mt-0.5 line-clamp-2">
                            {art.note}
                          </div>
                        )}

                        <div className="flex flex-wrap gap-2 mt-2 text-[11px]">
                          {art.colors && (
                            <span className="text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-1 rounded-full font-semibold">
                              {art.colors} color{String(art.colors) === "1" ? "" : "s"}
                            </span>
                          )}
                          {art.source && (
                            <span className="text-slate-500 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-1 rounded-full">
                              {art.source}
                            </span>
                          )}
                        </div>

                        {art.placements?.length > 0 && (
                          <div className="text-[11px] text-slate-500 mt-2">
                            Used on: {art.placements.join(", ")}
                          </div>
                        )}
                      </div>

                      {art.url ? (
                        <a
                          href={art.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 text-xs font-semibold text-indigo-600 border border-indigo-200 px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition"
                        >
                          Open
                        </a>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>

          {(order.line_items || []).length > 0 ? (
            <>
              {(order.line_items || []).map((li) => {
                const qty = getQty(li);
                const markup = isBrokerOrder ? BROKER_MARKUP : undefined;
                const linkedQtyMap = buildLinkedQtyMap(order.line_items || []);
                // Use saved pricing from "calculate once"; fall back to live calc for legacy
                const hasSaved = Number.isFinite(li._ppp) && li._ppp > 0 && Number.isFinite(li._lineTotal);
                const clientPppOverride = Number(li?.clientPpp);
                const useClientPpp = !hasSaved && markup === undefined && Number.isFinite(clientPppOverride) && clientPppOverride > 0 && qty > 0;
                const r = hasSaved
                  ? { lineTotal: li._lineTotal, ppp: li._ppp, regularPpp: li._ppp, oversizePpp: li._ppp }
                  : useClientPpp
                    ? { lineTotal: clientPppOverride * qty, ppp: clientPppOverride, regularPpp: clientPppOverride, oversizePpp: clientPppOverride, overridden: true }
                    : calcLinkedLinePrice(li, order.rush_rate, order.extras, markup, linkedQtyMap);
                const activeSizes = SIZES.filter(
                  (sz) => (parseInt((li.sizes || {})[sz]) || 0) > 0
                );
                return (
                  <div key={li.id} className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                    <div className="bg-slate-50 dark:bg-slate-800 px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                      <div>
                        <span className="font-bold text-slate-800 dark:text-slate-200 text-sm">
                          {li.style || "Garment"}
                        </span>
                        {li.garmentColor && (
                          <span className="ml-2 text-xs text-slate-500">· {li.garmentColor}</span>
                        )}
                        <span className="ml-2 text-xs text-slate-400">
                          Wholesale: {fmtMoney(li.garmentCost)}
                        </span>
                      </div>
                      {r && (
                        <span className="font-bold text-slate-700 text-sm">
                          {fmtMoney(r.lineTotal)}
                        </span>
                      )}
                    </div>

                    {activeSizes.length > 0 && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                              <td className="px-4 py-2 text-xs text-slate-400 font-semibold">
                                Size
                              </td>
                              {activeSizes.map((sz) => (
                                <td
                                  key={sz}
                                  className="px-3 py-2 text-center text-xs font-semibold text-slate-600"
                                >
                                  {sz}
                                </td>
                              ))}
                              <td className="px-4 py-2 text-center text-xs font-semibold text-slate-600">
                                Total
                              </td>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td className="px-4 py-2 text-xs text-slate-500">Qty</td>
                              {activeSizes.map((sz) => (
                                <td
                                  key={sz}
                                  className="px-3 py-2 text-center font-semibold text-slate-800 dark:text-slate-200"
                                >
                                  {(li.sizes || {})[sz] || 0}
                                </td>
                              ))}
                              <td className="px-4 py-2 text-center font-bold text-slate-800 dark:text-slate-200">
                                {qty}
                              </td>
                            </tr>
                            {r && (
                              <tr>
                                <td className="px-4 py-2 text-xs text-slate-400">Price/ea</td>
                                {activeSizes.map((sz) => (
                                  <td
                                    key={sz}
                                    className="px-3 py-2 text-center text-xs text-slate-500"
                                  >
                                    {fmtMoney(r.ppp)}
                                  </td>
                                ))}
                                <td className="px-4 py-2 text-center text-xs font-bold text-slate-700">
                                  {fmtMoney(r.lineTotal)}
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    )}

                    <div className="border-t border-slate-200 dark:border-slate-700 p-4 space-y-3">
                      {(li.imprints || []).map((imp) => {
                        const art = getImprintArtwork(imp);

                        return (
                          <div key={imp.id} className="space-y-2.5">
                            {imp.title && <div className="text-xs font-bold text-slate-800 dark:text-slate-200">{imp.title}</div>}
                            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-2 border border-slate-100 dark:border-slate-700">
                              <span className="font-bold text-slate-800 dark:text-slate-200">{imp.location}</span>
                              <span className="text-slate-500">
                                {imp.colors} color{imp.colors !== 1 ? "s" : ""} · {imp.technique}
                              </span>
                              {imp.pantones && (
                                <span className="text-indigo-600 font-medium">{imp.pantones}</span>
                              )}
                              {imp.details && (
                                <span className="text-slate-400 italic">{imp.details}</span>
                              )}
                            </div>
                            {(imp.width || imp.height) && (
                              <div className="flex gap-2 text-xs text-slate-500">
                                {imp.width && <span>Width: {imp.width}</span>}
                                {imp.height && <span>Height: {imp.height}</span>}
                              </div>
                            )}

                            {art && (
                              <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3">
                                <div className="text-[11px] font-bold uppercase tracking-widest text-indigo-400 mb-2">
                                  Attached Artwork
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">
                                      {art.name}
                                    </div>
                                    {art.note && (
                                      <div className="text-xs text-slate-400 truncate mt-0.5">
                                        {art.note}
                                      </div>
                                    )}
                                    {art.colors && (
                                      <div className="text-xs text-indigo-600 font-semibold mt-1">
                                        Artwork colors: {art.colors}
                                      </div>
                                    )}
                                  </div>

                                  {art.url ? (
                                    <a
                                      href={art.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="shrink-0 text-xs font-semibold text-indigo-600 border border-indigo-200 px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition"
                                    >
                                      Open
                                    </a>
                                  ) : null}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {r && (
                        <div className="bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2 space-y-1">
                          <div className="flex justify-between text-xs text-slate-600">
                            <span>Line Subtotal</span>
                            <span className="font-semibold text-slate-800 dark:text-slate-200">
                              {fmtMoney(r.lineTotal)}
                            </span>
                          </div>
                          {parseFloat(order.discount) > 0 && (() => {
                            const lineSub = r.lineTotal;
                            const lineAfterDisc = isFlat ? Math.max(0, lineSub - discVal) : lineSub * (1 - discVal / 100);
                            return (
                              <div className="flex justify-between text-xs text-emerald-600">
                                <span>After Discount</span>
                                <span className="font-semibold">
                                  {fmtMoney(lineAfterDisc)}
                                </span>
                              </div>
                            );
                          })()}
                          <div className="flex justify-between text-xs text-slate-600 border-t border-indigo-200 pt-1">
                            <span>Final Cost (incl. tax)</span>
                            <span className="font-bold text-indigo-700">
                              {fmtMoney(
                                (isFlat ? Math.max(0, r.lineTotal - discVal) : r.lineTotal * (1 - discVal / 100)) *
                                  (1 + parseFloat(order.tax_rate) / 100)
                              )}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {totals && (
                <div className="bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2">
                  <div className="flex justify-between text-sm text-slate-500">
                    <span>Subtotal</span>
                    <span>{fmtMoney(totals.sub)}</span>
                  </div>
                  {parseFloat(order.discount) > 0 && (
                    <div className="flex justify-between text-sm text-emerald-600">
                      <span>Discount {isFlat ? `(${fmtMoney(discVal)})` : `(${order.discount}%)`}</span>
                      <span>−{fmtMoney(totals.sub - totals.afterDisc)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm text-slate-500">
                    <span>Tax ({order.tax_rate}%)</span>
                    <span>{fmtMoney(totals.tax)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-slate-900 dark:text-slate-100 border-t border-slate-200 dark:border-slate-700 pt-2">
                    <span>Total</span>
                    <span className="text-xl">{fmtMoney(totals.total)}</span>
                  </div>
                </div>
              )}

              {order.notes && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
                  <span className="font-semibold">Notes: </span>
                  {order.notes}
                </div>
              )}

              {/* Shop Floor Progress */}
              {(() => {
                const checklist = order.checklist || {};
                const printProgress = checklist.print_progress || {};
                const stepTasks = checklist;
                const hasPrintData = Object.keys(printProgress).length > 0;
                const hasChecklistData = Object.keys(stepTasks).some(k => k !== "print_progress" && Object.keys(stepTasks[k] || {}).length > 0);
                const hasStepNotes = Object.keys(order.step_notes || {}).some(k => ((order.step_notes || {})[k] || []).length > 0);

                if (!hasPrintData && !hasChecklistData && !hasStepNotes) return null;

                return (
                  <div className="border border-indigo-200 rounded-xl overflow-hidden">
                    <div className="px-4 py-3 bg-indigo-50 flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                      <span className="text-xs font-bold text-indigo-700 uppercase tracking-widest">Shop Floor Progress</span>
                    </div>
                    <div className="p-4 space-y-3">
                      {/* Print progress per line item */}
                      {hasPrintData && (order.line_items || []).map((li, liIdx) => {
                        const imprints = (li.imprints || []).filter(imp => (imp.colors || 0) > 0);
                        if (imprints.length === 0) return null;
                        const sizes = Object.entries(li.sizes || {}).filter(([, v]) => parseInt(v) > 0);
                        const totalSlots = sizes.length * imprints.length;
                        const doneSlots = sizes.reduce((sum, [size]) =>
                          sum + imprints.filter((_, ii) => !!printProgress[`${liIdx}-${size}-${ii}`]).length, 0);
                        if (totalSlots === 0) return null;
                        const pct = Math.round((doneSlots / totalSlots) * 100);

                        return (
                          <div key={liIdx} className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-semibold text-slate-700">
                                {li.brand ? `${li.brand} ` : ""}{li.style || "Item"}{li.garmentColor ? ` — ${li.garmentColor}` : ""}
                              </span>
                              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${pct === 100 ? "bg-emerald-100 text-emerald-700" : pct > 0 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"}`}>
                                {pct}% printed
                              </span>
                            </div>
                            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full transition-all ${pct === 100 ? "bg-emerald-400" : "bg-indigo-400"}`} style={{ width: `${pct}%` }} />
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {sizes.map(([size]) => {
                                const done = imprints.filter((_, ii) => !!printProgress[`${liIdx}-${size}-${ii}`]).length;
                                const all = done === imprints.length;
                                const partial = done > 0 && !all;
                                return (
                                  <span key={size} className={`text-[10px] font-bold px-2 py-0.5 rounded ${all ? "bg-emerald-100 text-emerald-700" : partial ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-400"}`}>
                                    {size} {all ? "✓" : partial ? `${done}/${imprints.length}` : ""}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}

                      {/* Step checklist progress */}
                      {hasChecklistData && Object.entries(stepTasks).filter(([k]) => k !== "print_progress").map(([step, tasks]) => {
                        if (!tasks || typeof tasks !== "object") return null;
                        const entries = Object.entries(tasks);
                        const done = entries.filter(([, v]) => !!v).length;
                        const total = entries.length;
                        if (total === 0) return null;
                        return (
                          <div key={step} className="flex items-center justify-between text-sm">
                            <span className="text-slate-600">{step} checklist</span>
                            <span className={`text-xs font-bold ${done === total ? "text-emerald-600" : "text-amber-600"}`}>{done}/{total} tasks</span>
                          </div>
                        );
                      })}

                      {/* Employee notes */}
                      {hasStepNotes && (() => {
                        const allNotes = [];
                        Object.entries(order.step_notes || {}).forEach(([step, notes]) => {
                          (notes || []).forEach(n => allNotes.push({ ...n, step }));
                        });
                        allNotes.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
                        return allNotes.length > 0 ? (
                          <div>
                            <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5">Employee Updates</div>
                            <div className="space-y-1 max-h-40 overflow-y-auto">
                              {allNotes.slice(0, 10).map((n, i) => (
                                <div key={i} className="flex gap-2 text-xs group">
                                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1.5 flex-shrink-0" />
                                  <div className="flex-1">
                                    <span className="text-slate-700">{n.text}</span>
                                    <span className="text-slate-400 ml-1.5">{n.by} · {n.step}{n.at ? ` · ${new Date(n.at).toLocaleString()}` : ""}</span>
                                  </div>
                                  <button onClick={async (e) => {
                                    e.currentTarget.closest('.group').style.display = 'none';
                                    try {
                                      const notes = { ...(order.step_notes || {}) };
                                      const stepArr = notes[n.step] || [];
                                      notes[n.step] = stepArr.filter(sn => sn.at !== n.at || sn.text !== n.text);
                                      await base44.entities.Order.update(order.id, { step_notes: notes });
                                      order.step_notes = notes;
                                    } catch {}
                                  }} className="text-slate-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition flex-shrink-0">
                                    ✕
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null;
                      })()}
                    </div>
                  </div>
                );
              })()}

              {/* Floor Mode Panel */}
              {floorMode && (() => {
                const step = liveOrder.status || "Pre-Press";
                const tasks = STEP_TASKS[step] || [];
                const checklist = liveOrder.checklist || {};
                const stepChecks = checklist[step] || {};
                const printProgress = checklist.print_progress || {};

                return (
                  <div className="border-2 border-indigo-400 rounded-xl overflow-hidden">
                    <div className="px-4 py-3 bg-indigo-600 text-white flex items-center gap-2">
                      <Hammer className="w-4 h-4" />
                      <span className="text-sm font-bold">Floor Mode — {step}</span>
                    </div>
                    <div className="p-4 space-y-4">
                      {/* Checklist */}
                      {tasks.length > 0 && (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Checklist</span>
                            <span className="text-xs font-bold text-indigo-600">{tasks.filter(t => !!stepChecks[t]).length}/{tasks.length}</span>
                          </div>
                          <div className="space-y-1">
                            {tasks.map(task => {
                              const done = !!stepChecks[task];
                              return (
                                <button key={task} onClick={() => floorToggleTask(task)}
                                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition ${done ? "bg-emerald-50 border border-emerald-200" : "bg-slate-50 hover:bg-slate-100 border border-transparent"}`}>
                                  <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 ${done ? "bg-emerald-500 border-emerald-500" : "border-slate-300"}`}>
                                    {done && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
                                  </div>
                                  <span className={`text-sm ${done ? "text-emerald-700 line-through" : "text-slate-700"}`}>{task}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Print tracking */}
                      {(liveOrder.line_items || []).map((li, liIdx) => {
                        const imprints = (li.imprints || []).filter(imp => (imp.colors || 0) > 0);
                        if (imprints.length === 0) return null;
                        return (
                          <div key={liIdx}>
                            <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                              {li.brand ? `${li.brand} ` : ""}{li.style || "Item"}{li.garmentColor ? ` — ${li.garmentColor}` : ""}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {sortSizeEntries(Object.entries(li.sizes || {})).filter(([, v]) => parseInt(v) > 0).map(([size, count]) => {
                                const donePrints = imprints.filter((_, ii) => !!printProgress[`${liIdx}-${size}-${ii}`]).length;
                                const allDone = imprints.length > 0 && donePrints === imprints.length;
                                const partial = donePrints > 0 && !allDone;
                                return (
                                  <div key={size} className="flex flex-col items-center">
                                    <button onClick={() => {
                                      if (allDone) {
                                        imprints.forEach((_, ii) => floorTogglePrint(liIdx, size, ii));
                                      } else {
                                        const next = imprints.findIndex((_, ii) => !printProgress[`${liIdx}-${size}-${ii}`]);
                                        if (next !== -1) floorTogglePrint(liIdx, size, next);
                                      }
                                    }}
                                      className={`text-sm rounded-xl px-3 py-2 font-bold border-2 transition ${allDone ? "bg-emerald-100 border-emerald-400 text-emerald-700" : partial ? "bg-amber-50 border-amber-300 text-amber-700" : "bg-white border-slate-200 text-slate-700 hover:border-indigo-300"}`}>
                                      {size}: {count}{allDone && " ✓"}
                                    </button>
                                    {imprints.length > 1 && (
                                      <div className="flex gap-0.5 mt-1">
                                        {imprints.map((imp, ii) => (
                                          <button key={ii} onClick={() => floorTogglePrint(liIdx, size, ii)}
                                            title={imp.location}
                                            className={`w-2.5 h-2.5 rounded-full transition ${printProgress[`${liIdx}-${size}-${ii}`] ? "bg-emerald-400" : "bg-slate-300 hover:bg-slate-400"}`} />
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Shipping */}
              <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                <button onClick={() => setShowShipping(!showShipping)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 transition text-left">
                  <div className="flex items-center gap-2">
                    <Truck className="w-4 h-4 text-slate-400" />
                    <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Shipping</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {shipTracking && (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full text-blue-700 bg-blue-50">{shipTracking}</span>
                    )}
                    <span className="text-xs text-slate-400">{showShipping ? "▲" : "▼"}</span>
                  </div>
                </button>
                {showShipping && (
                  <div className="p-4 space-y-4">
                    {shipError && (
                      <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{shipError}</div>
                    )}

                    {/* Already shipped — show tracking info */}
                    {shipTracking ? (
                      <div className="space-y-3">
                        <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                          <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-bold text-slate-800">Shipment Created</div>
                            <div className="text-xs text-slate-500 mt-0.5">
                              Tracking: <span className="font-mono font-semibold text-slate-700">{shipTracking}</span>
                            </div>
                            {shipStatus && <div className="text-xs text-slate-400 mt-0.5">Status: {shipStatus}</div>}
                          </div>
                          <div className="flex gap-2 shrink-0">
                            <a
                              href={`https://www.fedex.com/fedextrack/?trknbr=${shipTracking}`}
                              target="_blank" rel="noopener noreferrer"
                              className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1"
                            >
                              Track <ExternalLink className="w-3 h-3" />
                            </a>
                            {shipLabelUrl && (
                              <a href={shipLabelUrl} target="_blank" rel="noopener noreferrer"
                                className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 flex items-center gap-1">
                                Label <Download className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                        </div>
                        <button onClick={handleTrackShipment}
                          className="text-xs font-semibold text-slate-500 hover:text-slate-700 transition">
                          Refresh tracking status
                        </button>
                      </div>
                    ) : (
                      <>
                        {/* Ship-to Address */}
                        <div>
                          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Ship To</div>
                          <div className="space-y-2">
                            <input type="text" placeholder="Street address" value={shipStreet} onChange={e => setShipStreet(e.target.value)}
                              className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                              <input type="text" placeholder="City" value={shipCity} onChange={e => setShipCity(e.target.value)}
                                className="text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                              <input type="text" placeholder="State" value={shipState} onChange={e => setShipState(e.target.value)} maxLength={2}
                                className="text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-300 uppercase" />
                              <input type="text" placeholder="ZIP" value={shipZip} onChange={e => setShipZip(e.target.value)}
                                className="text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                              <select value={shipCountry} onChange={e => setShipCountry(e.target.value)}
                                className="text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-300">
                                <option value="US">US</option>
                                <option value="CA">CA</option>
                              </select>
                            </div>
                          </div>
                        </div>

                        {/* Package Dimensions */}
                        <div>
                          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Package</div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <div>
                              <label className="text-[10px] text-slate-400">Weight (lbs)</label>
                              <input type="number" min="0" step="0.1" value={shipWeight} onChange={e => setShipWeight(e.target.value)}
                                className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-300 mt-0.5" />
                            </div>
                            <div>
                              <label className="text-[10px] text-slate-400">Length (in)</label>
                              <input type="number" min="0" step="1" value={shipLength} onChange={e => setShipLength(e.target.value)}
                                className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-300 mt-0.5" />
                            </div>
                            <div>
                              <label className="text-[10px] text-slate-400">Width (in)</label>
                              <input type="number" min="0" step="1" value={shipWidth} onChange={e => setShipWidth(e.target.value)}
                                className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-300 mt-0.5" />
                            </div>
                            <div>
                              <label className="text-[10px] text-slate-400">Height (in)</label>
                              <input type="number" min="0" step="1" value={shipHeight} onChange={e => setShipHeight(e.target.value)}
                                className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-300 mt-0.5" />
                            </div>
                          </div>
                        </div>

                        {/* Get Rates */}
                        <div className="flex items-center gap-3">
                          <button onClick={handleGetRates} disabled={loadingRates || !shipStreet || !shipCity || !shipState || !shipZip || !shipWeight}
                            className="text-xs font-bold text-white bg-slate-700 hover:bg-slate-800 px-4 py-2 rounded-lg transition disabled:opacity-40">
                            {loadingRates ? <span className="flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Getting rates...</span> : "Get Rates"}
                          </button>
                          <button onClick={handleSaveShipping} disabled={savingShipping}
                            className="text-xs font-semibold text-slate-500 hover:text-slate-700 transition">
                            {savingShipping ? "Saving..." : shippingSaved ? "Saved" : "Save address"}
                          </button>
                        </div>

                        {/* Rate Results */}
                        {shipRates.length > 0 && (
                          <div>
                            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Select Service</div>
                            <div className="space-y-1.5">
                              {shipRates.map(r => (
                                <button key={r.serviceType} onClick={() => setShipService(r.serviceType)}
                                  className={`w-full text-left flex items-center justify-between px-3 py-2.5 rounded-lg border transition text-sm ${
                                    shipService === r.serviceType
                                      ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                                      : "border-slate-200 hover:border-slate-300 text-slate-700"
                                  }`}>
                                  <div>
                                    <span className="font-semibold">{r.serviceName}</span>
                                    {r.transitDays && <span className="text-xs text-slate-400 ml-2">{r.transitDays}</span>}
                                  </div>
                                  <span className="font-bold">${(Number(r.totalCharge) || 0).toFixed(2)}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Create Label */}
                        {shipService && (
                          <button onClick={handleCreateLabel} disabled={creatingLabel}
                            className="text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 px-5 py-2.5 rounded-xl transition disabled:opacity-50 w-full sm:w-auto">
                            {creatingLabel
                              ? <span className="flex items-center justify-center gap-1.5"><Loader2 className="w-4 h-4 animate-spin" /> Creating label...</span>
                              : "Create Shipping Label"}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Job Costing & Production Assignment */}
              <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                <button onClick={() => setShowJobCost(!showJobCost)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 transition text-left">
                  <div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Job Costing & Production</div>
                  <div className="flex items-center gap-3">
                    {(parseFloat(actualCost) > 0 || order.actual_cost > 0) && (
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        (order.total || 0) - (parseFloat(actualCost) || order.actual_cost || 0) > 0
                          ? "text-emerald-700 bg-emerald-50" : "text-red-600 bg-red-50"
                      }`}>
                        {fmtMoney((order.total || 0) - (parseFloat(actualCost) || order.actual_cost || 0))} margin
                      </span>
                    )}
                    <span className="text-xs text-slate-400">{showJobCost ? "▲" : "▼"}</span>
                  </div>
                </button>
                {showJobCost && (
                  <div className="p-4 space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase">Actual Material Cost</label>
                        <div className="relative mt-0.5">
                          <span className="absolute left-2 top-1.5 text-slate-400 text-sm">$</span>
                          <input type="number" min="0" step="0.01" value={actualCost} onChange={e => setActualCost(e.target.value)}
                            className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg pl-5 pr-2 py-1.5 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase">Labor Hours</label>
                        <input type="number" min="0" step="0.25" value={laborHours} onChange={e => setLaborHours(e.target.value)}
                          className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-300 mt-0.5" />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase">Labor Cost</label>
                        <div className="relative mt-0.5">
                          <span className="absolute left-2 top-1.5 text-slate-400 text-sm">$</span>
                          <input type="number" min="0" step="0.01" value={laborCost} onChange={e => setLaborCost(e.target.value)}
                            className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg pl-5 pr-2 py-1.5 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase">Assigned Press</label>
                        <input type="text" value={assignedPress} onChange={e => setAssignedPress(e.target.value)}
                          placeholder="e.g. Manual Press 1, Auto Press"
                          className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-300 mt-0.5" />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase">Assigned Operator</label>
                        <input type="text" value={assignedOperator} onChange={e => setAssignedOperator(e.target.value)}
                          placeholder="e.g. John, Maria"
                          className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-300 mt-0.5" />
                      </div>
                    </div>

                    {/* Job P&L summary */}
                    {(parseFloat(actualCost) > 0 || parseFloat(laborCost) > 0) && (() => {
                      const totalCost = (parseFloat(actualCost) || 0) + (parseFloat(laborCost) || 0);
                      const revenue = order.total || 0;
                      const margin = revenue - totalCost;
                      const marginPct = revenue > 0 ? ((margin / revenue) * 100).toFixed(1) : 0;
                      return (
                        <div className="bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-1.5">
                          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Job P&L</div>
                          <div className="flex justify-between text-sm"><span className="text-slate-500">Revenue</span><span className="font-semibold text-slate-800 dark:text-slate-200">{fmtMoney(revenue)}</span></div>
                          <div className="flex justify-between text-sm"><span className="text-slate-500">Material Cost</span><span className="font-semibold text-slate-800 dark:text-slate-200">−{fmtMoney(parseFloat(actualCost) || 0)}</span></div>
                          <div className="flex justify-between text-sm"><span className="text-slate-500">Labor Cost</span><span className="font-semibold text-slate-800 dark:text-slate-200">−{fmtMoney(parseFloat(laborCost) || 0)}</span></div>
                          <div className={`flex justify-between text-sm font-bold border-t border-slate-200 dark:border-slate-600 pt-1.5 ${margin >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                            <span>Profit ({marginPct}%)</span><span>{fmtMoney(margin)}</span>
                          </div>
                        </div>
                      );
                    })()}

                    <div className="flex items-center gap-2">
                      <button onClick={handleSaveJobCost} disabled={savingCost}
                        className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition">
                        {savingCost ? "Saving…" : "Save"}
                      </button>
                      {costSaved && <span className="text-xs text-emerald-600 font-semibold">Saved</span>}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="text-center py-8 text-slate-300 text-sm">
              No line items in this order.
            </div>
          )}
        </div>

        {/* Messages — order thread (with reply box) + read-only view of originating quote thread. */}
        <div className="px-4 sm:px-6 py-4 border-t border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2 mb-3">
            <MessageSquare className="w-4 h-4 text-slate-500" />
            <h3 className="text-sm font-semibold text-slate-700">Messages</h3>
          </div>
          <MessagesTab
            threadId={orderThreadId(order)}
            currentUserEmail={order.shop_owner}
            replyContext={{
              customerEmail: order.customer_email || "",
              shopName,
              refId: order.order_id,
              defaultSubject: `Order ${order.order_id}`,
            }}
          />
          {order.quote_id && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              <div className="text-xs font-semibold text-slate-500 mb-2">
                From originating quote {order.quote_id}
              </div>
              <MessagesTab
                threadId={quoteThreadId(order.quote_id)}
                currentUserEmail={order.shop_owner}
              />
            </div>
          )}
        </div>

        <div className="px-4 sm:px-6 py-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-b-2xl space-y-2">
          {/* Row 1: workflow actions (status flow + payment) */}
          <div className="flex flex-wrap items-center gap-2">
            {onRevert && prevStatus && (
              <button
                onClick={() => callAction(onRevert, order.id).then(onClose)}
                disabled={saving}
                className="px-3 py-2 text-sm font-semibold text-slate-500 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-100 transition disabled:opacity-50"
              >
                ← {prevStatus}
              </button>
            )}
            {onAdvance && nextStatus && (
              <button
                onClick={() => callAction(onAdvance, order.id).then(onClose)}
                disabled={saving}
                className="px-4 py-2 text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition disabled:opacity-50"
              >
                {saving ? "Saving…" : `${order.status} Complete →`}
              </button>
            )}
            {order.status === "Completed" && onComplete && (
              <button
                onClick={() => callAction(onComplete, order).then(onClose)}
                disabled={saving}
                className="px-4 py-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition disabled:opacity-50"
              >
                {saving ? "Saving…" : "Convert to Invoice"}
              </button>
            )}
            {onTogglePaid && (
              <button
                onClick={() => callAction(onTogglePaid, order)}
                disabled={saving}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-xl border transition disabled:opacity-50 ${
                  order.paid
                    ? "text-slate-500 border-slate-200 dark:border-slate-700 hover:bg-slate-100"
                    : "text-emerald-700 border-emerald-300 bg-emerald-50 hover:bg-emerald-100"
                }`}
              >
                <CheckCircle2 className="w-4 h-4" />
                {order.paid ? "Unmark Paid" : "Mark Paid"}
              </button>
            )}
            <button
              onClick={onClose}
              className="ml-auto px-4 py-2 text-sm font-semibold text-slate-500 rounded-xl hover:bg-slate-100 transition"
            >
              Close
            </button>
          </div>

          {/* Row 2: utility actions (share, download, vendor order, delete) */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => copyLink("art")}
              title="Share art approval link"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-100 transition"
            >
              <Link2 className="w-3.5 h-3.5" />
              {copied === "art" ? "Copied!" : "Art Approval Link"}
            </button>
            <button
              onClick={() => copyLink("status")}
              title="Share status link"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-100 transition"
            >
              <Link2 className="w-3.5 h-3.5" />
              {copied === "status" ? "Copied!" : "Status Link"}
            </button>
            <button
              onClick={async () => {
                const url = await exportOrderToPDF(order, shopName, logoUrl, "blob");
                if (url) window.open(url, "_blank");
              }}
              title="Preview PDF"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-100 transition"
            >
              <Eye className="w-3.5 h-3.5" /> Preview
            </button>
            <button
              onClick={() => exportOrderToPDF(order, shopName, logoUrl)}
              title="Download PDF"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-100 transition"
            >
              <Download className="w-3.5 h-3.5" /> PDF
            </button>
            <button
              onClick={() => setFloorMode(f => !f)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition ${floorMode ? "bg-indigo-600 text-white" : "text-slate-600 border border-slate-200 dark:border-slate-700 hover:bg-slate-100"}`}
            >
              <Hammer className="w-3.5 h-3.5" /> {floorMode ? "Exit Floor Mode" : "Floor Mode"}
            </button>
            {onOrderFromSS && (
              <button
                onClick={() => onOrderFromSS(order)}
                disabled={saving}
                title="Place this order with S&S Activewear"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition disabled:opacity-50"
              >
                <ShoppingCart className="w-3.5 h-3.5" /> Order from S&S
              </button>
            )}
            {onDelete && (
              <button
                onClick={() => callAction(onDelete, order.id)}
                disabled={saving}
                title="Delete order"
                className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-400 border border-red-200 rounded-lg hover:bg-red-50 transition disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {saving ? "Deleting…" : "Delete"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}