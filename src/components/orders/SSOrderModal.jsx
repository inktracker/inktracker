import { useState } from "react";
import { supabase, base44 } from "@/api/supabaseClient";
import { fmtMoney } from "../shared/pricing";
import { X, Package, AlertCircle, CheckCircle, Loader2, ChevronRight } from "lucide-react";

const SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL"];

// Build SKU: S&S SKU is typically styleName + colorCode (no space).
// We store whatever we have; the user can override in the line.
function guessSkuFromLineItem(li) {
  const style = li.supplierStyleNumber || li.resolvedStyleNumber || li.styleNumber || li.garmentNumber || li.style || "";
  const color = li.garmentColor || "";
  // Remove spaces, punctuation from color code
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
      // S&S SKU format: STYLE + COLOR + SIZE (e.g. 5000BLK-S)
      const fullSku = sku ? `${sku}-${size}` : "";
      lines.push({ li, size, qty: n, sku: fullSku, rawSku: sku });
    }
  }
  return lines;
}

// Group lines by style+color for display
function groupLines(lines) {
  const groups = {};
  for (const line of lines) {
    const key = `${line.rawSku}`;
    if (!groups[key]) {
      groups[key] = {
        li: line.li,
        sku: line.rawSku,
        sizes: {},
        totalQty: 0,
      };
    }
    groups[key].sizes[line.size] = line.qty;
    groups[key].totalQty += line.qty;
  }
  return Object.values(groups);
}

const STEP = { REVIEW: "review", SHIP: "ship", CONFIRM: "confirm", DONE: "done" };

