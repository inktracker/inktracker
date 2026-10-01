import { useEffect, useState } from "react";
import { base44 } from "@/api/supabaseClient";
import { shopScope } from "@/lib/shopScope";
import { loadShopPricingConfig } from "@/components/shared/pricing";
import { notify } from "@/lib/notify";

// "Require customer art approval before production" —
// pricing_config.requireArtApproval. ON: an order can't leave Art Approval
// until the customer approves the current proof (an owner or manager can
// approve for them with a note). OFF (default): approvals are tracked and
// shown, but nothing is blocked. Owner only.
export default function ArtApprovalSetting({ user }) {
  const [on, setOn] = useState(null);
  const [saving, setSaving] = useState(false);
  const isOwner = ["admin", "shop"].includes(user?.role);

  useEffect(() => {
    let alive = true;
    base44.entities.Shop.filter({ owner_email: shopScope(user) })
      .then((shops) => { if (alive) setOn(shops?.[0]?.pricing_config?.requireArtApproval === true); })
      .catch(() => { if (alive) setOn(false); });
    return () => { alive = false; };
  }, [user]);

  async function toggle(next) {
    setSaving(true);
    try {
      const shops = await base44.entities.Shop.filter({ owner_email: shopScope(user) });
      if (!shops?.[0]) throw new Error("Shop not found");
      const pc = { ...(shops[0].pricing_config || {}), requireArtApproval: next };
      await base44.entities.Shop.update(shops[0].id, { pricing_config: pc });
      loadShopPricingConfig(pc, shopScope(user));
      setOn(next);
      notify.success(next ? "Art approval now required before production" : "Art approval no longer blocks production");
    } catch (e) {
      notify.error("Couldn't save the setting", e);
    } finally {
      setSaving(false);
    }
  }

  if (on === null) return null;
  return (
    <div className="mb-5 rounded-xl border border-slate-200 px-4 py-3 flex items-start justify-between gap-4">
      <div className="text-sm">
        <div className="font-semibold text-slate-800">Require customer art approval before production</div>
        <div className="text-xs text-slate-500 mt-0.5 max-w-prose">
          When on, an order can't move past Art Approval until the customer approves the current proof.
          An owner or manager can approve for them (for example, approved by phone) with a note.
        </div>
      </div>
      <label className="flex items-center gap-2 shrink-0 text-xs font-semibold text-slate-700">
        <input id="require-art-approval" type="checkbox" checked={on} disabled={!isOwner || saving}
          onChange={(e) => toggle(e.target.checked)} className="w-4 h-4 accent-teal-600" />
        {on ? "On" : "Off"}
      </label>
    </div>
  );
}
