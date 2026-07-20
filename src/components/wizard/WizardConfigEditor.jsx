import { useEffect, useState } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import { Plus, Trash2, RotateCcw, Check, Search, RefreshCw } from "lucide-react";
import { DEFAULT_WIZARD_STYLES } from "./OrderWizard";
import {
  fetchEnrichedStyle as enrichStyleData,
  isStyleEnriched,
} from "@/lib/wizard/enrichStyle";

const CATEGORIES = ["T-Shirts", "Long Sleeve", "Hoodies", "Crewnecks", "Tank Tops", "Polos", "Hats", "Other"];

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

// `enrichStyleData` (the fetcher) and `isStyleEnriched` (the predicate)
// both come from the shared module — same implementation reused by
// OrderWizard for runtime enrichment. Centralizing prevents the
// drift bug that previously dropped cost data on the config-save side
// while runtime enrichment had it.

export default function WizardConfigEditor({ user, shop, onSaved }) {
  const [styles, setStyles] = useState(() =>
    shop?.wizard_styles?.length ? shop.wizard_styles : DEFAULT_WIZARD_STYLES
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
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ done: 0, total: 0 });
  const [enriching, setEnriching] = useState(false);

  async function handleSSSearch(e) {
    e?.preventDefault?.();
    const q = ssSearch.trim();
    if (!q) return;
    setSsSearching(true);
    setSsError("");
    setSsResults([]);
    try {
      // Search both supplier APIs in parallel and merge results. Many
      // style numbers exist in both catalogs under different brands
      // (e.g. "5080" = Red Kap on S&S, Heavy Tee on AS Colour) so we
      // show both so the shop picks the right one. allSettled — if one
      // supplier errors we still surface results from the other.
      const [ssRes, acRes, smRes] = await Promise.allSettled([
        supabase.functions.invoke("ssLookupStyle", { body: { styleNumber: q } }),
        supabase.functions.invoke("acLookupStyle", { body: { styleCode: q } }),
        supabase.functions.invoke("smLookupStyle", { body: { styleNumber: q } }),
      ]);
      const ssData = ssRes.status === "fulfilled" ? ssRes.value?.data : null;
      const acData = acRes.status === "fulfilled" ? acRes.value?.data : null;
      const smData = smRes.status === "fulfilled" ? smRes.value?.data : null;
      const ssMatches = (ssData?.matches || []).map(m => ({
        id: m.id || `ss-${m.styleNumber || m.styleName}`,
        brandName: m.brandName || "",
        styleNumber: m.styleNumber || m.styleName,
        description: m.description || "",
        styleCategory: m.styleCategory || "",
        styleImage: m.styleImage || m.colors?.[0]?.imageUrl || "",
        piecePrice: m.piecePrice || 0,
        source: "ss",
      }));
      const acMatches = (acData?.matches || []).map(m => ({
        id: m.id || `ac-${m.styleNumber || m.styleCode}`,
        brandName: m.brandName || "AS Colour",
        styleNumber: m.styleNumber || m.styleCode || q.toUpperCase(),
        description: m.description || m.resolvedTitle || "",
        styleCategory: m.styleCategory || "",
        styleImage: m.styleImage || m.colors?.[0]?.imageUrl || "",
        piecePrice: m.piecePrice || 0,
        source: "ac",
      }));
      const smMatches = (smData?.matches || []).map(m => ({
        id: m.id ? `sm-${m.id}` : `sm-${m.styleNumber || q}`,
        brandName: m.brandName || "",
        styleNumber: m.styleNumber || q.toUpperCase(),
        description: m.description || m.title || "",
        styleCategory: m.styleCategory || "",
        styleImage: m.styleImage || m.colors?.[0]?.imageUrl || "",
        piecePrice: m.piecePrice || 0,
        source: "sanmar",
      }));
      const matches = [...ssMatches, ...acMatches, ...smMatches];
      if (matches.length === 0) setSsError(`No results for "${q}"`);
      else setSsResults(matches);
    } catch (err) {
      setSsError(err?.message || "Search failed");
    } finally {
      setSsSearching(false);
    }
  }

  async function addFromSSResult(match) {
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

    // Block the UI briefly while we pull the full product payload —
    // colors, color images, weight, description. The 1-2s wait here
    // means the customer never sees a load spinner or broken image
    // in the wizard later. Pass the brand from the search result so
    // we don't accidentally pull a different supplier's same-numbered
    // style on the next sync.
    setEnriching(true);
    // match.source pins enrichment to the supplier the shop just picked —
    // the same brand+style can exist on both S&S and SanMar, and the pick
    // IS the supplier decision.
    const enriched = await enrichStyleData(match.styleNumber, match.brandName, supabase, match.source);
    setEnriching(false);

    setStyles(prev => [
      ...prev,
      {
        id: uid(),
        styleNumber: match.styleNumber,
        brand: match.brandName,
        garment,
        tag: "",
        hoverDescription: "",
        ...(enriched || {}),
      },
    ]);
    setSsResults([]);
    setSsSearch("");
  }

  // Re-pull supplier data for every configured style. Used to refresh
  // stale photos / color lists, or to backfill enrichment for styles
  // that pre-date the eager-enrich feature. Runs in batches of 4 so
  // we don't hammer the supplier APIs all at once.
  async function handleSyncAll() {
    if (syncing) return;
    const targets = styles.filter(s => s.styleNumber);
    if (targets.length === 0) return;
    setSyncing(true);
    setSyncProgress({ done: 0, total: targets.length });
    const BATCH = 4;
    const updated = [...styles];
    let done = 0;
    for (let i = 0; i < targets.length; i += BATCH) {
      const batch = targets.slice(i, i + BATCH);
      const results = await Promise.all(
        // s.enrichedFrom keeps each style on the supplier it was originally
        // enriched from — without it a re-sync flips overlapping-brand
        // styles (Gildan, Bella...) to whichever supplier wins the default
        // preference order, silently changing the shop's garment costs.
        batch.map(async s => ({ id: s.id, data: await enrichStyleData(s.styleNumber, s.brand, supabase, s.enrichedFrom) }))
      );
      for (const { id, data } of results) {
        if (!data) continue;
        const idx = updated.findIndex(s => s.id === id);
        if (idx >= 0) updated[idx] = { ...updated[idx], ...data };
      }
      done += batch.length;
      setSyncProgress({ done, total: targets.length });
    }
    setStyles(updated);
    setSyncing(false);
    setSyncProgress({ done: 0, total: 0 });
  }

  function resetToDefaults() {
    if (!window.confirm("Reset wizard styles to InkTracker defaults?")) return;
    setStyles(DEFAULT_WIZARD_STYLES);
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      // Auto-enrich any style that doesn't yet have a styleImage +
      // colorImages payload. This catches: (a) the wizard's
      // DEFAULT_WIZARD_STYLES on first save for a new shop, (b) any
      // manually-typed style numbers that were added without going
      // through the SS search, (c) older configs from before the
      // eager-enrich helper existed. Lookups run in parallel.
      const missing = styles.filter(s => s.styleNumber && !isStyleEnriched(s));
      let finalStyles = styles;
      if (missing.length > 0) {
        const fetched = await Promise.all(
          missing.map(async s => ({ id: s.id, data: await enrichStyleData(s.styleNumber, s.brand, supabase, s.enrichedFrom) }))
        );
        finalStyles = styles.map(s => {
          const hit = fetched.find(h => h.id === s.id);
          return hit?.data ? { ...s, ...hit.data } : s;
        });
        setStyles(finalStyles);
      }
      const payload = {
        wizard_styles: finalStyles,
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
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-900">Wizard Garment Styles</h3>
            <p className="text-xs text-slate-500 mt-0.5">Search S&amp;S Activewear or AS Colour to add garments. Images, colors, and pricing pull automatically.</p>
          </div>
          {styles.some(s => s.styleNumber) && (
            <button
              type="button"
              onClick={handleSyncAll}
              disabled={syncing}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-600 hover:text-teal-700 border border-teal-200 hover:border-teal-300 bg-teal-50 hover:bg-teal-100 px-3 py-1.5 rounded-lg transition disabled:opacity-60 disabled:cursor-not-allowed shrink-0"
              title="Re-pull photos, colors, and pricing from S&S and AS Colour for every configured style"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? `Syncing ${syncProgress.done}/${syncProgress.total}` : "Sync from suppliers"}
            </button>
          )}
        </div>

        <form onSubmit={handleSSSearch} className="flex gap-2 mb-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
            <input value={ssSearch} onChange={e => setSsSearch(e.target.value)}
              placeholder="Search by style # (e.g. 5000, 1717, IND4000)"
              className="w-full text-sm border border-slate-200 rounded-lg pl-9 pr-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-teal-300"
              disabled={ssSearching} />
          </div>
          <button type="submit" disabled={ssSearching || !ssSearch.trim()}
            className="text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 px-4 py-2 rounded-lg transition">
            {ssSearching ? "Searching…" : "Search"}
          </button>
        </form>

        {ssError && <div className="text-xs text-red-500 mb-3">{ssError}</div>}

        {ssResults.length > 0 && (
          <div className="border border-teal-200 rounded-xl bg-teal-50/50 p-3 mb-3 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-semibold text-teal-600 uppercase tracking-widest">Select a result to add</div>
              {enriching && (
                <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-teal-600">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  Pulling photos &amp; colors…
                </div>
              )}
            </div>
            {ssResults.map(m => (
              <button key={m.id} onClick={() => addFromSSResult(m)} disabled={enriching}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-teal-200 bg-white hover:border-teal-400 hover:bg-teal-50 transition text-left disabled:opacity-60 disabled:cursor-wait">
                {m.styleImage && <img src={m.styleImage} alt="" className="w-10 h-10 rounded-lg object-contain bg-slate-50 flex-shrink-0" />}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-slate-900 truncate">{m.brandName} {m.styleNumber}</div>
                  <div className="text-xs text-slate-500 truncate">{m.description}</div>
                </div>
                <span
                  className={`text-[10px] font-bold tracking-wider uppercase px-1.5 py-0.5 rounded-full border ${
                    m.source === "ac"
                      ? "text-amber-700 bg-amber-50 border-amber-200"
                      : m.source === "sanmar"
                        ? "text-blue-700 bg-blue-50 border-blue-200"
                        : "text-sky-700 bg-sky-50 border-sky-200"
                  }`}
                  title={m.source === "ac" ? "Match from AS Colour" : m.source === "sanmar" ? "Match from SanMar" : "Match from S&S Activewear"}
                >
                  {m.source === "ac" ? "AS Colour" : m.source === "sanmar" ? "SanMar" : "S&S"}
                </span>
                <Plus className="w-4 h-4 text-teal-500 flex-shrink-0" />
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
                dragOverIdx === idx && dragIdx !== idx ? "border-teal-400 bg-teal-50/50" : "border-slate-200 bg-slate-50/50"
              } ${dragIdx === idx ? "opacity-50" : ""}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-slate-300 mr-1 cursor-grab">⠿</span>
                  {s.styleImage && (
                    <img
                      src={s.styleImage}
                      alt=""
                      onError={(e) => { e.target.style.display = "none"; }}
                      className="w-8 h-8 rounded-md object-contain bg-slate-50 flex-shrink-0"
                    />
                  )}
                  <span className="text-sm font-bold text-slate-800 truncate">{s.brand ? `${s.brand} ${s.styleNumber}` : s.styleNumber || `Style ${idx + 1}`}</span>
                  {s.tag && <span className="text-[10px] font-semibold text-teal-600 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded-full">{s.tag}</span>}
                  {/* Enrichment indicator — green check if synced, gray dot
                      if still missing supplier data. Save will auto-sync
                      anything missing, so the gray dot is just informational. */}
                  {s.styleNumber && (
                    isStyleEnriched(s) ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full" title={`Synced from ${s.enrichedFrom === "ac" ? "AS Colour" : s.enrichedFrom === "sanmar" ? "SanMar" : "S&S"} · ${Object.keys(s.colorImages || {}).length} colors`}>
                        <Check className="w-3 h-3" /> Synced
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full" title="Will fetch supplier data on next save">
                        Pending
                      </span>
                    )
                  )}
                </div>
                <button onClick={() => removeStyle(idx)} title="Remove"
                  className="inline-flex items-center justify-center text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg p-1.5 shrink-0">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-3 items-end">
                <div>
                  <label className="text-[10px] font-semibold text-slate-500 uppercase">Category</label>
                  <select value={s.garment || "T-Shirts"} onChange={(e) => updateStyle(idx, { garment: e.target.value })}
                    className="w-full text-sm border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-teal-300 mt-0.5">
                    {CATEGORIES.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-slate-500 uppercase">Tag</label>
                  <input value={s.tag || ""} onChange={(e) => updateStyle(idx, { tag: e.target.value })}
                    placeholder="Best Value, Shop Pick, etc." className="w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-teal-300 mt-0.5" />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-slate-500 uppercase">Tagline (hover)</label>
                  <input value={s.hoverDescription || ""} onChange={(e) => updateStyle(idx, { hoverDescription: e.target.value })}
                    placeholder="100% cotton, great for screen printing"
                    className="w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-teal-300 mt-0.5" />
                </div>
              </div>
            </div>
          ))}
          {styles.length === 0 && (
            <div className="text-sm text-slate-500 text-center py-4">No styles configured.</div>
          )}
        </div>
      </div>

      {/* Save */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-teal-600 hover:bg-teal-700 disabled:bg-teal-300 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition"
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