export default function SSOrderModal({ order, onClose, onOrderPlaced }) {
  const ssLineItems = (order.line_items || []).filter(
    (li) => li.supplier === "S&S Activewear" || li.supplierStyleNumber || li.resolvedStyleNumber
  );

  const [step, setStep] = useState(STEP.REVIEW);
  const [shipTo, setShipTo] = useState({
    name: "",
    address1: "",
    address2: "",
    city: "",
    state: "",
    zip: "",
    phone: "",
    email: "",
  });
  const [skuOverrides, setSkuOverrides] = useState({});
  const [placing, setPlacing] = useState(false);
  const [placedOrder, setPlacedOrder] = useState(null);
  const [placeError, setPlaceError] = useState("");
  const [testOrder, setTestOrder] = useState(false);

  const rawLines = buildOrderLines(ssLineItems);
  const grouped = groupLines(rawLines);
  const totalQty = rawLines.reduce((s, l) => s + l.qty, 0);

  // Allow SKU overrides
  function getSkuForLine(line, size) {
    const key = `${line.rawSku}-${size}`;
    return skuOverrides[key] ?? `${line.rawSku}-${size}`;
  }

  const finalLines = rawLines.map((line) => ({
    sku: getSkuForLine(line, line.size),
    qty: line.qty,
  })).filter((l) => l.sku && l.qty > 0);

  async function handlePlaceOrder() {
    setPlacing(true);
    setPlaceError("");

    try {
      const poNumber = `INKT-${order.order_id || order.id || Date.now().toString(36).toUpperCase()}`;
      const { data, error: fnError } = await supabase.functions.invoke("ssPlaceOrder", {
        body: {
          poNumber,
          shipTo,
          lines: finalLines,
          shippingMethod: "GROUND",
          testOrder,
        },
      });

      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);

      setPlacedOrder(data?.order ?? data);
      setStep(STEP.DONE);

      // Optionally write the SS order number back to the inktracker order
      if (data?.order?.orderNumber || data?.order?.id) {
        const ssOrderId = data.order.orderNumber ?? data.order.id;
        try {
          await base44.entities.Order.update(order.id, { ss_order_id: ssOrderId });
        } catch {}
      }

      onOrderPlaced?.();
    } catch (err) {
      setPlaceError(err.message || "Failed to place order with S&S. Please try again.");
    } finally {
      setPlacing(false);
    }
  }

  const shipToValid =
    shipTo.name && shipTo.address1 && shipTo.city && shipTo.state && shipTo.zip;

  return (
    <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50 rounded-t-2xl flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Order from S&S Activewear</h2>
            <p className="text-xs text-slate-500 mt-0.5">Order #{order.order_id || order.id}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-200 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step progress */}
        {step !== STEP.DONE && (
          <div className="flex items-center gap-2 px-6 py-3 border-b border-slate-100 flex-shrink-0">
            {[
              { id: STEP.REVIEW, label: "Review" },
              { id: STEP.SHIP, label: "Ship To" },
              { id: STEP.CONFIRM, label: "Confirm" },
            ].map((s, i, arr) => (
              <div key={s.id} className="flex items-center gap-2">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  step === s.id ? "bg-indigo-600 text-white" :
                  arr.findIndex((x) => x.id === step) > i ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-500"
                }`}>
                  {arr.findIndex((x) => x.id === step) > i ? "✓" : i + 1}
                </div>
                <span className={`text-xs font-semibold ${step === s.id ? "text-indigo-700" : "text-slate-400"}`}>{s.label}</span>
                {i < arr.length - 1 && <ChevronRight className="w-3 h-3 text-slate-300" />}
              </div>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-6">
          {/* STEP: REVIEW */}
          {step === STEP.REVIEW && (
            <div className="space-y-4">
              {ssLineItems.length === 0 ? (
                <div className="text-center py-10">
                  <Package className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                  <div className="text-slate-500 font-semibold">No S&S items in this order</div>
                  <div className="text-xs text-slate-400 mt-1">
                    Only items with S&S style numbers can be ordered through this integration
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

                        {/* Size breakdown */}
                        <div className="grid grid-cols-4 gap-1.5">
                          {SIZES.filter((s) => group.sizes[s] > 0).map((size) => {
                            const qty = group.sizes[size] || 0;
                            const lineKey = `${group.sku}-${size}`;
                            const currentSku = skuOverrides[lineKey] ?? `${group.sku}-${size}`;
                            return (
                              <div key={size} className="bg-slate-50 rounded-lg p-2 text-center">
                                <div className="text-xs font-bold text-slate-500">{size}</div>
                                <div className="text-sm font-bold text-slate-800">×{qty}</div>
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
                    <strong>Verify SKUs:</strong> S&S SKUs follow the format STYLE + COLOR + SIZE (e.g. <span className="font-mono">5000BLK-L</span>). Edit any SKU above if needed before continuing.
                  </div>
                </>
              )}
            </div>
          )}

          {/* STEP: SHIP TO */}
          {step === STEP.SHIP && (
            <div className="space-y-4">
              <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Ship-To Address</div>

              <div className="grid gap-3 grid-cols-2">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Company / Name *</label>
                  <input value={shipTo.name} onChange={(e) => setShipTo({ ...shipTo, name: e.target.value })}
                    placeholder="My Print Shop" className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Address Line 1 *</label>
                  <input value={shipTo.address1} onChange={(e) => setShipTo({ ...shipTo, address1: e.target.value })}
                    placeholder="123 Main St" className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Address Line 2</label>
                  <input value={shipTo.address2} onChange={(e) => setShipTo({ ...shipTo, address2: e.target.value })}
                    placeholder="Suite 100" className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">City *</label>
                  <input value={shipTo.city} onChange={(e) => setShipTo({ ...shipTo, city: e.target.value })}
                    placeholder="Las Vegas" className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">State *</label>
                  <input value={shipTo.state} onChange={(e) => setShipTo({ ...shipTo, state: e.target.value })}
                    placeholder="NV" maxLength={2} className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 uppercase" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">ZIP *</label>
                  <input value={shipTo.zip} onChange={(e) => setShipTo({ ...shipTo, zip: e.target.value })}
                    placeholder="89101" className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Phone</label>
                  <input value={shipTo.phone} onChange={(e) => setShipTo({ ...shipTo, phone: e.target.value })}
                    placeholder="(775) 555-0000" type="tel" className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
              </div>
            </div>
          )}

          {/* STEP: CONFIRM */}
          {step === STEP.CONFIRM && (
            <div className="space-y-4">
              <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 space-y-2">
                <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">Order Summary</div>
                <div className="grid grid-cols-2 gap-1 text-sm">
                  <span className="text-slate-500">PO Number</span>
                  <span className="font-semibold text-slate-800">INKT-{order.order_id || order.id}</span>
                  <span className="text-slate-500">Total Pieces</span>
                  <span className="font-semibold text-slate-800">{totalQty}</span>
                  <span className="text-slate-500">Ship To</span>
                  <span className="font-semibold text-slate-800">{shipTo.name}, {shipTo.city} {shipTo.state}</span>
                  <span className="text-slate-500">Method</span>
                  <span className="font-semibold text-slate-800">Ground</span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">Lines to Submit</div>
                {finalLines.map((line, i) => (
                  <div key={i} className="flex justify-between items-center text-sm border border-slate-200 rounded-xl px-3 py-2">
                    <span className="font-mono text-slate-600">{line.sku}</span>
                    <span className="font-bold text-slate-800">×{line.qty}</span>
                  </div>
                ))}
              </div>

              {placeError && (
                <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                  <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-red-700">{placeError}</div>
                </div>
              )}

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={testOrder} onChange={(e) => setTestOrder(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 accent-indigo-600" />
                <span className="text-sm text-slate-600">
                  <span className="font-semibold">Test order</span> — submit to S&S sandbox, no real order placed
                </span>
              </label>
            </div>
          )}

          {/* STEP: DONE */}
          {step === STEP.DONE && (
            <div className="text-center py-8 space-y-4">
              <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle className="w-8 h-8 text-emerald-600" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900">Order Placed!</h3>
                <p className="text-sm text-slate-500 mt-1">Your order has been submitted to S&S Activewear.</p>
              </div>
              {placedOrder && (
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-left space-y-1.5">
                  {placedOrder.orderNumber && (
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500">S&S Order #</span>
                      <span className="font-bold text-slate-900 font-mono">{placedOrder.orderNumber}</span>
                    </div>
                  )}
                  {placedOrder.status && (
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500">Status</span>
                      <span className="font-bold text-slate-900">{placedOrder.status}</span>
                    </div>
                  )}
                  {placedOrder.estimatedShipDate && (
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500">Est. Ship Date</span>
                      <span className="font-bold text-slate-900">{placedOrder.estimatedShipDate}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl flex-shrink-0">
          {step === STEP.DONE ? (
            <button onClick={onClose} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 rounded-xl transition">
              Done
            </button>
          ) : step === STEP.REVIEW ? (
            <>
              <button onClick={onClose} className="px-5 border border-slate-200 text-slate-500 text-sm font-semibold py-2.5 rounded-xl hover:bg-slate-100 transition">
                Cancel
              </button>
              <button
                onClick={() => setStep(STEP.SHIP)}
                disabled={ssLineItems.length === 0 || finalLines.length === 0}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-sm font-semibold py-2.5 rounded-xl transition"
              >
                Continue — Enter Ship-To
              </button>
            </>
          ) : step === STEP.SHIP ? (
            <>
              <button onClick={() => setStep(STEP.REVIEW)} className="px-5 border border-slate-200 text-slate-500 text-sm font-semibold py-2.5 rounded-xl hover:bg-slate-100 transition">
                Back
              </button>
              <button
                onClick={() => setStep(STEP.CONFIRM)}
                disabled={!shipToValid}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-sm font-semibold py-2.5 rounded-xl transition"
              >
                Review Order
              </button>
            </>
          ) : step === STEP.CONFIRM ? (
            <>
              <button onClick={() => setStep(STEP.SHIP)} disabled={placing} className="px-5 border border-slate-200 text-slate-500 text-sm font-semibold py-2.5 rounded-xl hover:bg-slate-100 transition">
                Back
              </button>
              <button
                onClick={handlePlaceOrder}
                disabled={placing || finalLines.length === 0}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white text-sm font-semibold py-2.5 rounded-xl transition flex items-center justify-center gap-2"
              >
                {placing ? <><Loader2 className="w-4 h-4 animate-spin" /> Placing Order…</> : "Place Order with S&S"}
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
