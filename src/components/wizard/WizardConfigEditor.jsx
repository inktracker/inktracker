import { useEffect, useState } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import { Plus, Trash2, RotateCcw, Check, Search } from "lucide-react";
import { DEFAULT_WIZARD_STYLES, DEFAULT_WIZARD_SETUPS } from "./OrderWizard";

const ICON_OPTIONS = ["tee", "hoodie", "longsleeve", "crew", "front", "frontback", "chestback", "leftchest", "frontsleeve"];
const LOCATION_OPTIONS = ["Front", "Back", "Left Chest", "Right Chest", "Left Sleeve", "Right Sleeve", "Pocket", "Hood", "Other"];
const TECHNIQUE_OPTIONS = ["Screen Print", "DTG", "Embroidery", "DTF", "Heat Transfer", "Sublimation"];
const CATEGORIES = ["T-Shirts", "Long Sleeve", "Hoodies", "Crewnecks", "Tank Tops", "Polos", "Hats", "Other"];

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
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);

  function handleDragStart(idx) { setDragIdx(idx); }
  function handleDragOver(e, idx) { e.preventDefault(); setDragOverIdx(idx); }
  function handleDragEnd() {
    if (dragIdx !== null && dragOverIdx !== null && dragIdx !== dragOverIdx) {
      setStyles(prev => {
        const next = [...prev];
        const [moved] = next.splice(dragIdx, 1);
        next.splice(dragOverIdx, 0, moved);
        return next;
      });
    }
    setDragIdx(null);
    setDragOverIdx(null);
  }

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

  const [ssSearch, setSsSearch] = useState("");
  const [ssSearching, setSsSearching] = useState(false);
  const [ssResults, setSsResults] = useState([]);
  const [ssError, setSsError] = useState("");

  async function handleSSSearch(e) {
    e?.preventDefault?.();
    const q = ssSearch.trim();
    if (!q) return;
    setSsSearching(true);
    setSsError("");
    setSsResults([]);
    try {
      const { data, error } = await supabase.functions.invoke("ssLookupStyle", { body: { styleNumber: q } });
      if (error) throw error;
      const matches = (data?.matches || []).map(m => ({
        id: m.id,
        brandName: m.brandName,
        styleNumber: m.styleNumber || m.styleName,
        description: m.description || "",
        styleCategory: m.styleCategory || "",
        styleImage: m.styleImage || m.colors?.[0]?.imageUrl || "",
        piecePrice: m.piecePrice || 0,
      }));
      if (matches.length === 0) setSsError(`No results for "${q}"`);
      else setSsResults(matches);
    } catch (err) {
      setSsError(err?.message || "Search failed");
    } finally {
      setSsSearching(false);
    }
  }

  function addFromSSResult(match) {
    const desc = `${match.styleCategory || ""} ${match.description || ""}`.toLowerCase();
    let garment = "T-Shirts";
    if (desc.includes("hood") || desc.includes("pullover")) garment = "Hoodies";
    else if (desc.includes("crewneck") || desc.includes("crew neck")) garment = "Crewnecks";
    else if (desc.includes("sweatshirt") || desc.includes("fleece")) garment = "Hoodies";
    else if (desc.includes("long sleeve") || desc.includes("long-sleeve")) garment = "Long Sleeve";
    else if (desc.includes("tank")) garment = "Tank Tops";
    else if (desc.includes("polo")) garment = "Polos";
    else if (desc.includes("hat") || desc.includes("cap") || desc.includes("beanie")) garment = "Hats";
    else if (desc.includes("t-shirt") || desc.includes("tee") || desc.includes("t shirt")) garment = "T-Shirts";
    setStyles(prev => [...prev, {
      id: uid(),
      styleNumber: match.styleNumber,
      brand: match.brandName,
      garment,
      tag: "",
      hoverDescription: "",
    }]);
    setSsResults([]);
    setSsSearch("");
  }

  function addStyle() {
    setStyles((prev) => [
      ...prev,
      { id: uid(), styleNumber: "", brand: "", garment: "T-Shirts", tag: "", hoverDescription: "" },
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
        <div className="mb-3">
          <h3 className="text-base font-bold text-slate-900">Wizard Garment Styles</h3>
          <p className="text-xs text-slate-500 mt-0.5">Search S&S to add garments. Images, colors, and pricing pull automatically.</p>
        </div>

        <form onSubmit={handleSSSearch} className="flex gap-2 mb-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
            <input value={ssSearch} onChange={e => setSsSearch(e.target.value)}
              placeholder="Search by style # (e.g. 5000, 1717, IND4000)"
              className="w-full text-sm border border-slate-200 rounded-lg pl-9 pr-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
              disabled={ssSearching} />
          </div>
          <button type="submit" disabled={ssSearching || !ssSearch.trim()}
            className="text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 px-4 py-2 rounded-lg transition">
            {ssSearching ? "Searching…" : "Search S&S"}
          </button>
        </form>

        {ssError && <div className="text-xs text-red-500 mb-3">{ssError}</div>}

        {ssResults.length > 0 && (
          <div className="border border-indigo-200 rounded-xl bg-indigo-50/50 p-3 mb-3 space-y-2">
            <div className="text-xs font-semibold text-indigo-600 uppercase tracking-widest">Select a result to add</div>
            {ssResults.map(m => (
              <button key={m.id} onClick={() => addFromSSResult(m)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-indigo-200 bg-white hover:border-indigo-400 hover:bg-indigo-50 transition text-left">
                {m.styleImage && <img src={m.styleImage} alt="" className="w-10 h-10 rounded-lg object-contain bg-slate-50 flex-shrink-0" />}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-slate-900">{m.brandName} {m.styleNumber}</div>
                  <div className="text-xs text-slate-500 truncate">{m.description}</div>
                </div>
                <Plus className="w-4 h-4 text-indigo-500 flex-shrink-0" />
              </button>
            ))}
          </div>
        )}
        <div className="space-y-2">
          {styles.map((s, idx) => (
            <div key={s.id || idx}
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDragEnd={handleDragEnd}
              className={`border rounded-xl p-3 transition cursor-grab active:cursor-grabbing ${
                dragOverIdx === idx && dragIdx !== idx ? "border-indigo-400 bg-indigo-50/50" : "border-slate-200 bg-slate-50/50"
              } ${dragIdx === idx ? "opacity-50" : ""}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-slate-300 mr-1 cursor-grab">⠿</span>
                  <span className="text-sm font-bold text-slate-800">{s.brand ? `${s.brand} ${s.styleNumber}` : s.styleNumber || `Style ${idx + 1}`}</span>
                  {s.tag && <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full">{s.tag}</span>}
                </div>
                <button onClick={() => removeStyle(idx)} title="Remove"
                  className="inline-flex items-center justify-center text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg p-1.5">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-3 items-end">
                <div>
                  <label className="text-[10px] font-semibold text-slate-400 uppercase">Category</label>
                  <select value={s.garment || "T-Shirts"} onChange={(e) => updateStyle(idx, { garment: e.target.value })}
                    className="w-full text-sm border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 mt-0.5">
                    {CATEGORIES.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-slate-400 uppercase">Tag</label>
                  <input value={s.tag || ""} onChange={(e) => updateStyle(idx, { tag: e.target.value })}
                    placeholder="Best Value, Shop Pick, etc." className="w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 mt-0.5" />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-slate-400 uppercase">Tagline (hover)</label>
                  <input value={s.hoverDescription || ""} onChange={(e) => updateStyle(idx, { hoverDescription: e.target.value })}
                    placeholder="100% cotton, great for screen printing"
                    className="w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 mt-0.5" />
                </div>
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
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition"
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
          <button
            onClick={resetToDefaults}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 border border-slate-200 px-3 py-2.5 rounded-xl hover:bg-white"
          >
            <RotateCcw className="w-4 h-4" /> Reset
          </button>
        </div>
        {saved && (
          <span className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg">
            <Check className="w-4 h-4" /> Saved
          </span>
        )}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </div>
  );
}
