import { useState, useEffect } from "react";
import { base44 } from "@/api/supabaseClient";
import { shopScope } from "@/lib/shopScope";

// Account → Add-ons editor. This consolidates the shop add-on state +
// handlers that previously lived (unused/unrendered) at the top of the
// Account page into a single self-contained, renderable component. It is
// NOT currently wired into the Account page's render tree — the prior code
// was never rendered there either, so leaving it un-mounted preserves the
// existing behavior exactly. Extracted here so the logic has a home and a
// smoke test. Owns its own state; receives the current `user`.

// Default add-ons a shop starts from before it saves its own list.
export const DEFAULT_ADDONS = [
  { key: "tags", label: "Custom Tags", rate: 1.5 },
  { key: "difficultPrint", label: "Difficult Print", rate: 0.5 },
  { key: "colorMatch", label: "Ink Color Match", rate: 1.0 },
  { key: "waterbased", label: "Water-Based Ink", rate: 1.0 },
];

export default function AddonsSection({ user }) {
  const [addons, setAddons] = useState(DEFAULT_ADDONS);
  const [savingAddons, setSavingAddons] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const shops = await base44.entities.Shop.filter({ owner_email: shopScope(user) });
        if (!alive) return;
        if (shops?.[0]?.addons?.length) {
          setAddons(
            shops[0].addons
              .map(a => ({ ...a, rate: parseFloat(a.rate) || 0 }))
              .sort((a, b) => (a.label || "").localeCompare(b.label || "", undefined, { sensitivity: 'base' }))
          );
        } else {
          setAddons(DEFAULT_ADDONS);
        }
      } catch {
        if (alive) setAddons(DEFAULT_ADDONS);
      }
    })();
    return () => { alive = false; };
  }, [user]);

  async function handleSaveAddons() {
    setSavingAddons(true);
    try {
      // Save to Shop entity so brokers can read it
      const shops = await base44.entities.Shop.filter({ owner_email: shopScope(user) });
      if (shops?.length) {
        await base44.entities.Shop.update(shops[0].id, { addons });
      } else {
        await base44.entities.Shop.create({
          owner_email: shopScope(user),
          shop_name: user.shop_name || user.email,
          addons,
        });
      }
      setMessage("Add-ons saved!");
      setTimeout(() => setMessage(""), 3000);
    } catch (error) {
      console.error("Failed saving add-ons:", error);
      setMessage("Error saving add-ons");
    }
    setSavingAddons(false);
  }

  function updateAddon(idx, field, value) {
    setAddons((prev) => prev.map((a, i) => i === idx ? { ...a, [field]: value } : a));
  }

  function addAddon() {
    setAddons((prev) => [...prev, { key: `addon_${Date.now()}`, label: "", rate: 1.0 }]);
  }

  function removeAddon(idx) {
    setAddons((prev) => prev.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Per-piece add-ons offered on quotes. Each has a name and a per-piece rate.
      </p>

      <div className="space-y-2">
        {addons.map((addon, idx) => (
          <div key={addon.key || idx} className="flex items-center gap-2">
            <input
              type="text"
              value={addon.label || ""}
              onChange={(e) => updateAddon(idx, "label", e.target.value)}
              placeholder="Add-on name"
              className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-300"
            />
            <div className="relative w-28">
              <span className="absolute left-2 top-2 text-xs text-slate-500">$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={addon.rate}
                onChange={(e) => updateAddon(idx, "rate", parseFloat(e.target.value) || 0)}
                className="w-full text-sm border border-slate-200 rounded-lg pl-5 pr-2 py-2 focus:outline-none focus:ring-2 focus:ring-teal-300"
              />
            </div>
            <button
              type="button"
              onClick={() => removeAddon(idx)}
              title="Remove add-on"
              className="text-slate-300 hover:text-red-500 transition w-7 h-7 flex items-center justify-center"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addAddon}
        className="text-xs font-semibold text-teal-600 hover:text-teal-700 transition"
      >
        + Add add-on
      </button>

      {message && (
        <div
          className={`text-sm font-semibold py-2 px-3 rounded-lg ${
            message.includes("Error")
              ? "bg-red-50 text-red-600"
              : "bg-emerald-50 text-emerald-600"
          }`}
        >
          {message}
        </div>
      )}

      <div>
        <button
          onClick={handleSaveAddons}
          disabled={savingAddons}
          className="bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 text-white font-semibold px-4 py-2.5 rounded-xl transition"
        >
          {savingAddons ? "Saving..." : "Save Add-ons"}
        </button>
      </div>
    </div>
  );
}
