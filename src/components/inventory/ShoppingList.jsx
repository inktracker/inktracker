// Restock shopping list — auto-populated from inventory items where
// qty <= reorder. Filterable by supplier; bulk "Mark as Ordered" on
// checked items; per-item "Receive" bumps qty and clears the order.
//
// State machine per item:
//   1. qty > reorder              → not on the list
//   2. qty <= reorder, no order   → "Needs ordering" (checkbox shown)
//   3. ordered_at set, qty <=     → "Pending delivery" (Receive button)
//   4. user clicks Receive        → qty += ordered_qty, ordered_at cleared
//                                   → if new qty > reorder, drops off list
//
// All persistence happens through base44.entities.InventoryItem.update().
// The checked-state lives only in this component (it's intent, not data).

import { useMemo, useState } from "react";
import { ShoppingCart, CheckCircle2, Truck, Package } from "lucide-react";
import { base44 } from "@/api/supabaseClient";

const ALL = "All";
const UNSPECIFIED = "Unspecified";

function supplierLabel(s) {
  return s && String(s).trim().length > 0 ? s : UNSPECIFIED;
}

export default function ShoppingList({ items, onItemUpdated, onRefresh }) {
  // Auto-derived: anything below reorder threshold is on the list.
  const lowItems = useMemo(
    () => items.filter((i) => Number(i.qty) <= Number(i.reorder)),
    [items],
  );

  const pending = lowItems.filter((i) => !i.ordered_at);
  const ordered = lowItems.filter((i) => i.ordered_at);

  // Supplier pills — derived from whatever's in the data, plus the
  // sentinel "Unspecified" when any item has no supplier.
  const suppliers = useMemo(() => {
    const set = new Set();
    for (const i of lowItems) set.add(supplierLabel(i.supplier));
    return [ALL, ...Array.from(set).sort((a, b) => {
      if (a === UNSPECIFIED) return 1;
      if (b === UNSPECIFIED) return -1;
      return a.localeCompare(b);
    })];
  }, [lowItems]);

  const [supplierFilter, setSupplierFilter] = useState(ALL);
  const [checkedIds, setCheckedIds] = useState(() => new Set());
  const [busy, setBusy] = useState(false);

  const visiblePending = supplierFilter === ALL
    ? pending
    : pending.filter((i) => supplierLabel(i.supplier) === supplierFilter);

  const visibleOrdered = supplierFilter === ALL
    ? ordered
    : ordered.filter((i) => supplierLabel(i.supplier) === supplierFilter);

  const checkedCount = visiblePending.filter((i) => checkedIds.has(i.id)).length;

  function toggleChecked(id) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function checkAllVisible() {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      for (const i of visiblePending) next.add(i.id);
      return next;
    });
  }

  function clearChecked() {
    setCheckedIds(new Set());
  }

  // Bulk action: mark every checked item as ordered. ordered_qty
  // defaults to (reorder * 2 - qty) — enough to comfortably restock —
  // unless the item has restock_to set, in which case use that.
  async function markCheckedAsOrdered() {
    const toOrder = visiblePending.filter((i) => checkedIds.has(i.id));
    if (toOrder.length === 0) return;
    setBusy(true);
    const now = new Date().toISOString();
    try {
      await Promise.all(
        toOrder.map((i) => {
          const target = Number(i.restock_to) > 0
            ? Number(i.restock_to)
            : Math.max(Number(i.reorder) * 2, Number(i.reorder) + 1);
          const orderedQty = Math.max(target - Number(i.qty), 1);
          return base44.entities.InventoryItem.update(i.id, {
            ordered_at: now,
            ordered_qty: orderedQty,
          }).then((updated) => onItemUpdated?.(updated));
        }),
      );
      setCheckedIds(new Set());
    } catch (err) {
      console.error("[ShoppingList] markCheckedAsOrdered failed:", err);
      onRefresh?.(); // resync if anything went sideways
    } finally {
      setBusy(false);
    }
  }

  async function receiveItem(item) {
    setBusy(true);
    try {
      const newQty = Number(item.qty) + Number(item.ordered_qty || 0);
      const updated = await base44.entities.InventoryItem.update(item.id, {
        qty: newQty,
        ordered_at: null,
        ordered_qty: null,
      });
      onItemUpdated?.(updated);
    } catch (err) {
      console.error("[ShoppingList] receiveItem failed:", err);
      onRefresh?.();
    } finally {
      setBusy(false);
    }
  }

  async function cancelOrder(item) {
    setBusy(true);
    try {
      const updated = await base44.entities.InventoryItem.update(item.id, {
        ordered_at: null,
        ordered_qty: null,
      });
      onItemUpdated?.(updated);
    } catch (err) {
      console.error("[ShoppingList] cancelOrder failed:", err);
      onRefresh?.();
    } finally {
      setBusy(false);
    }
  }

  if (lowItems.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 p-6 mb-6 text-center">
        <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
        <div className="text-sm font-semibold text-slate-700">Everything's stocked</div>
        <div className="text-xs text-slate-400 mt-1">
          Items will appear here automatically when their quantity drops below the reorder threshold.
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 mb-6 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShoppingCart className="w-5 h-5 text-orange-500" />
          <div>
            <div className="text-sm font-bold text-slate-900">Shopping List</div>
            <div className="text-xs text-slate-500">
              {pending.length} to order
              {ordered.length > 0 && <span className="text-blue-600"> · {ordered.length} pending delivery</span>}
            </div>
          </div>
        </div>
        {checkedCount > 0 && (
          <button
            onClick={markCheckedAsOrdered}
            disabled={busy}
            className="bg-orange-500 hover:bg-orange-600 disabled:bg-slate-300 text-white text-sm font-semibold px-4 py-2 rounded-xl transition flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4" />
            Mark {checkedCount} as ordered
          </button>
        )}
      </div>

      {/* Supplier pills */}
      {suppliers.length > 2 && (
        <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap gap-2">
          {suppliers.map((s) => {
            const count = s === ALL
              ? lowItems.length
              : lowItems.filter((i) => supplierLabel(i.supplier) === s).length;
            const active = supplierFilter === s;
            return (
              <button
                key={s}
                onClick={() => setSupplierFilter(s)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition ${
                  active
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                }`}
              >
                {s}
                <span className={`ml-1.5 ${active ? "text-slate-300" : "text-slate-400"}`}>{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Pending — needs ordering */}
      {visiblePending.length > 0 && (
        <div className="divide-y divide-slate-50">
          <div className="px-5 py-2 flex items-center justify-between bg-slate-50/50">
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Needs ordering</div>
            <div className="flex items-center gap-3">
              {checkedCount > 0 ? (
                <button onClick={clearChecked} className="text-[11px] font-semibold text-slate-400 hover:text-slate-600">
                  Clear selection
                </button>
              ) : (
                <button onClick={checkAllVisible} className="text-[11px] font-semibold text-slate-400 hover:text-slate-600">
                  Select all
                </button>
              )}
            </div>
          </div>
          {visiblePending.map((item) => (
            <PendingRow
              key={item.id}
              item={item}
              checked={checkedIds.has(item.id)}
              onToggle={() => toggleChecked(item.id)}
            />
          ))}
        </div>
      )}

      {/* Pending delivery — already ordered, awaiting receipt */}
      {visibleOrdered.length > 0 && (
        <div className="divide-y divide-slate-50 border-t border-slate-100">
          <div className="px-5 py-2 bg-blue-50/40">
            <div className="text-[11px] font-bold text-blue-700 uppercase tracking-wider flex items-center gap-1.5">
              <Truck className="w-3 h-3" /> Pending delivery
            </div>
          </div>
          {visibleOrdered.map((item) => (
            <OrderedRow
              key={item.id}
              item={item}
              busy={busy}
              onReceive={() => receiveItem(item)}
              onCancel={() => cancelOrder(item)}
            />
          ))}
        </div>
      )}

      {visiblePending.length === 0 && visibleOrdered.length === 0 && supplierFilter !== ALL && (
        <div className="px-5 py-6 text-center text-xs text-slate-400">
          No items to order from {supplierFilter}.
        </div>
      )}
    </div>
  );
}

function PendingRow({ item, checked, onToggle }) {
  const need = Math.max(Number(item.reorder) - Number(item.qty), 1);
  return (
    <label
      className={`flex items-center gap-3 px-5 py-3 cursor-pointer transition ${
        checked ? "bg-orange-50/60" : "hover:bg-slate-50"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="w-4 h-4 rounded border-slate-300 text-orange-500 focus:ring-orange-500"
      />
      <Package className="w-4 h-4 text-slate-300 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-semibold text-slate-900 truncate ${checked ? "line-through text-slate-500" : ""}`}>
          {item.item}
        </div>
        <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
          {item.sku && <span className="font-mono">{item.sku}</span>}
          {item.sku && item.supplier && <span>·</span>}
          {item.supplier && <span>{item.supplier}</span>}
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <div className="text-sm font-bold text-orange-600">
          {item.qty} <span className="text-slate-400 text-xs font-normal">{item.unit}</span>
        </div>
        <div className="text-[10px] text-slate-400">need ~{need} more</div>
      </div>
    </label>
  );
}

function OrderedRow({ item, busy, onReceive, onCancel }) {
  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <CheckCircle2 className="w-4 h-4 text-blue-500 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-700 truncate">{item.item}</div>
        <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
          {item.supplier && <span>{item.supplier}</span>}
          {item.supplier && <span>·</span>}
          <span>ordered {Number(item.ordered_qty || 0)} {item.unit}</span>
        </div>
      </div>
      <button
        onClick={onCancel}
        disabled={busy}
        className="text-xs font-semibold text-slate-400 hover:text-red-500 transition px-2"
      >
        Cancel
      </button>
      <button
        onClick={onReceive}
        disabled={busy}
        className="bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-300 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition"
      >
        Received
      </button>
    </div>
  );
}
