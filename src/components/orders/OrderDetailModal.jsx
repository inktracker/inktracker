import { useState, useEffect, useMemo } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import {
  calcGroupPrice,
  fmtDate,
  fmtMoney,
  getQty,
  BIG_SIZES,
  SIZES,
  getDisplayName,
  BROKER_MARKUP,
} from "../shared/pricing";
import Badge from "../shared/Badge";
import { exportOrderToPDF } from "../shared/pdfExport";
import { Link2, Download, Trash2, ShoppingCart, CheckCircle2 } from "lucide-react";

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
    const base = window.location.origin;
    const url = type === "art"
      ? `${base}/ArtApproval?id=${order.id}`
      : `${base}/OrderStatus?id=${order.id}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(type);
      setTimeout(() => setCopied(null), 2000);
    });
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
        tax_rate: order.tax_rate || 8.265,
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

  const totals = order.line_items
    ? {
        sub: order.subtotal,
        afterDisc: order.subtotal - order.subtotal * (order.discount / 100),
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
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl my-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start px-6 py-5 border-b border-slate-200">
          <div>
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1">
              {order.order_id} {order.quote_id && `· ${order.quote_id}`}
            </div>
            <h2 className="text-sm font-semibold text-slate-900">
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
            </div>
          </div>
          <div className="flex items-center gap-3">
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

        <div className="p-6 space-y-5">
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
                      className="bg-white border border-indigo-200 rounded-xl p-3 flex items-start justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-800 truncate">
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
                            <span className="text-slate-500 bg-slate-50 border border-slate-200 px-2 py-1 rounded-full">
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
                const twoXL = BIG_SIZES.reduce(
                  (s, sz) => s + (parseInt((li.sizes || {})[sz]) || 0),
                  0
                );
                const r = calcGroupPrice(
                  li.garmentCost,
                  qty,
                  li.imprints,
                  order.rush_rate,
                  order.extras,
                  isBrokerOrder ? BROKER_MARKUP : undefined
                );
                const activeSizes = SIZES.filter(
                  (sz) => (parseInt((li.sizes || {})[sz]) || 0) > 0
                );
                return (
                  <div key={li.id} className="border border-slate-200 rounded-xl overflow-hidden">
                    <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex justify-between items-center">
                      <div>
                        <span className="font-bold text-slate-800 text-sm">
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
                          {fmtMoney(r.sub + twoXL * 2)}
                        </span>
                      )}
                    </div>

                    {activeSizes.length > 0 && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-slate-100 bg-slate-50/50">
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
                                  className="px-3 py-2 text-center font-semibold text-slate-800"
                                >
                                  {(li.sizes || {})[sz] || 0}
                                </td>
                              ))}
                              <td className="px-4 py-2 text-center font-bold text-slate-800">
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
                                    {fmtMoney(r.ppp + (BIG_SIZES.includes(sz) ? 2 : 0))}
                                    {BIG_SIZES.includes(sz) && (
                                      <span className="text-amber-500 ml-0.5">*</span>
                                    )}
                                  </td>
                                ))}
                                <td className="px-4 py-2 text-center text-xs font-bold text-slate-700">
                                  {fmtMoney(r.sub + twoXL * 2)}
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    )}

                    <div className="border-t border-slate-200 p-4 space-y-3">
                      {(li.imprints || []).map((imp) => {
                        const art = getImprintArtwork(imp);

                        return (
                          <div key={imp.id} className="space-y-2.5">
                            {imp.title && <div className="text-xs font-bold text-slate-800">{imp.title}</div>}
                            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
                              <span className="font-bold text-slate-800">{imp.location}</span>
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
                                    <div className="text-sm font-semibold text-slate-800 truncate">
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
                            <span className="font-semibold text-slate-800">
                              {fmtMoney(r.sub + twoXL * 2)}
                            </span>
                          </div>
                          {parseFloat(order.discount) > 0 && (
                            <div className="flex justify-between text-xs text-emerald-600">
                              <span>After Discount</span>
                              <span className="font-semibold">
                                {fmtMoney((r.sub + twoXL * 2) * (1 - parseFloat(order.discount) / 100))}
                              </span>
                            </div>
                          )}
                          <div className="flex justify-between text-xs text-slate-600 border-t border-indigo-200 pt-1">
                            <span>Final Cost (incl. tax)</span>
                            <span className="font-bold text-indigo-700">
                              {fmtMoney(
                                (r.sub + twoXL * 2) *
                                  (1 - parseFloat(order.discount) / 100) *
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
                <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-2">
                  <div className="flex justify-between text-sm text-slate-500">
                    <span>Subtotal</span>
                    <span>{fmtMoney(totals.sub)}</span>
                  </div>
                  {parseFloat(order.discount) > 0 && (
                    <div className="flex justify-between text-sm text-emerald-600">
                      <span>Discount ({order.discount}%)</span>
                      <span>−{fmtMoney(totals.sub - totals.afterDisc)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm text-slate-500">
                    <span>Tax ({order.tax_rate}%)</span>
                    <span>{fmtMoney(totals.tax)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-slate-900 border-t border-slate-200 pt-2">
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
            </>
          ) : (
            <div className="text-center py-8 text-slate-300 text-sm">
              No line items in this order.
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl space-y-2">
          {/* Row 1: workflow actions (status flow + payment) */}
          <div className="flex flex-wrap items-center gap-2">
            {onRevert && prevStatus && (
              <button
                onClick={() => callAction(onRevert, order.id).then(onClose)}
                disabled={saving}
                className="px-3 py-2 text-sm font-semibold text-slate-500 border border-slate-200 rounded-xl hover:bg-slate-100 transition disabled:opacity-50"
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
                    ? "text-slate-500 border-slate-200 hover:bg-slate-100"
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
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-100 transition"
            >
              <Link2 className="w-3.5 h-3.5" />
              {copied === "art" ? "Copied!" : "Art Approval Link"}
            </button>
            <button
              onClick={() => copyLink("status")}
              title="Share status link"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-100 transition"
            >
              <Link2 className="w-3.5 h-3.5" />
              {copied === "status" ? "Copied!" : "Status Link"}
            </button>
            <button
              onClick={() => exportOrderToPDF(order, shopName, logoUrl)}
              title="Download PDF"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-100 transition"
            >
              <Download className="w-3.5 h-3.5" /> PDF
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