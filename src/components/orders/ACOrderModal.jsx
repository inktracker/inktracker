import { useState, useMemo, useEffect } from "react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { base44 } from "@/api/supabaseClient";
import { fmtMoney } from "../shared/pricing";
import { mergeItem, routeWarehouseForSku } from "@/lib/purchaseOrders";
import { SUPPLIERS, lookupStyle } from "@/api/suppliers";
import { X, Package, CheckCircle, Truck, Loader2, ExternalLink, AlertCircle } from "lucide-react";

// We DO NOT generate AS Colour SKUs anymore. Their format includes an
// internal colour code (e.g. "WHI_M") and a per-size fit letter (F/G/H/...)
// that can't be derived from quote data. Confirmed via /v1/inventory/items:
//   "5102-WHITEHEATHER-M" (generated)  →  AS Colour says "out of stock"
//   "5102-WHI_M-H-M"      (canonical)  →  accepted
//
// Instead we look up each style via acLookupStyle when the modal opens,
// then match each line by (colour, size) to the canonical variant.sku.

function buildAcLines(lineItems) {
  const lines = [];
  for (const li of lineItems) {
    const sizes = li.sizes || {};
    for (const [size, qty] of Object.entries(sizes)) {
      const n = parseInt(qty, 10) || 0;
      if (n <= 0) continue;
      lines.push({ li, size, qty: n });
    }
  }
  return lines;
}

