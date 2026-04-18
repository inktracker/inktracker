import { useState, useEffect } from "react";
import { base44 } from "@/api/supabaseClient";
import { Loader2, CheckCircle2, AlertCircle, ImageIcon, MapPin } from "lucide-react";
import { fmtDate } from "../components/shared/pricing";

function getOrderArtwork(order) {
  const map = new Map();

  // Seed from selected_artwork
  (order?.selected_artwork || []).forEach((art) => {
    const key = art.id || art.url || art.name;
    if (!key || map.has(key)) return;
    map.set(key, {
      id: art.id || key,
      name: art.name || "Artwork",
      url: art.url || art.file_url || "",
      note: art.note || "",
      imprintDetails: [], // [{location, title, colors, technique, width, height, pantones, details, garmentLabel}]
    });
  });

  // Collect all active imprints with their garment context
  const allImprints = [];
  (order?.line_items || []).forEach((li) => {
    const garmentLabel = [li.brand, li.productName || li.style, li.garmentColor]
      .filter(Boolean).join(" · ");
    (li.imprints || []).forEach((imp) => {
      if (!imp.colors && !imp.location) return;
      allImprints.push({ ...imp, garmentLabel });
    });
  });

  // Link imprints that reference a specific artwork
  const linkedImprintIds = new Set();
  allImprints.forEach((imp) => {
    const artKey = imp.artwork_id || imp.artwork_url || imp.artwork_name;
    if (!artKey) return;

    if (!map.has(artKey)) {
      map.set(artKey, {
        id: artKey,
        name: imp.artwork_name || "Artwork",
        url: imp.artwork_url || "",
        note: imp.artwork_note || "",
        imprintDetails: [],
      });
    }
    map.get(artKey).imprintDetails.push(imp);
    linkedImprintIds.add(imp.id || `${imp.location}${imp.title}`);
  });

  // Unlinked imprints (no artwork reference) — attach to all artworks, or create a no-image entry
  const unlinked = allImprints.filter(
    (imp) => !imp.artwork_id && !imp.artwork_url && !imp.artwork_name
  );

  if (unlinked.length > 0) {
    const artworks = Array.from(map.values());
    if (artworks.length === 0) {
      // No artwork at all — create a placeholder so imprints still show
      map.set("__unlinked__", {
        id: "__unlinked__",
        name: "",
        url: "",
        note: "",
        imprintDetails: unlinked,
      });
    } else if (artworks.length === 1) {
      // One artwork — all imprints belong to it
      artworks[0].imprintDetails.push(...unlinked);
    } else {
      // Multiple artworks — attach unlinked imprints to each (shop didn't specify)
      artworks.forEach((art) => art.imprintDetails.push(...unlinked));
    }
  }

  return Array.from(map.values());
}

