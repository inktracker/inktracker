// Edit Order — phase 1 (docs/edit-order-design.md, all four decisions in).
//
// Tiers 1-2 only: unbilled orders edit freely; locally-invoiced orders
// auto-update their invoice with a dated shop-facing note (decision #1).
// QB-linked (tier 3) and paid/completed (tier 4) orders don't open this
// modal — OrderDetailModal gates the Edit button and explains why.
//
// Built from the QUOTE editor's building blocks (LineItemEditor, the
// linked pricing engine, customerSnapshotPatch) — not a fork of
// QuoteEditorModal. Money recomputes deliberately at save: the confirm
// shows old total → new total before anything writes (an edit is a NEW
// agreement, recorded loudly — the change_log triggers carry the actor).

import { useState, useMemo, useEffect } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import ModalBackdrop from "../shared/ModalBackdrop";
import LineItemEditor from "../quotes/LineItemEditor";
import {
  calcLinkedLinePrice,
  buildLinkedQtyMap,
  getLineExtras,
  getShopPricingConfig,
  getQty,
  fmtMoney,
  newLineItem,
} from "../shared/pricing";
import { buildAddonsByScope } from "@/lib/pricing/extrasScopes";
import { customerSnapshotPatch } from "@/lib/quotes/customerSwitch";
import { createInvoiceInQB } from "@/lib/invoices/createInvoiceInQB";
import {
  goodsMarkCount,
  getOrderEditTier,
  tierCapabilities,
  orderEditBlockers,
  orderEditWarnings,
  buildEditPatches,
  editConflict,
} from "@/lib/orders/editOrderEngine";
import { todayInShopTz } from "@/lib/shopTimezone";
import { notify } from "@/lib/notify";
import { cachedFilter } from "@/lib/queries/cachedEntity";
import { shopScope } from "@/lib/shopScope";
import { X } from "lucide-react";