export default function ACOrderModal({ order, user, onClose, onPOCreated }) {
  const acLineItems = useMemo(
    () => (order.line_items || []).filter((li) => li.supplier === SUPPLIERS.AC),
    [order],
  );

  const rawLines = useMemo(() => buildAcLines(acLineItems), [acLineItems]);
  const totalQty = rawLines.reduce((s, l) => s + l.qty, 0);

  // Per-row SKU overrides keyed by line index + size. Empty until the
  // resolver below fills it from AS Colour's canonical variant data.
  const [skuOverrides, setSkuOverrides] = useState({});
  // AS Colour caps reference at 20 chars, so "PO for ORD-2026-XXXXX"
  // (21+ chars) would always reject. Use the bare order_id, which fits
  // (e.g. "ORD-2026-0WCV9" = 14 chars). User can edit before submit.
  const [reference, setReference] = useState(
    String(order.order_id || `Order ${order.id?.slice(0, 8)}` || "").slice(0, 20),
  );
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  const [createdPO, setCreatedPO] = useState(null);

  // Canonical SKU map keyed by `${idx}-${size}`, filled by the
  // resolver useEffect below. Loading flag drives a small status hint.
  const [resolvedSkus, setResolvedSkus] = useState({});
  const [resolveLoading, setResolveLoading] = useState(false);
  const [unresolvedCount, setUnresolvedCount] = useState(0);
  // Stock-per-warehouse map keyed by SKU, also from the resolver.
  // Drives auto-routing of warehouse per item at create time.
  const [stockBySku, setStockBySku] = useState({});

  // On mount: for each unique style code in this order's AC items, hit
  // acLookupStyle once. Build a (colour, size) → canonical SKU map and
  // pre-fill the rows. The user can still override per-row.
  useEffect(() => {
    if (rawLines.length === 0) return;
    const styleCodes = Array.from(new Set(
      rawLines
        .map((line) => String(
          line.li.supplierStyleNumber || line.li.resolvedStyleNumber || line.li.styleNumber || line.li.style || "",
        ).trim())
        .filter(Boolean),
    ));
    if (styleCodes.length === 0) return;
    let cancelled = false;
    setResolveLoading(true);
    Promise.all(styleCodes.map((code) =>
      lookupStyle(SUPPLIERS.AC, { styleCode: code }).catch(() => null),
    ))
      .then((results) => {
        if (cancelled) return;
        const styleToVariants = {};
        const stockMerged = {};
        for (let i = 0; i < styleCodes.length; i++) {
          const r = results[i];
          const product = r?.product || (r?.matches || [])[0] || r;
          styleToVariants[styleCodes[i]] = product?.variants || [];
          // Merge per-SKU stock from each style's lookup into one map
          Object.assign(stockMerged, product?.stockBySkuWarehouse || {});
        }
        const matched = {};
        let unresolved = 0;
        for (let idx = 0; idx < rawLines.length; idx++) {
          const line = rawLines[idx];
          const code = String(
            line.li.supplierStyleNumber || line.li.resolvedStyleNumber || line.li.styleNumber || line.li.style || "",
          ).trim();
          const colour = String(line.li.garmentColor || "").trim();
          const size = String(line.size || "").trim();
          const variants = styleToVariants[code] || [];
          const match = variants.find((v) =>
            v.colour?.toUpperCase() === colour.toUpperCase() &&
            v.size?.toUpperCase() === size.toUpperCase(),
          );
          if (match?.sku) matched[`${idx}-${size}`] = match.sku;
          else unresolved++;
        }
        setResolvedSkus(matched);
        setStockBySku(stockMerged);
        setUnresolvedCount(unresolved);
      })
      .finally(() => { if (!cancelled) setResolveLoading(false); });
    return () => { cancelled = true; };
  }, [rawLines]);

  function getSku(line, idx) {
    const key = `${idx}-${line.size}`;
    return skuOverrides[key] ?? resolvedSkus[key] ?? "";
  }

  function setSku(idx, size, sku) {
    setSkuOverrides((prev) => ({ ...prev, [`${idx}-${size}`]: sku }));
  }

  async function handleCreate() {
    if (!user) return;
    setError(null);
    setCreating(true);
    try {
      // Build items via mergeItem so identical SKUs roll up to one
      // line with summed quantity (matches the PO page's contract).
      const defaultWh = user?.default_ac_warehouse || "CA";
      let items = [];
      for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i];
        const sku = getSku(line, i).trim();
        if (!sku) continue;
        // Route warehouse for this specific SKU using live stock.
        const stock = stockBySku[sku] || {};
        const { warehouse } = routeWarehouseForSku(stock, defaultWh, line.qty);
        items = mergeItem(items, {
          sku,
          styleCode:
            line.li.supplierStyleNumber ||
            line.li.resolvedStyleNumber ||
            line.li.styleNumber ||
            "",
          color: line.li.garmentColor || "",
          size: line.size,
          quantity: line.qty,
          unitPrice: Number(line.li.garmentCost || line.li.casePrice || 0),
          warehouse,
        });
      }
      if (items.length === 0) {
        setError("Every row needs a SKU before we can create the PO.");
        return;
      }

      const created = await base44.entities.PurchaseOrder.create({
        shop_owner: user.email,
        supplier: SUPPLIERS.AC,
        status: "draft",
        reference: reference.trim() || `PO for ${order.order_id || ""}`,
        ship_to: defaultShipTo(user),
        items,
        source_order_id: order.id,
      });

      setCreatedPO(created);
      onPOCreated?.(created);
    } catch (err) {
      console.error("Create PO from order failed:", err);
      setError(err?.message || "Could not create the purchase order.");
    } finally {
      setCreating(false);
    }
  }

  if (createdPO) {
    return (
      <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 text-center">
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-emerald-600" />
          </div>
          <h3 className="text-xl font-bold text-slate-900">Draft PO created</h3>
          <p className="text-sm text-slate-500 mt-2">
            <strong>{createdPO.reference}</strong> with {createdPO.items?.length || 0} item{createdPO.items?.length === 1 ? "" : "s"}.
            Review the SKUs, set shipping method + ship-to, then submit to AS Colour.
          </p>
          <Link
            to={createPageUrl("PurchaseOrders")}
            onClick={onClose}
            className="mt-6 inline-flex items-center justify-center gap-2 w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 rounded-xl transition"
          >
            <ExternalLink className="w-4 h-4" /> Open Purchase Orders
          </Link>
          <button onClick={onClose} className="mt-2 w-full text-slate-500 hover:text-slate-700 font-semibold py-2 text-sm transition">
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50 rounded-t-2xl flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Create AS Colour PO</h2>
            <p className="text-xs text-slate-500 mt-0.5">From order {order.order_id || order.id}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-200 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-6 space-y-4">
          {acLineItems.length === 0 ? (
            <div className="text-center py-10">
              <Package className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <div className="text-slate-500 font-semibold">No AS Colour items in this order</div>
              <div className="text-xs text-slate-400 mt-1">
                Only line items with supplier = "AS Colour" can be ordered through this flow.
              </div>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">PO reference</label>
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
              </div>

              <div className="text-xs text-slate-500 font-semibold uppercase tracking-widest">
                {totalQty} garments across {acLineItems.length} line item{acLineItems.length !== 1 ? "s" : ""}
              </div>

              {resolveLoading && (
                <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Looking up canonical AS Colour SKUs…
                </div>
              )}
              {!resolveLoading && unresolvedCount > 0 && (
                <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  <span>
                    Couldn't match {unresolvedCount} item{unresolvedCount === 1 ? "" : "s"} to AS Colour's catalog — usually means the colour or size doesn't exist. Edit the SKU manually before creating the PO, or leave blank to skip.
                  </span>
                </div>
              )}

              {rawLines.map((line, i) => {
                const li = line.li;
                const cost = Number(li.garmentCost || li.casePrice || 0);
                const lineTotal = cost * line.qty;
                return (
                  <div key={i} className="border border-slate-200 rounded-2xl p-4 space-y-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="text-sm font-bold text-slate-800">
                          {li.brand || "AS Colour"} {li.supplierStyleNumber || li.resolvedStyleNumber || li.style} — {li.garmentColor}
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">Size {line.size} · qty {line.qty}</div>
                      </div>
                      <div className="text-sm font-bold text-slate-700">{fmtMoney(lineTotal)}</div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">
                        SKU
                        {resolvedSkus[`${i}-${line.size}`] && skuOverrides[`${i}-${line.size}`] === undefined && (
                          <span className="ml-1.5 text-emerald-600 normal-case font-normal tracking-normal">✓ AS Colour canonical</span>
                        )}
                      </label>
                      <input
                        value={getSku(line, i)}
                        onChange={(e) => setSku(i, line.size, e.target.value)}
                        className="w-full font-mono text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-300"
                        placeholder={resolveLoading ? "Resolving…" : "e.g. 5102-WHI_M-H-M"}
                      />
                    </div>
                  </div>
                );
              })}

              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
                <strong>SKU format:</strong> AS Colour uses STYLE-COLOR_CODE-FIT-SIZE (e.g. <span className="font-mono">5102-WHI_M-H-M</span>). Auto-matched from AS Colour's catalog where possible — verify before creating the PO.
              </div>

              {error && (
                <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">{error}</div>
              )}
            </>
          )}
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl flex-shrink-0">
          <button onClick={onClose} className="px-5 border border-slate-200 text-slate-500 text-sm font-semibold py-2.5 rounded-xl hover:bg-slate-100 transition">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={acLineItems.length === 0 || creating}
            className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-sm font-semibold py-2.5 rounded-xl transition flex items-center justify-center gap-2"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />}
            {creating ? "Creating…" : "Create draft PO"}
          </button>
        </div>
      </div>
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
