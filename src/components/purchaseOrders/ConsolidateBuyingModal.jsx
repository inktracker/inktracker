import { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/supabaseClient";
import { shopScope } from "@/lib/shopScope";
import { lookupStyle, SUPPLIERS } from "@/api/suppliers";
import { fmtMoney } from "@/components/shared/pricing";
import { aggregateBlankNeeds, ordersNeedingGoods } from "@/lib/orders/consolidateBlankNeeds";
import { resolveAcNeedsToItems } from "@/lib/orders/resolveAcPoItems";
import { buildSsPoItems } from "@/lib/orders/buildSsPoItems";
import ModalBackdrop from "@/components/shared/ModalBackdrop";
import { Loader2, Truck, AlertCircle, PackageCheck, X } from "lucide-react";

// Consolidated buying: pull every OPEN order that still needs blanks, sum the
// garments across jobs, and let the shop cut ONE purchase order per supplier
// instead of a PO per order. AS Colour orders are created SUBMITTABLE (SKUs
// resolved from acLookupStyle); other suppliers show the summed needs so the
// shop can order them directly (S&S ordering flows through the Inventory cart
// today — wiring it into consolidation is the next phase).

function sizesSummary(sizes) {
  return Object.entries(sizes || {})
    .filter(([, n]) => (Number(n) || 0) > 0)
    .map(([sz, n]) => `${sz}·${n}`)
    .join("  ");
}

// AS Colour lookup → the product-with-variants shape resolveAcNeedsToItems wants.
async function acLookup(styleNumber) {
  const result = await lookupStyle(SUPPLIERS.AC, { styleCode: styleNumber });
  const matches = result?.matches || result?.results || result?.items || result?.products || [];
  const first = matches[0] || result?.product || (result?.variants ? result : null);
  return first?.variants ? first : null;
}

export default function ConsolidateBuyingModal({ user, existingPos, onClose, onCreated }) {
  const [loading, setLoading] = useState(true);
  const [openOrders, setOpenOrders] = useState([]);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [busySupplier, setBusySupplier] = useState(null);
  const [createError, setCreateError] = useState(null);
  const [resolveWarn, setResolveWarn] = useState(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const all = await base44.entities.Order.all({ shop_owner: shopScope(user) }, "-created_date");
        if (!active) return;
        const open = ordersNeedingGoods(all, existingPos);
        setOpenOrders(open);
        setSelectedIds(new Set(open.map((o) => o.id)));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [user, existingPos]);

  const selectedOrders = useMemo(
    () => openOrders.filter((o) => selectedIds.has(o.id)),
    [openOrders, selectedIds],
  );
  const { bySupplier, unresolved } = useMemo(
    () => aggregateBlankNeeds(selectedOrders),
    [selectedOrders],
  );
  const supplierNames = Object.keys(bySupplier).sort();

  function toggleOrder(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Order ids a supplier group covers — so submit ticks every one of them.
  const coveredIds = (group) => [
    ...new Set(group.lines.flatMap((l) => l.sourceOrders.map((s) => s.orderId)).filter(Boolean)),
  ];

  // notes → the supplier's order notes on submit, so keep it supplier-safe:
  // provenance only, no internal "couldn't resolve" chatter (that's the toast).
  async function createPo(supplier, items, orderIds) {
    return base44.entities.PurchaseOrder.create({
      shop_owner: shopScope(user),
      supplier,
      status: "draft",
      reference: `PO-${new Date().toISOString().slice(0, 10)}`,
      items,
      source_order_ids: orderIds,
      notes: `Consolidated from ${orderIds.length} open order${orderIds.length === 1 ? "" : "s"}.`,
    });
  }

  async function createAcPo() {
    const group = bySupplier[SUPPLIERS.AC];
    if (!group || busySupplier) return;
    setBusySupplier(SUPPLIERS.AC);
    setCreateError(null);
    setResolveWarn(null);
    try {
      const { items, unresolved: unres, lookupErrors } = await resolveAcNeedsToItems(group.lines, { lookup: acLookup });
      if (items.length === 0) {
        setCreateError("Couldn't resolve any AS Colour items — every style lookup failed or matched no variants. Check the style numbers, or add items manually on the PO.");
        return;
      }
      const created = await createPo(SUPPLIERS.AC, items, coveredIds(group));
      if (unres.length || lookupErrors.length) setResolveWarn({ unresolved: unres, lookupErrors });
      onCreated?.(created, { unresolved: unres, lookupErrors });
    } catch (err) {
      setCreateError(err?.message || "Couldn't create the consolidated PO.");
    } finally {
      setBusySupplier(null);
    }
  }

  async function createSsPo() {
    const group = bySupplier[SUPPLIERS.SS];
    if (!group || busySupplier) return;
    setBusySupplier(SUPPLIERS.SS);
    setCreateError(null);
    try {
      const items = buildSsPoItems(group.lines); // S&S resolves real SKUs at submit
      if (items.length === 0) {
        setCreateError("No S&S items to order from the selected jobs.");
        return;
      }
      const created = await createPo(SUPPLIERS.SS, items, coveredIds(group));
      onCreated?.(created, {});
    } catch (err) {
      setCreateError(err?.message || "Couldn't create the consolidated S&S PO.");
    } finally {
      setBusySupplier(null);
    }
  }

  return (
    <ModalBackdrop onClose={onClose} z="z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl mt-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 sticky top-0 bg-white">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <PackageCheck className="w-5 h-5 text-teal-600" /> Consolidate Buying
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">Order blanks for your open jobs — one PO per supplier.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-5">
          {loading ? (
            <div className="py-10 text-center text-slate-500"><Loader2 className="w-5 h-5 animate-spin inline" /> Loading open orders…</div>
          ) : openOrders.length === 0 ? (
            <div className="py-10 text-center text-slate-500 text-sm">No open orders need goods ordered right now.</div>
          ) : (
            <>
              {/* Which jobs to buy for */}
              <div>
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Jobs to order for ({selectedOrders.length}/{openOrders.length})
                </div>
                <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-44 overflow-y-auto">
                  {openOrders.map((o) => {
                    const qty = (o.line_items || []).reduce(
                      (s, li) => s + Object.values(li?.sizes || {}).reduce((a, b) => a + (Number(b) || 0), 0), 0);
                    return (
                      <label key={o.id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                        <input type="checkbox" checked={selectedIds.has(o.id)} onChange={() => toggleOrder(o.id)} className="accent-teal-600" />
                        <span className="font-mono text-xs text-slate-500 w-28 shrink-0">{o.order_id}</span>
                        <span className="flex-1 truncate text-slate-700">{o.customer_name || o.broker_client_name || o.job_title || "—"}</span>
                        <span className="text-xs text-slate-400">{o.status}</span>
                        <span className="text-xs font-semibold text-slate-600 w-12 text-right">{qty} pc</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Per-supplier needs */}
              {supplierNames.length === 0 ? (
                <div className="text-sm text-slate-500">Nothing to order from the selected jobs.</div>
              ) : supplierNames.map((name) => {
                const g = bySupplier[name];
                const isAc = name === SUPPLIERS.AC;
                return (
                  <div key={name} className="border border-slate-200 rounded-xl overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-100">
                      <div className="font-semibold text-slate-800 text-sm">{name}</div>
                      <div className="text-xs text-slate-500">{g.totalQty} pc · ~{fmtMoney(g.estSubtotal)}</div>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {g.lines.map((l, i) => (
                        <div key={i} className="px-4 py-2 text-sm flex items-start gap-3">
                          <div className="flex-1">
                            <div className="font-medium text-slate-800">
                              {l.styleNumber} · {l.color || "—"}{l.productTitle ? <span className="text-slate-400 font-normal"> · {l.productTitle}</span> : null}
                            </div>
                            <div className="text-xs text-slate-500 mt-0.5">{sizesSummary(l.sizes)}</div>
                            {l.costMismatch && <div className="text-[11px] text-amber-600 mt-0.5">Cost varied across jobs — verify at order time.</div>}
                          </div>
                          <div className="text-xs text-slate-500 text-right w-16 shrink-0">{l.totalQty} pc</div>
                        </div>
                      ))}
                    </div>
                    <div className="px-4 py-2.5 bg-slate-50/60 border-t border-slate-100">
                      {isAc || name === SUPPLIERS.SS ? (
                        <button
                          type="button"
                          onClick={isAc ? createAcPo : createSsPo}
                          disabled={!!busySupplier}
                          className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-4 py-2 rounded-xl disabled:opacity-60"
                        >
                          {busySupplier === name ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />}
                          {busySupplier === name ? "Building PO…" : `Create ${name} draft PO`}
                        </button>
                      ) : (
                        <div className="text-xs text-slate-500 flex items-center gap-1.5">
                          <AlertCircle className="w-3.5 h-3.5 text-slate-400" />
                          Order these directly with the supplier — {name} ordering isn't wired into InkTracker yet.
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {unresolved.length > 0 && (
                <div className="border border-amber-200 bg-amber-50 rounded-xl px-4 py-3 text-xs text-amber-800">
                  <div className="font-semibold mb-1">{unresolved.length} line(s) can't be auto-ordered</div>
                  These order line items have no supplier or style number, so they need a manual PO:
                  <ul className="mt-1 list-disc pl-4 space-y-0.5">
                    {unresolved.slice(0, 6).map((u, i) => (
                      <li key={i}>{u.orderRef}: {u.productTitle || "(untitled)"} — {u.qty} pc{u.supplier ? "" : " · no supplier"}{u.style ? "" : " · no style #"}</li>
                    ))}
                    {unresolved.length > 6 && <li>…and {unresolved.length - 6} more.</li>}
                  </ul>
                </div>
              )}

              {createError && (
                <div className="border border-red-200 bg-red-50 rounded-xl px-4 py-3 text-sm text-red-700 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {createError}
                </div>
              )}
              {resolveWarn && (
                <div className="border border-amber-200 bg-amber-50 rounded-xl px-4 py-3 text-xs text-amber-800">
                  Draft created, but {resolveWarn.unresolved.length + resolveWarn.lookupErrors.length} item(s) didn't resolve to a live AS Colour SKU (add them on the PO):{" "}
                  {[...resolveWarn.lookupErrors.map((e) => `${e.style} (${e.message})`), ...resolveWarn.unresolved.map((u) => `${u.style} ${u.color} ${u.size}`)].slice(0, 8).join("; ")}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </ModalBackdrop>
  );
}
