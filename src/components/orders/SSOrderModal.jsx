import { useState } from "react";
import { fmtMoney } from "../shared/pricing";
import { X, Package, CheckCircle, ShoppingCart } from "lucide-react";

const SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL"];

function guessSkuFromLineItem(li) {
  const style = li.supplierStyleNumber || li.resolvedStyleNumber || li.styleNumber || li.garmentNumber || li.style || "";
  const color = li.garmentColor || "";
  const colorCode = color.replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 6);
  return style && colorCode ? `${style.toUpperCase()}${colorCode}` : "";
}

function buildOrderLines(lineItems) {
  const lines = [];
  for (const li of lineItems) {
    const sizes = li.sizes || {};
    const sku = guessSkuFromLineItem(li);
    for (const [size, qty] of Object.entries(sizes)) {
      const n = parseInt(qty, 10) || 0;
      if (n <= 0) continue;
      const fullSku = sku ? `${sku}-${size}` : "";
      lines.push({ li, size, qty: n, sku: fullSku, rawSku: sku });
    }
  }
  return lines;
}

function groupLines(lines) {
  const groups = {};
  for (const line of lines) {
    const key = `${line.rawSku}`;
    if (!groups[key]) {
      groups[key] = { li: line.li, sku: line.rawSku, sizes: {}, totalQty: 0 };
    }
    groups[key].sizes[line.size] = line.qty;
    groups[key].totalQty += line.qty;
  }
  return Object.values(groups);
}

export default function SSOrderModal({ order, onClose, onOrderPlaced }) {
  const ssLineItems = (order.line_items || []).filter(
    (li) => li.supplier === "S&S Activewear" || li.supplierStyleNumber || li.resolvedStyleNumber
  );

  const [skuOverrides, setSkuOverrides] = useState({});
  const [added, setAdded] = useState(false);

  const rawLines = buildOrderLines(ssLineItems);
  const grouped = groupLines(rawLines);
  const totalQty = rawLines.reduce((s, l) => s + l.qty, 0);

  function getSkuForLine(line, size) {
    const key = `${line.rawSku}-${size}`;
    return skuOverrides[key] ?? `${line.rawSku}-${size}`;
  }

  const finalLines = rawLines.map((line) => ({
    sku: getSkuForLine(line, line.size),
    qty: line.qty,
  })).filter((l) => l.sku && l.qty > 0);

  function handleAddToCart() {
    // Build cart items matching the shape Inventory's SsCartModal expects:
    // { product, style, color, size, qty, price, sku }
    const cartItems = rawLines.map(l => ({
      product: l.li.styleName || l.li.resolvedTitle || l.li.brand || "",
      style: l.li.supplierStyleNumber || l.li.resolvedStyleNumber || l.li.styleNumber || l.li.style || "",
      color: l.li.garmentColor || "",
      size: l.size,
      qty: l.qty,
      price: l.li.garmentCost || l.li.casePrice || 0,
      sku: getSkuForLine(l, l.size),
    }));

    // Add to localStorage cart (shared with Inventory page)
    try {
      const existing = JSON.parse(localStorage.getItem("ssCart") || "[]");
      const updated = [...existing, ...cartItems];
      localStorage.setItem("ssCart", JSON.stringify(updated));
    } catch {
      localStorage.setItem("ssCart", JSON.stringify(cartItems));
    }

    setAdded(true);
    onOrderPlaced?.();
  }

  if (added) {
    return (
      <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 text-center">
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-emerald-600" />
          </div>
          <h3 className="text-xl font-bold text-slate-900">Added to Cart</h3>
          <p className="text-sm text-slate-500 mt-2">
            {totalQty} items added to your S&S cart. Go to <strong>Inventory</strong> to review and place the order.
          </p>
          <button onClick={onClose} className="mt-6 w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 rounded-xl transition">
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50 rounded-t-2xl flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Add to S&S Cart</h2>
            <p className="text-xs text-slate-500 mt-0.5">Order #{order.order_id || order.id}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-200 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-6 space-y-4">
          {ssLineItems.length === 0 ? (
            <div className="text-center py-10">
              <Package className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <div className="text-slate-500 font-semibold">No S&S items in this order</div>
              <div className="text-xs text-slate-400 mt-1">
                Only items with S&S style numbers can be added to cart
              </div>
            </div>
          ) : (
            <>
              <div className="text-xs text-slate-500 font-semibold uppercase tracking-widest">
                {totalQty} garments across {ssLineItems.length} line item{ssLineItems.length !== 1 ? "s" : ""}
              </div>

              {grouped.map((group, gi) => {
                const li = group.li;
                const garmentCost = li.garmentCost || li.casePrice || 0;
                const groupTotal = garmentCost * group.totalQty;

                return (
                  <div key={gi} className="border border-slate-200 rounded-2xl p-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="text-sm font-bold text-slate-800">
                          {li.brand} {li.supplierStyleNumber || li.resolvedStyleNumber || li.style} — {li.garmentColor}
                        </div>
                        <div className="text-xs text-slate-400 font-mono mt-0.5">SKU base: {group.sku || "—"}</div>
                      </div>
                      <div className="text-sm font-bold text-slate-700">{fmtMoney(groupTotal)}</div>
                    </div>

                    <div className="grid grid-cols-4 gap-1.5">
                      {SIZES.filter((s) => group.sizes[s] > 0).map((size) => {
                        const qty = group.sizes[size] || 0;
                        const lineKey = `${group.sku}-${size}`;
                        const currentSku = skuOverrides[lineKey] ?? `${group.sku}-${size}`;
                        return (
                          <div key={size} className="bg-slate-50 rounded-lg p-2 text-center">
                            <div className="text-xs font-bold text-slate-500">{size}</div>
                            <div className="text-sm font-bold text-slate-800">x{qty}</div>
                            <input
                              value={currentSku}
                              onChange={(e) => setSkuOverrides((prev) => ({ ...prev, [lineKey]: e.target.value }))}
                              className="w-full text-[10px] font-mono border border-slate-200 rounded px-1 py-0.5 mt-1 text-center focus:outline-none focus:ring-1 focus:ring-indigo-300"
                              title="S&S SKU — edit if needed"
                              placeholder="SKU"
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
                <strong>Verify SKUs:</strong> S&S SKUs follow the format STYLE + COLOR + SIZE (e.g. <span className="font-mono">5000BLK-L</span>). Edit any SKU above if needed.
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl flex-shrink-0">
          <button onClick={onClose} className="px-5 border border-slate-200 text-slate-500 text-sm font-semibold py-2.5 rounded-xl hover:bg-slate-100 transition">
            Cancel
          </button>
          <button
            onClick={handleAddToCart}
            disabled={ssLineItems.length === 0 || finalLines.length === 0}
            className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white text-sm font-semibold py-2.5 rounded-xl transition flex items-center justify-center gap-2"
          >
            <ShoppingCart className="w-4 h-4" /> Add {totalQty} Items to Cart
          </button>
        </div>
      </div>
    </div>
  );
}
