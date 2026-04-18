import { useEffect, useState } from "react";
import { base44 } from "@/api/supabaseClient";
import { Plus, Trash2, RotateCcw, Check } from "lucide-react";
import { DEFAULT_WIZARD_STYLES, DEFAULT_WIZARD_SETUPS } from "./OrderWizard";

const ICON_OPTIONS = ["tee", "hoodie", "longsleeve", "crew", "front", "frontback", "chestback", "leftchest", "frontsleeve"];
const LOCATION_OPTIONS = ["Front", "Back", "Left Chest", "Right Chest", "Left Sleeve", "Right Sleeve", "Pocket", "Hood", "Other"];
const TECHNIQUE_OPTIONS = ["Screen Print", "DTG", "Embroidery", "DTF", "Heat Transfer", "Sublimation"];

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

export default function WizardConfigEditor({ user, shop, onSaved }) {
  const [styles, setStyles] = useState(() =>
    shop?.wizard_styles?.length ? shop.wizard_styles : DEFAULT_WIZARD_STYLES
  );
  const [setups, setSetups] = useState(() =>
    shop?.wizard_setups?.length ? shop.wizard_setups : DEFAULT_WIZARD_SETUPS
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (shop?.wizard_styles?.length) setStyles(shop.wizard_styles);
    if (shop?.wizard_setups?.length) setSetups(shop.wizard_setups);
  }, [shop]);

  function updateStyle(idx, patch) {
    setStyles((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }

  function removeStyle(idx) {
    setStyles((prev) => prev.filter((_, i) => i !== idx));
  }

  function addStyle() {
    setStyles((prev) => [
      ...prev,
      { id: uid(), name: "New Style", description: "", garmentCost: 5.0, icon: "tee", colors: ["Black", "White"] },
    ]);
  }

  function updateSetup(idx, patch) {
    setSetups((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }

  function removeSetup(idx) {
    setSetups((prev) => prev.filter((_, i) => i !== idx));
  }

  function addSetup() {
    setSetups((prev) => [
      ...prev,
      {
        id: uid(),
        name: "New Setup",
        icon: "front",
        imprints: [{ location: "Front", colors: 1, pantones: "", technique: "Screen Print", details: "" }],
      },
    ]);
  }

  function updateSetupImprint(setupIdx, impIdx, patch) {
    setSetups((prev) =>
      prev.map((s, i) =>
        i === setupIdx
          ? { ...s, imprints: s.imprints.map((im, j) => (j === impIdx ? { ...im, ...patch } : im)) }
          : s
      )
    );
  }

  function addSetupImprint(setupIdx) {
    setSetups((prev) =>
      prev.map((s, i) =>
        i === setupIdx
          ? { ...s, imprints: [...s.imprints, { location: "Back", colors: 1, pantones: "", technique: "Screen Print", details: "" }] }
          : s
      )
    );
  }

  function removeSetupImprint(setupIdx, impIdx) {
    setSetups((prev) =>
      prev.map((s, i) =>
        i === setupIdx ? { ...s, imprints: s.imprints.filter((_, j) => j !== impIdx) } : s
      )
    );
  }

  function resetToDefaults() {
    if (!window.confirm("Reset wizard styles and setups to InkTracker defaults?")) return;
    setStyles(DEFAULT_WIZARD_STYLES);
    setSetups(DEFAULT_WIZARD_SETUPS);
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const payload = {
        wizard_styles: styles,
        wizard_setups: setups,
      };
      const shops = await base44.entities.Shop.filter({ owner_email: user.email });
      if (shops?.length) {
        await base44.entities.Shop.update(shops[0].id, payload);
      } else {
        await base44.entities.Shop.create({
          owner_email: user.email,
          shop_name: user.shop_name || user.email,
          ...payload,
        });
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      onSaved?.();
    } catch (err) {
      setError(err?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Styles */}
      <div className="border border-slate-200 rounded-2xl bg-white p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-base font-bold text-slate-900">Wizard Garment Styles</h3>
            <p className="text-xs text-slate-500 mt-0.5">The options walk-in customers pick from in the Order Wizard.</p>
          </div>
          <button
            onClick={addStyle}
            className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 border border-indigo-200 px-2.5 py-1.5 rounded-lg hover:bg-indigo-50"
          >
            <Plus className="w-3.5 h-3.5" /> Add Style
          </button>
        </div>

        <div className="space-y-3">
          {styles.map((s, idx) => (
            <div key={s.id || idx} className="border border-slate-200 rounded-xl p-3 bg-slate-50/50">
              <div className="grid gap-2 sm:grid-cols-[1.5fr_2fr_0.6fr_0.8fr_auto]">
                <input
                  value={s.name || ""}
                  onChange={(e) => updateStyle(idx, { name: e.target.value })}
                  placeholder="Name (e.g. T-Shirt)"
                  className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
                <input
                  value={s.description || ""}
                  onChange={(e) => updateStyle(idx, { description: e.target.value })}
                  placeholder="Short description"
                  className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
                <div className="relative">
                  <span className="absolute left-2 top-1.5 text-slate-400 text-sm">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={s.garmentCost ?? ""}
                    onChange={(e) => updateStyle(idx, { garmentCost: parseFloat(e.target.value) || 0 })}
                    placeholder="Cost"
                    className="w-full text-sm border border-slate-200 rounded-lg pl-5 pr-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  />
                </div>
                <select
                  value={s.icon || "tee"}
                  onChange={(e) => updateStyle(idx, { icon: e.target.value })}
                  className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
                >
                  {ICON_OPTIONS.map((i) => <option key={i} value={i}>{i}</option>)}
                </select>
                <button
                  onClick={() => removeStyle(idx)}
                  title="Remove"
                  className="inline-flex items-center justify-center text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg px-2"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div className="mt-2">
                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">Colors (comma-separated)</label>
                <input
                  value={(s.colors || []).join(", ")}
                  onChange={(e) =>
                    updateStyle(idx, {
                      colors: e.target.value.split(",").map((c) => c.trim()).filter(Boolean),
                    })
                  }
                  placeholder="Black, White, Navy, Sport Grey"
                  className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 mt-1"
                />
              </div>
            </div>
          ))}
          {styles.length === 0 && (
            <div className="text-sm text-slate-400 text-center py-4">No styles configured.</div>
          )}
        </div>
      </div>

      {/* Setups */}
      <div className="border border-slate-200 rounded-2xl bg-white p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-base font-bold text-slate-900">Wizard Print Setups</h3>
            <p className="text-xs text-slate-500 mt-0.5">Preset print-location combos (e.g. Front Only, Front + Back).</p>
          </div>
          <button
            onClick={addSetup}
            className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 border border-indigo-200 px-2.5 py-1.5 rounded-lg hover:bg-indigo-50"
          >
            <Plus className="w-3.5 h-3.5" /> Add Setup
          </button>
        </div>

        <div className="space-y-3">
          {setups.map((s, idx) => (
            <div key={s.id || idx} className="border border-slate-200 rounded-xl p-3 bg-slate-50/50">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <input
                  value={s.name || ""}
                  onChange={(e) => updateSetup(idx, { name: e.target.value })}
                  placeholder="Setup name"
                  className="flex-1 min-w-40 text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
                <select
                  value={s.icon || "front"}
                  onChange={(e) => updateSetup(idx, { icon: e.target.value })}
                  className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
                >
                  {ICON_OPTIONS.map((i) => <option key={i} value={i}>{i}</option>)}
                </select>
                <button
                  onClick={() => removeSetup(idx)}
                  title="Remove setup"
                  className="text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg px-2 py-1.5"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-1.5">
                {(s.imprints || []).map((imp, j) => (
                  <div key={j} className="grid gap-2 sm:grid-cols-[1.3fr_0.8fr_1fr_auto]">
                    <select
                      value={imp.location}
                      onChange={(e) => updateSetupImprint(idx, j, { location: e.target.value })}
                      className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    >
                      {LOCATION_OPTIONS.map((l) => <option key={l} value={l}>{l}</option>)}
                    </select>
                    <input
                      type="number"
                      min="1"
                      max="8"
                      value={imp.colors || 1}
                      onChange={(e) => updateSetupImprint(idx, j, { colors: parseInt(e.target.value) || 1 })}
                      className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
                      placeholder="# colors"
                    />
                    <select
                      value={imp.technique || "Screen Print"}
                      onChange={(e) => updateSetupImprint(idx, j, { technique: e.target.value })}
                      className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    >
                      {TECHNIQUE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <button
                      onClick={() => removeSetupImprint(idx, j)}
                      disabled={(s.imprints || []).length <= 1}
                      title="Remove print location"
                      className="text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg px-2 disabled:opacity-30"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => addSetupImprint(idx)}
                  className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-700"
                >
                  + Add location
                </button>
              </div>
            </div>
          ))}
          {setups.length === 0 && (
            <div className="text-sm text-slate-400 text-center py-4">No setups configured.</div>
          )}
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition"
        >
          {saving ? "Saving…" : "Save Wizard Config"}
        </button>
        <button
          onClick={resetToDefaults}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 border border-slate-200 px-3 py-2.5 rounded-xl hover:bg-slate-50"
        >
          <RotateCcw className="w-4 h-4" /> Reset to defaults
        </button>
        {saved && (
          <span className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-600">
            <Check className="w-4 h-4" /> Saved
          </span>
        )}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </div>
  );
}
