import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { base44 } from "@/api/supabaseClient";
import { fmtMoney } from "../shared/pricing";
import { mergeItem } from "@/lib/purchaseOrders";
import { SUPPLIERS } from "@/api/suppliers";
import { X, Package, CheckCircle, Truck, Loader2, ExternalLink } from "lucide-react";

const SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL"];

// AS Colour SKU shape: STYLE-COLOR-FIT-SIZE (e.g. 5050-BLACK-J-XL).
// We don't know the fit code from the line item, so default to no fit
// segment and let the shop edit per-row before creating the PO.
function defaultSku(li, size) {
  const style = String(
    li.supplierStyleNumber ||
    li.resolvedStyleNumber ||
    li.styleNumber ||
    li.style ||
    "",
  ).toUpperCase();
  const color = String(li.garmentColor || "")
    .replace(/[^A-Z0-9]/gi, "")
    .toUpperCase();
  const sz = String(size || "").toUpperCase();
  if (!style || !color || !sz) return "";
  return `${style}-${color}-${sz}`;
}

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

  // Per-row SKU overrides keyed by line index + size
  const [skuOverrides, setSkuOverrides] = useState({});
  const [reference, setReference] = useState(
    `PO for ${order.order_id || `Order ${order.id?.slice(0, 8)}`}`,
  );
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  const [createdPO, setCreatedPO] = useState(null);

  function getSku(line, idx) {
    const key = `${idx}-${line.size}`;
    return skuOverrides[key] ?? defaultSku(line.li, line.size);
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
      let items = [];
      for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i];
        const sku = getSku(line, i).trim();
        if (!sku) continue;
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
          warehouse: "",
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
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">SKU</label>
                      <input
                        value={getSku(line, i)}
                        onChange={(e) => setSku(i, line.size, e.target.value)}
                        className="w-full font-mono text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-300"
                        placeholder="e.g. 5050-BLACK-XL"
                      />
                    </div>
                  </div>
                );
              })}

              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
                <strong>Verify SKUs:</strong> AS Colour SKUs follow STYLE-COLOR-(FIT)-SIZE (e.g. <span className="font-mono">5050-BLACK-XL</span>). Adjust as needed before creating the PO.
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
