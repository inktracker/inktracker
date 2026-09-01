import { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/supabaseClient";
import { shopScope } from "@/lib/shopScope";
import { notify } from "@/lib/notify";
import { Loader2 } from "lucide-react";

// Shop-level toggles for how chatty the TEAM notification rails are.
// Missing key = ON (the default), so untouched shops behave exactly as
// before. @mentions always deliver and are deliberately not listed.

const CATEGORIES = [
  { key: "order_status",   label: "Job status changes",     hint: "Ping the owner and assigned operator when a job moves stage." },
  { key: "comment_copies", label: "Copies of team notes",   hint: "Send the owner every team note. @mentions always deliver either way." },
  { key: "task_pings",     label: "Task assignments",       hint: "Ping the assignee when a task lands on them, and the creator when it's done." },
];

export default function TeamNotificationPrefs({ user }) {
  const [prefs, setPrefs] = useState(null);
  const [shopRowId, setShopRowId] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const shops = await base44.entities.Shop.filter({ owner_email: shopScope(user) });
      setShopRowId(shops?.[0]?.id ?? null);
      setPrefs(shops?.[0]?.notification_prefs ?? {});
    } catch {
      setPrefs({});
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  async function toggle(key, enabled) {
    if (!shopRowId) return notify.error("Couldn't find your shop record — reload and try again.");
    const prev = prefs;
    const next = { ...prefs, [key]: enabled };
    setPrefs(next);
    setSaving(true);
    try {
      await base44.entities.Shop.update(shopRowId, { notification_prefs: next });
    } catch (err) {
      setPrefs(prev);
      notify.error(err?.message || "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  if (prefs === null) {
    return <div className="text-xs text-slate-500 flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</div>;
  }

  return (
    <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800">
      <h4 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">What gets sent</h4>
      <div className="space-y-2">
        {CATEGORIES.map(({ key, label, hint }) => (
          <label key={key} className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={prefs[key] !== false}
              disabled={saving}
              onChange={(e) => toggle(key, e.target.checked)}
              className="w-4 h-4 mt-0.5 accent-teal-600"
            />
            <span>
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 block">{label}</span>
              <span className="text-xs text-slate-500">{hint}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
