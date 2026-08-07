// Order Editing settings (docs/edit-order-design.md, decision #4).
// Currently one policy: what happens to the SOURCE QUOTE when an order
// is edited after conversion. paid_edit_policy (decision #3) joins this
// cluster in phase 3 — don't ship a dead knob before the behavior.

import { useState, useEffect } from "react";
import { base44 } from "@/api/supabaseClient";
import { notify } from "@/lib/notify";
import { shopScope } from "@/lib/shopScope";

const OPTIONS = [
  {
    value: "keep_historical",
    label: "Keep the quote as the original agreement (recommended)",
    blurb: "The quote stays exactly as sold; it gets a dated note that the order was edited after conversion.",
  },
  {
    value: "sync_to_order",
    label: "Update the quote to match order edits",
    blurb: "The quote's lines and totals mirror every order edit, with a dated note recording each change.",
  },
];

export default function OrderEditingSection({ user }) {
  const [shopRow, setShopRow] = useState(null);
  const [value, setValue] = useState("keep_historical");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const shops = await base44.entities.Shop.filter({ owner_email: shopScope(user) });
        if (cancelled || !shops?.[0]) return;
        setShopRow(shops[0]);
        setValue(shops[0].pricing_config?.order_edit_quote_sync === "sync_to_order" ? "sync_to_order" : "keep_historical");
      } catch { /* section renders with default */ }
    })();
    return () => { cancelled = true; };
  }, [user]);

  async function save(next) {
    if (saving || !shopRow) return;
    setSaving(true);
    const prev = value;
    setValue(next);
    try {
      const pc = { ...(shopRow.pricing_config || {}), order_edit_quote_sync: next };
      await base44.entities.Shop.update(shopRow.id, { pricing_config: pc });
      setShopRow((r) => ({ ...r, pricing_config: pc }));
    } catch (err) {
      setValue(prev);
      notify.error("Couldn't save the setting", err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 p-6">
      <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 mb-1">Order Editing</h3>
      <p className="text-xs text-slate-500 mb-4">
        When an order is edited after it was converted from a quote, what happens to that quote?
        Either way, a dated note records the change — only the direction of truth is configurable.
      </p>
      <div className="space-y-2">
        {OPTIONS.map((o) => (
          <label key={o.value} className={`flex items-start gap-3 border rounded-xl p-3 cursor-pointer transition ${value === o.value ? "border-teal-400 bg-teal-50/50" : "border-slate-200 dark:border-slate-700 hover:border-slate-300"} ${saving ? "opacity-60 pointer-events-none" : ""}`}>
            <input type="radio" name="order_edit_quote_sync" checked={value === o.value} onChange={() => save(o.value)} className="mt-0.5 text-teal-600 focus:ring-teal-300" />
            <span>
              <span className="block text-sm font-semibold text-slate-800 dark:text-slate-200">{o.label}</span>
              <span className="block text-xs text-slate-500 mt-0.5">{o.blurb}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
