import { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/supabaseClient";
import { shopScope } from "@/lib/shopScope";
import { notify } from "@/lib/notify";
import { Loader2 } from "lucide-react";

// Opt-in customer emails on status changes. Everything defaults OFF; the
// statusCustomerEmail edge function reads shops.customer_status_notify and
// only ever emails for the statuses listed here. Broker orders are always
// excluded server-side — brokers own their client communication.

const CUSTOMER_STATUSES = [
  { status: "Printing",  label: "In production",     hint: 'Emails "your order is now in production" when a job moves to Printing.' },
  { status: "Completed", label: "Ready",             hint: 'Emails "your order is finished" when a job is marked Completed.' },
  { status: "Shipped",   label: "Shipped",           hint: 'Emails "your order is on its way" when a job is marked Shipped.' },
];

export default function CustomerUpdatesSection({ user }) {
  const [config, setConfig] = useState(null);
  const [shopRowId, setShopRowId] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const shops = await base44.entities.Shop.filter({ owner_email: shopScope(user) });
      setShopRowId(shops?.[0]?.id ?? null);
      setConfig(shops?.[0]?.customer_status_notify ?? {});
    } catch {
      setConfig({});
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  async function save(next) {
    if (!shopRowId) {
      notify.error("Couldn't find your shop record — reload and try again.");
      return;
    }
    setSaving(true);
    const prev = config;
    setConfig(next); // optimistic
    try {
      await base44.entities.Shop.update(shopRowId, { customer_status_notify: next });
    } catch (err) {
      setConfig(prev);
      notify.error(err?.message || "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  if (config === null) {
    return <div className="text-xs text-slate-500 flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</div>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Email your customer automatically when their order reaches a stage.
        Off by default — nothing sends unless you turn it on here. Broker
        orders never email the end client.
      </p>
      {CUSTOMER_STATUSES.map(({ status, label, hint }) => {
        const entry = config[status] ?? { enabled: false, note: "" };
        return (
          <div key={status} className="border border-slate-200 dark:border-slate-700 rounded-xl p-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={!!entry.enabled}
                disabled={saving}
                onChange={(e) => save({ ...config, [status]: { ...entry, enabled: e.target.checked } })}
                className="w-4 h-4 accent-teal-600"
              />
              <span className="font-semibold text-sm text-slate-800 dark:text-slate-200">{label}</span>
              <span className="text-xs text-slate-400">({status})</span>
            </label>
            <p className="text-xs text-slate-500 mt-1 ml-7">{hint}</p>
            {entry.enabled && (
              <input
                defaultValue={entry.note || ""}
                onBlur={(e) => {
                  const note = e.target.value.trim().slice(0, 500);
                  if (note !== (entry.note || "")) save({ ...config, [status]: { ...entry, note } });
                }}
                placeholder="Optional extra line to include (e.g. pickup hours)"
                className="mt-2 ml-7 w-[calc(100%-1.75rem)] text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