export default function OrderEditorModal({ order, customers: customersProp, linkedInvoice, sourcePO, onClose, onSaved }) {
  // Self-load the customer list when the parent doesn't hold one (the
  // order modal has a single customer, not the roster).
  const [loadedCustomers, setLoadedCustomers] = useState(null);
  useEffect(() => {
    if (customersProp) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const me = await base44.auth.me();
        const rows = await cachedFilter("Customer", { filters: { shop_owner: shopScope(me) } });
        if (!cancelled) setLoadedCustomers(rows || []);
      } catch { if (!cancelled) setLoadedCustomers([]); }
    })();
    return () => { cancelled = true; };
  }, [customersProp]);
  const customers = customersProp ?? loadedCustomers ?? [];
  // Working copy. The ORIGINAL order object stays untouched — it doubles
  // as the stale-write snapshot (editConflict compares tracked fields).
  const [draft, setDraft] = useState(() => ({
    line_items: JSON.parse(JSON.stringify(order.line_items || [])),
    customer_id: order.customer_id || "",
    customer_name: order.customer_name || "",
    due_date: order.due_date || "",
    job_title: order.job_title || "",
    notes: order.notes || "",
  }));
  const [saving, setSaving] = useState(false);
  // Pending floor discrepancy marks (decision #2): recent "Reported a
  // discrepancy" change_log rows render above the lines so the fix they
  // imply is one click away. Read-only context, not state to mutate.
  const [marks, setMarks] = useState([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await base44.entities.ChangeLog.filter(
          { entity_type: "order", entity_id: String(order.id) }, "-created_at", 20,
        );
        if (!cancelled) setMarks((rows || []).filter((r) => (r.summary || "").startsWith("Reported a discrepancy")));
      } catch { /* non-fatal - marks are context */ }
    })();
    return () => { cancelled = true; };
  }, [order.id]);

  const cfg = getShopPricingConfig();
  const caps = tierCapabilities(getOrderEditTier(order, linkedInvoice).tier);
  const addonsByScope = useMemo(() => buildAddonsByScope(cfg || {}), [cfg]);

  const update = (patch) => setDraft((prev) => ({ ...prev, ...patch }));
  const updateLine = (idx, li) =>
    setDraft((prev) => ({ ...prev, line_items: prev.line_items.map((x, i) => (i === idx ? li : x)) }));

  // Live blockers so the operator sees hard stops while editing, not at save.
  const blockers = orderEditBlockers(order, draft.line_items);

  // Deliberate recompute — the edit is a new agreement. Same engine and
  // extras resolution the rest of the app prices with; fresh _ppp /
  // _lineTotal stamps become the new as-sold snapshot.
  function recomputeMoney(lines) {
    const linkedQtyMap = buildLinkedQtyMap(lines);
    let subtotal = 0;
    const stamped = lines.map((li) => {
      const r = calcLinkedLinePrice(li, order.rush_rate, getLineExtras(li, order), undefined, linkedQtyMap);
      const lineTotal = Number(r?.lineTotal || 0);
      subtotal += lineTotal;
      return { ...li, _ppp: r?.ppp ?? li._ppp, _lineTotal: lineTotal };
    });
    subtotal = Number(subtotal.toFixed(2));
    const discount = Number(order.discount) || 0;
    const isFlat = order.discount_type === "flat";
    const afterDisc = discount > 0 ? (isFlat ? Math.max(0, subtotal - discount) : subtotal * (1 - discount / 100)) : subtotal;
    const setup = Number(order.setup_total) || 0;
    const addl = (order.additional_charges || []).reduce((s, c) => s + (Number(c.amount) || 0), 0);
    const taxable = afterDisc + setup + addl;
    const tax = Number((taxable * ((Number(order.tax_rate) || 0) / 100)).toFixed(2));
    const total = Number((taxable + tax).toFixed(2));
    return { stamped, subtotal, tax, total };
  }

  async function handleSave() {
    if (saving || blockers.length > 0) return;
    setSaving(true);
    try {
      const { stamped, subtotal, tax, total } = recomputeMoney(draft.line_items);
      const edited = { ...draft, line_items: stamped, subtotal, tax, total };

      const warnings = orderEditWarnings(order, stamped, { sourcePO });
      const delta = Number((total - Number(order.total || 0)).toFixed(2));
      const deltaLine = delta === 0
        ? "Total unchanged."
        : `Total: ${fmtMoney(order.total || 0)} → ${fmtMoney(total)} (${delta > 0 ? "+" : "−"}${fmtMoney(Math.abs(delta))}).`;
      const ok = window.confirm(
        `Save changes to ${order.order_id}?\n\n${deltaLine}` +
        (linkedInvoice && !linkedInvoice.qb_invoice_id && !linkedInvoice.paid
          ? `\nThe linked invoice updates to match (a dated note records the change).`
          : "") +
        (warnings.length ? `\n\n⚠ ${warnings.join("\n⚠ ")}` : ""),
      );
      if (!ok) { setSaving(false); return; }

      // Stale-write guard: someone may have edited while this modal was
      // open. Fresh read, tracked-field compare, hard stop on conflict.
      const fresh = await base44.entities.Order.get(order.id);
      if (editConflict(order, fresh)) {
        notify.error(
          "This order changed while you were editing",
          "Someone else saved changes to it. Close and reopen the editor to see the current version — your edits were NOT applied.",
        );
        setSaving(false);
        return;
      }

      const quoteSyncPolicy = cfg?.order_edit_quote_sync === "sync_to_order" ? "sync_to_order" : "keep_historical";
      // Resolve the source quote by its conversion backlink.
      let quote = null;
      if (order.order_id) {
        const quotes = await base44.entities.Quote.filter({ converted_order_id: order.order_id });
        quote = quotes?.[0] || null;
      }

      const { orderPatch, invoicePatch, quotePatch } = buildEditPatches({
        order, edited, linkedInvoice, quote, quoteSyncPolicy, today: todayInShopTz(),
      });

      // Order last: if a linked-doc write fails, the order still reflects
      // the OLD agreement and a retry re-runs everything idempotently.
      if (invoicePatch && linkedInvoice) await base44.entities.Invoice.update(linkedInvoice.id, invoicePatch);
      if (quotePatch && quote) await base44.entities.Quote.update(quote.id, quotePatch);
      const savedOrder = await base44.entities.Order.update(order.id, orderPatch);

      // Tier 3: the explicit push step (design). Declining leaves the
      // pending-push badge; the invoice modal offers the push any time.
      if (caps.pushRequired && invoicePatch && linkedInvoice) {
        const pushNow = window.confirm(
          `Saved. Push this update to QuickBooks now?\n\n` +
          `QuickBooks still shows the previous version of invoice ${linkedInvoice.invoice_id || ""}. ` +
          `Push updates the QB invoice to match (tax re-checks apply). ` +
          `If you skip, the invoice carries a "push pending" notice until you push.`,
        );
        if (pushNow) {
          try {
            const { data: { session } } = await supabase.auth.getSession();
            const freshRows = await base44.entities.Invoice.filter({ shop_owner: order.shop_owner, id: linkedInvoice.id });
            const freshInv = freshRows?.[0] || { ...linkedInvoice, ...invoicePatch };
            const result = await createInvoiceInQB({ base44, invoice: freshInv, customer: customers.find((c) => c.id === draft.customer_id), session });
            if (!result.ok) throw new Error(result.error || "QuickBooks push failed");
            notify.success("Pushed to QuickBooks", "The QB invoice now matches your edit.");
          } catch (pushErr) {
            notify.error("Saved locally, but the QuickBooks push failed", `${pushErr?.message || pushErr}. The invoice shows a push-pending notice — push from there when ready.`);
          }
        }
      }

      onSaved?.(savedOrder || { ...order, ...orderPatch });
      onClose();
    } catch (err) {
      notify.error("Couldn't save the order edit", err);
    } finally {
      setSaving(false);
    }
  }

  const totalQty = draft.line_items.reduce((s, li) => s + getQty(li), 0);

  return (
    <ModalBackdrop onClose={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Edit Order — {order.order_id}</h2>
            <p className="text-xs text-slate-500">
              Changes recompute pricing and are recorded with your name. {totalQty} pcs
            </p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 transition" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {blockers.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-1.5">
              <div className="text-sm font-bold text-red-700">Can't save yet:</div>
              {blockers.map((b, i) => (
                <div key={i} className="text-xs text-red-700">• {b}</div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Customer</label>
              <select
                value={draft.customer_id}
                disabled={!caps.canSwitchCustomer}
                title={!caps.canSwitchCustomer ? "This order's invoice is in QuickBooks — the QB invoice belongs to this customer. Switching customers on a QB-invoiced order arrives with phase 3 (void + recreate)." : undefined}
                onChange={(e) => {
                  const c = customers.find((x) => x.id === e.target.value);
                  // Same rule as the quote editor (#735): EVERY snapshot
                  // field follows the newly selected customer.
                  update(customerSnapshotPatch(c || null, {
                    defaultTaxRate: order.tax_rate,
                    currentTaxRate: order.tax_rate,
                    currentDepositPct: order.deposit_pct,
                  }));
                }}
                className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-900"
              >
                <option value="">Select customer…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.company ? `${c.company} (${c.name})` : c.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Due date</label>
                <input type="date" value={draft.due_date || ""} onChange={(e) => update({ due_date: e.target.value })}
                  className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-900" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Job title</label>
                <input type="text" value={draft.job_title} onChange={(e) => update({ job_title: e.target.value })}
                  className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-900" />
              </div>
            </div>
          </div>

          {marks.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-1">
              <div className="text-xs font-bold text-amber-800 uppercase tracking-wide">Floor reports on this order</div>
              {marks.map((m) => (
                <div key={m.id} className="text-xs text-amber-800">
                  {"•"} {m.summary.replace("Reported a discrepancy — ", "")}
                  <span className="text-amber-600"> {"—"} {m.actor || "floor"}, {new Date(m.created_at).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          )}

          {draft.line_items.map((li, idx) => (
            <LineItemEditor
              key={li.id || idx}
              li={li}
              rushRate={order.rush_rate}
              extras={order.extras}
              addonsByScope={addonsByScope}
              allLineItems={draft.line_items}
              onChange={(updated) => updateLine(idx, updated)}
              onRemove={() => setDraft((p) => ({ ...p, line_items: p.line_items.filter((_, i) => i !== idx) }))}
              canRemove={draft.line_items.length > 1}
            />
          ))}

          <button
            type="button"
            onClick={() => setDraft((p) => ({ ...p, line_items: [...p.line_items, newLineItem()] }))}
            disabled={goodsMarkCount(order) > 0}
            title={goodsMarkCount(order) > 0
              ? "Goods are already marked ordered/received - adding lines would mis-point those marks (keyed by line position). Clear goods progress first."
              : undefined}
            className="w-full border-2 border-dashed border-slate-300 rounded-xl py-3 text-sm font-semibold text-slate-500 hover:border-teal-400 hover:text-teal-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            + Add Garment Group
          </button>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Order notes</label>
            <textarea value={draft.notes} onChange={(e) => update({ notes: e.target.value })} rows={3}
              className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-900" />
          </div>
        </div>

        <div className="sticky bottom-0 bg-slate-50 dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 px-6 py-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-slate-600 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-100 transition">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || blockers.length > 0 || !draft.customer_id}
            className="px-5 py-2 text-sm font-bold bg-teal-600 hover:bg-teal-700 text-white rounded-xl transition disabled:opacity-50"
          >
            {saving ? "Saving…" : "Review & Save"}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