export default function ArtApproval() {
  const [order, setOrder] = useState(null);
  const [shop, setShop] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [approverName, setApproverName] = useState("");
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState("");
  const [checkedAll, setCheckedAll] = useState(false);

  const params = new URLSearchParams(window.location.search);
  const orderId = params.get("id");

  useEffect(() => {
    if (!orderId) { setError("No order ID provided."); setLoading(false); return; }

    base44.functions.invoke("createCheckoutSession", {
      action: "getOrder",
      orderId,
    }).then((res) => {
      if (res?.data?.error) { setError(res.data.error); return; }
      if (!res?.data?.order) { setError("Order not found."); return; }
      setOrder(res.data.order);
      setShop(res.data.shop || null);
    }).catch(() => setError("Failed to load order."))
      .finally(() => setLoading(false));
  }, [orderId]);

  async function handleApprove() {
    if (!checkedAll) { setApproveError("Please confirm you have reviewed all artwork above."); return; }
    if (!approverName.trim()) { setApproveError("Please enter your name to approve."); return; }
    setApproving(true);
    setApproveError("");
    try {
      const res = await base44.functions.invoke("createCheckoutSession", {
        action: "approveArtwork",
        orderId: order.id,
        approvedBy: approverName.trim(),
      });
      if (res?.data?.error) { setApproveError(res.data.error); return; }
      setOrder(res.data.order);
    } catch (err) {
      setApproveError(err?.message || "Failed to submit approval.");
    } finally {
      setApproving(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-10 max-w-md w-full text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-900 mb-2">Order Not Found</h2>
          <p className="text-slate-500 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  const artwork = getOrderArtwork(order);
  const alreadyApproved = order?.art_approved;

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* Header */}
        <div className="bg-slate-900 rounded-2xl px-4 sm:px-8 py-6 flex items-center gap-4">
          {shop?.logo_url ? (
            <img src={shop.logo_url} alt="Logo" className="w-12 h-12 object-contain rounded-lg" />
          ) : (
            <div className="w-12 h-12 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-black text-xl">
              {(shop?.shop_name || "S")[0]}
            </div>
          )}
          <div>
            <div className="text-white font-bold text-lg">{shop?.shop_name || "Shop"}</div>
            <div className="text-slate-400 text-sm">Artwork Approval — Order {order.order_id}</div>
          </div>
        </div>

        {/* Order info */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-4 sm:px-8 py-5">
          <div className="flex flex-wrap justify-between gap-3 text-sm">
            <div>
              <div className="text-xl font-black text-slate-900">{order.customer_name}</div>
              {order.job_title && <div className="text-slate-500 mt-0.5">{order.job_title}</div>}
            </div>
            <div className="text-right space-y-1">
              {order.due_date && (
                <div>
                  <span className="text-slate-400">In-Hands: </span>
                  <span className="font-semibold text-indigo-700">{fmtDate(order.due_date)}</span>
                </div>
              )}
              <div>
                <span className="text-slate-400">Status: </span>
                <span className="font-semibold text-slate-700">{order.status}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Artwork + paired print details */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-4 sm:px-8 py-6">
          <h3 className="text-base font-bold text-slate-900 mb-4 pb-3 border-b border-slate-100">
            Artwork for Approval
          </h3>

          {artwork.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              <ImageIcon className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No artwork files attached yet.</p>
              <p className="text-xs mt-1">Your print shop will upload artwork files here.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {artwork.map((art, idx) => (
                <div key={art.id || idx} className="border border-slate-200 rounded-xl overflow-hidden">

                  {/* Image or file link */}
                  {art.url ? (
                    art.url.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i) ? (
                      <img
                        src={art.url}
                        alt={art.name}
                        className="w-full max-h-80 object-contain bg-slate-50"
                      />
                    ) : (
                      <a
                        href={art.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 bg-slate-50 px-5 py-5 text-indigo-600 font-semibold text-sm hover:bg-indigo-50 transition"
                      >
                        <ImageIcon className="w-5 h-5 opacity-60" />
                        {art.name || "View File"}
                      </a>
                    )
                  ) : null}

                  <div className="px-4 py-4 space-y-3">
                    {/* Filename / note */}
                    {art.name && (
                      <div className="font-semibold text-slate-900 text-sm">{art.name}</div>
                    )}
                    {art.note && (
                      <div className="text-xs text-slate-500 italic">{art.note}</div>
                    )}

                    {/* Paired print details */}
                    {art.imprintDetails.length > 0 && (
                      <div className="space-y-2 pt-1">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                          Print Specs
                        </div>
                        {art.imprintDetails.map((imp, i) => (
                          <div key={imp.id || i} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5">
                            {imp.garmentLabel && (
                              <div className="text-xs text-slate-400 mb-1">{imp.garmentLabel}</div>
                            )}
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="font-semibold text-sm text-indigo-700 flex items-center gap-1">
                                <MapPin className="w-3.5 h-3.5 shrink-0" />
                                {imp.title ? `${imp.title} — ${imp.location || ""}` : imp.location || "Location"}
                              </span>
                              {imp.colors > 0 && (
                                <span className="text-xs text-slate-600 bg-white border border-slate-200 px-2 py-0.5 rounded-full">
                                  {imp.colors} color{imp.colors !== 1 ? "s" : ""}
                                </span>
                              )}
                              {imp.technique && (
                                <span className="text-xs text-slate-600 bg-white border border-slate-200 px-2 py-0.5 rounded-full">
                                  {imp.technique}
                                </span>
                              )}
                              {(imp.width || imp.height) && (
                                <span className="text-xs text-slate-500">
                                  {[imp.width && `${imp.width}"W`, imp.height && `${imp.height}"H`].filter(Boolean).join(" × ")}
                                </span>
                              )}
                            </div>
                            {imp.pantones && (
                              <div className="mt-1 text-xs text-purple-700 font-medium">
                                Pantones: {imp.pantones}
                              </div>
                            )}
                            {imp.details && (
                              <div className="mt-0.5 text-xs text-slate-500 italic">{imp.details}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Approval */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-4 sm:px-8 py-6">
          {alreadyApproved ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <CheckCircle2 className="w-14 h-14 text-emerald-500" />
              <div className="font-bold text-xl text-slate-900">Artwork Approved</div>
              <div className="text-sm text-slate-500">
                Approved by <span className="font-semibold text-slate-700">{order.art_approved_by}</span>
                {order.art_approved_at && (
                  <> on {new Date(order.art_approved_at).toLocaleDateString()}</>
                )}
              </div>
              <div className="mt-2 text-sm text-slate-500">
                We'll begin production shortly. Contact {shop?.shop_name || "the shop"} with any changes.
              </div>
            </div>
          ) : (
            <>
              <h3 className="text-base font-bold text-slate-900 mb-4">Approve Artwork</h3>
              <p className="text-sm text-slate-500 mb-4 leading-relaxed">
                By approving, you confirm that the artwork above is correct and ready for production.
                Changes after approval may incur additional fees.
              </p>

              <label className="flex items-start gap-3 mb-5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={checkedAll}
                  onChange={(e) => setCheckedAll(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded accent-indigo-600"
                />
                <span className="text-sm text-slate-700">
                  I have reviewed all artwork files and confirm they are correct and ready for printing.
                </span>
              </label>

              <div className="mb-4">
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Your Name (required)
                </label>
                <input
                  type="text"
                  value={approverName}
                  onChange={(e) => setApproverName(e.target.value)}
                  placeholder="Full name"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {approveError && (
                <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <span className="text-sm text-red-700">{approveError}</span>
                </div>
              )}

              <button
                onClick={handleApprove}
                disabled={approving}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-bold py-3.5 rounded-xl transition flex items-center justify-center gap-2"
              >
                {approving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                {approving ? "Submitting…" : "Approve Artwork & Begin Production"}
              </button>
            </>
          )}
        </div>

      </div>
    </div>
  );
}
