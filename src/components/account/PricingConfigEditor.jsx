import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/supabaseClient";
import { clampRushTierMaxDays, defaultNewRushTierMaxDays } from "@/lib/pricing/rushTierClamp";
import { createUndoHistory, recordChange, undoTo } from "@/lib/pricing/undoHistory";
import { decidePricingSave } from "@/lib/pricing/inputValidation";
import { loadShopPricingConfig } from "@/components/shared/pricing";
import NumericInput from "@/components/shared/NumericInput";
import { notify } from "@/lib/notify";
import { shopScope } from "@/lib/shopScope";
import { DEFAULT_TIERS, DEFAULT_COLORS, DEFAULTS } from "./pricingConfigDefaults";
import { ExtrasEditor, PrintTableEditor, EmbroideryTab, CustomTechniqueTab, SetupFeesEditor } from "./PricingEditorParts";
import BrokerPricingSection from "./BrokerPricingSection";
import EventPackagesEditor from "./EventPackagesEditor";

// Account → Pricing & Fees editor. Extracted verbatim from Account.jsx
// as a pure decomposition — no behavior change. Receives the current
// `user` as a prop; owns all of its own pricing_config state + handlers.
export default function PricingConfigEditor({ user }) {
  const SUPABASE_FUNC_URL = import.meta.env.VITE_SUPABASE_URL;
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pricingTab, setPricingTab] = useState("screen_print");
  // In-session undo (tester 2026-07-18). Every config change lands in
  // the history via the effect below; rapid keystrokes coalesce into
  // one step. Undo also recovers from "Reset to Defaults". Cleared by
  // nothing — the stack only exists until the component unmounts.
  const undoHistoryRef = useRef(createUndoHistory());
  const [undoDepth, setUndoDepth] = useState(0);

  useEffect(() => {
    if (!config) return;
    setUndoDepth(recordChange(undoHistoryRef.current, config, Date.now()));
  }, [config]);

  function handleUndo() {
    const prev = undoTo(undoHistoryRef.current);
    if (!prev) return;
    setConfig(prev);
    setUndoDepth(undoHistoryRef.current.stack.length);
  }

  useEffect(() => {
    async function load() {
      try {
        const shops = await base44.entities.Shop.filter({ owner_email: shopScope(user) });
        const pc = shops?.[0]?.pricing_config || {};
        setConfig({ ...DEFAULTS, ...pc });
      } catch {
        setConfig({ ...DEFAULTS });
      }
      setLoading(false);
    }
    if (user) load();
  }, [user]);

  async function handleSave() {
    // Validation gate. Decision + message format pinned by
    // decidePricingSave tests DS1–DS8 (lib/pricing/__tests__/
    // inputValidation.test.js). DS7 in particular locks the
    // user-facing alert wording so a copy refactor doesn't slip
    // past CI.
    const decision = decidePricingSave(config);
    if (!decision.canSave) {
      notify.error("Can't save pricing", decision.alertMessage);
      return;
    }

    setSaving(true);
    try {
      const shops = await base44.entities.Shop.filter({ owner_email: shopScope(user) });
      if (shops?.[0]) {
        await base44.entities.Shop.update(shops[0].id, { pricing_config: config });
      }
      // Refresh the engine's module-level _pc so the change is live
      // without a full reload. Without this, the shop owner saves a
      // toggle, hops to Quotes, and sees stale pricing math until they
      // hard-refresh. Scope to the OWNER's shop (shopScope) so a MANAGER
      // saving the owner's config attributes it to the right shop (CACHE-01).
      loadShopPricingConfig(config, shopScope(user));
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      notify.error("Couldn't save pricing", err);
    }
    setSaving(false);
  }

  // Helpers below receive already-parsed numbers from NumericInput
  // (or pre-arithmetic-transformed numbers from a few remaining
  // callers). Don't re-coerce — that's how the silent-zero bug crept
  // in originally. Save-gate (decidePricingSave) catches anything
  // that slips through.
  function updatePrintTable(table, colors, tier, value, scope) {
    setConfig(prev => {
      const slice = scope ? (prev.custom_techniques?.[scope] || {}) : prev;
      const next = {
        [table]: {
          ...(slice[table] || {}),
          [colors]: { ...((slice[table] || {})[colors] || {}), [tier]: value },
        },
      };
      if (!scope) return { ...prev, ...next };
      return {
        ...prev,
        custom_techniques: {
          ...(prev.custom_techniques || {}),
          [scope]: { ...slice, ...next },
        },
      };
    });
  }

  function updateMarkup(idx, field, value) {
    setConfig(prev => {
      const m = [...prev.garmentMarkup];
      m[idx] = { ...m[idx], [field]: value };
      return { ...prev, garmentMarkup: m };
    });
  }

  // ── Scope-aware accessors ─────────────────────────────────────────
  // `scope` is undefined for the built-in Screen Print tab (handlers
  // operate on top-level config fields) or a custom-technique name
  // for the "+ Add Method" tabs (handlers operate on
  // config.custom_techniques[scope]). Same rendering + handler code
  // serves both — that's how Screen Print and DTG end up looking
  // structurally identical instead of feeling like two different
  // tools bolted together.
  function getSlice(cfg, scope) {
    if (!scope) return cfg || {};
    if (scope === "embroidery") return cfg?.embroidery || {};
    return cfg?.custom_techniques?.[scope] || {};
  }
  function setSlice(prev, scope, patch) {
    if (!scope) return { ...prev, ...patch };
    if (scope === "embroidery") {
      return { ...prev, embroidery: { ...(prev.embroidery || {}), ...patch } };
    }
    return {
      ...prev,
      custom_techniques: {
        ...(prev.custom_techniques || {}),
        [scope]: { ...(prev.custom_techniques?.[scope] || {}), ...patch },
      },
    };
  }

  function updateExtra(key, value, scope) {
    setConfig(prev => {
      const slice = getSlice(prev, scope);
      return setSlice(prev, scope, {
        extras: { ...(slice.extras || {}), [key]: value },
      });
    });
  }

  function setExtraMode(key, mode, scope) {
    setConfig(prev => {
      const slice = getSlice(prev, scope);
      return setSlice(prev, scope, {
        extraModes: { ...(slice.extraModes || {}), [key]: mode },
      });
    });
  }

  // Category: per_print | per_garment | per_job. Stored in a parallel map so
  // existing fees (absent from it) default to per_garment = today's behavior.
  function setExtraBasis(key, basis, scope) {
    const clean = ["per_print", "per_garment", "per_job"].includes(basis) ? basis : "per_garment";
    setConfig(prev => {
      const slice = getSlice(prev, scope);
      return setSlice(prev, scope, {
        extraBasis: { ...(slice.extraBasis || {}), [key]: clean },
      });
    });
  }

  // Per-job fee taxability. Parallel map like extraBasis — absent means
  // TAXABLE (today's behavior, and the shop-safe default: over-collecting
  // then remitting beats silently under-collecting). Only surfaced in the
  // editor for per_job fees: per_garment/per_print fees ride line pricing,
  // where the whole line is taxed as usual.
  function setExtraTaxable(key, taxable, scope) {
    setConfig(prev => {
      const slice = getSlice(prev, scope);
      return setSlice(prev, scope, {
        extraTaxable: { ...(slice.extraTaxable || {}), [key]: !!taxable },
      });
    });
  }

  function addExtra(scope) {
    const id = `custom_${Date.now()}`;
    setConfig(prev => {
      const slice = getSlice(prev, scope);
      return setSlice(prev, scope, {
        extras:      { ...(slice.extras || {}),      [id]: 0 },
        extraLabels: { ...(slice.extraLabels || {}), [id]: "New Fee" },
        extraModes:  { ...(slice.extraModes || {}),  [id]: "flat" },
        extraBasis:  { ...(slice.extraBasis || {}),  [id]: "per_garment" },
      });
    });
  }

  function removeExtra(key, scope) {
    setConfig(prev => {
      const slice = getSlice(prev, scope);
      const next = {
        extras:      { ...(slice.extras || {}) },
        extraLabels: { ...(slice.extraLabels || {}) },
        extraModes:  { ...(slice.extraModes || {}) },
        extraBasis:  { ...(slice.extraBasis || {}) },
      };
      delete next.extras[key];
      delete next.extraLabels[key];
      delete next.extraModes[key];
      delete next.extraBasis[key];
      return setSlice(prev, scope, next);
    });
  }

  function updateExtraLabel(key, label, scope) {
    setConfig(prev => {
      const slice = getSlice(prev, scope);
      return setSlice(prev, scope, {
        extraLabels: { ...(slice.extraLabels || {}), [key]: label },
      });
    });
  }

  // Single editor for any technique's extras. Same row layout
  // (label | $/% toggle | value | × remove) and + Add fee button
  // everywhere — Screen Print, Embroidery, and any custom method.
  // The scope-aware handlers above route writes to the right slice.
  function renderExtrasEditor(scope, opts = {}) {
    return (
      <ExtrasEditor
        config={config}
        scope={scope}
        opts={opts}
        getSlice={getSlice}
        updateExtraLabel={updateExtraLabel}
        setExtraMode={setExtraMode}
        setExtraBasis={setExtraBasis}
        setExtraTaxable={setExtraTaxable}
        updateExtra={updateExtra}
        removeExtra={removeExtra}
        addExtra={addExtra}
      />
    );
  }

  function addTier(scope) {
    setConfig(prev => {
      const slice = getSlice(prev, scope);
      const tiers = slice.tiers || prev.tiers || DEFAULT_TIERS;
      const last = tiers[tiers.length - 1] || 100;
      const newTier = last * 2;
      const newTiers = [...tiers, newTier].sort((a, b) => a - b);
      const fp = { ...(slice.firstPrint || {}) };
      const ap = { ...(slice.addlPrint  || {}) };
      for (const c of Object.keys(fp)) { fp[c] = { ...fp[c], [newTier]: 0 }; }
      for (const c of Object.keys(ap)) { ap[c] = { ...ap[c], [newTier]: 0 }; }
      return setSlice(prev, scope, { tiers: newTiers, firstPrint: fp, addlPrint: ap });
    });
  }

  function removeTier(tier, scope) {
    setConfig(prev => {
      const slice = getSlice(prev, scope);
      const tiers = (slice.tiers || prev.tiers || DEFAULT_TIERS).filter(t => t !== tier);
      if (tiers.length < 1) return prev;
      const stripColumn = (table) => {
        const out = {};
        for (const c of Object.keys(table || {})) {
          const { [tier]: _drop, ...rest } = table[c] || {};
          out[c] = rest;
        }
        return out;
      };
      return setSlice(prev, scope, {
        tiers,
        firstPrint: stripColumn(slice.firstPrint),
        addlPrint:  stripColumn(slice.addlPrint),
      });
    });
  }

  function updateTierValue(oldTier, newValue, scope) {
    const val = parseInt(newValue) || 0;
    if (val <= 0) return;
    setConfig(prev => {
      const slice = getSlice(prev, scope);
      const tiers = (slice.tiers || prev.tiers || DEFAULT_TIERS)
        .map(t => t === oldTier ? val : t)
        .sort((a, b) => a - b);
      const rename = (table) => {
        const out = {};
        for (const c of Object.keys(table || {})) {
          out[c] = {};
          for (const t of Object.keys(table[c])) {
            const k = parseInt(t) === oldTier ? val : parseInt(t);
            out[c][k] = table[c][t];
          }
        }
        return out;
      };
      return setSlice(prev, scope, {
        tiers,
        firstPrint: rename(slice.firstPrint),
        addlPrint:  rename(slice.addlPrint),
      });
    });
  }

  function addColorRow(scope) {
    setConfig(prev => {
      const slice = getSlice(prev, scope);
      const maxC = slice.maxColors || prev.maxColors || DEFAULT_COLORS;
      const newC = maxC + 1;
      const tiers = slice.tiers || prev.tiers || DEFAULT_TIERS;
      const emptyRow = {};
      tiers.forEach(t => { emptyRow[t] = 0; });
      return setSlice(prev, scope, {
        maxColors:  newC,
        firstPrint: { ...(slice.firstPrint || {}), [newC]: { ...emptyRow } },
        addlPrint:  { ...(slice.addlPrint  || {}), [newC]: { ...emptyRow } },
      });
    });
  }

  function removeColorRow(scope) {
    setConfig(prev => {
      const slice = getSlice(prev, scope);
      const maxC = slice.maxColors || prev.maxColors || DEFAULT_COLORS;
      if (maxC <= 1) return prev;
      const fp = { ...(slice.firstPrint || {}) }; delete fp[maxC];
      const ap = { ...(slice.addlPrint  || {}) }; delete ap[maxC];
      return setSlice(prev, scope, { maxColors: maxC - 1, firstPrint: fp, addlPrint: ap });
    });
  }

  // Embroidery helpers
  function addEmbTier() {
    const et = config.embroidery?.qtyTiers || [12, 24, 48, 72, 144];
    const last = et[et.length - 1] || 100;
    const newTier = last * 2;
    const newTiers = [...et, newTier].sort((a, b) => a - b);
    const pricing = { ...config.embroidery.pricing };
    for (const st of Object.keys(pricing)) { pricing[st] = { ...pricing[st], [newTier]: 0 }; }
    setConfig(prev => ({ ...prev, embroidery: { ...prev.embroidery, qtyTiers: newTiers, pricing } }));
  }

  function removeEmbTier(tier) {
    const et = (config.embroidery?.qtyTiers || []).filter(t => t !== tier);
    if (et.length < 1) return;
    // Symmetric cleanup with addEmbTier: drop the orphan column from
    // each stitch-tier's pricing object. Without this, removing a tier
    // leaves {[tier]: 0} keys lingering in pricing_config and they
    // accumulate every time a shop adjusts their tiers.
    const pricing = {};
    for (const st of Object.keys(config.embroidery?.pricing || {})) {
      const { [tier]: _drop, ...rest } = config.embroidery.pricing[st] || {};
      pricing[st] = rest;
    }
    setConfig(prev => ({
      ...prev,
      embroidery: { ...prev.embroidery, qtyTiers: et, pricing },
    }));
  }

  function updateEmbTierValue(oldTier, newValue) {
    const val = parseInt(newValue) || 0;
    if (val <= 0) return;
    const et = (config.embroidery?.qtyTiers || []).map(t => t === oldTier ? val : t).sort((a, b) => a - b);
    const pricing = {};
    for (const st of Object.keys(config.embroidery.pricing)) {
      pricing[st] = {};
      for (const t of Object.keys(config.embroidery.pricing[st])) {
        const k = parseInt(t) === oldTier ? val : parseInt(t);
        pricing[st][k] = config.embroidery.pricing[st][t];
      }
    }
    setConfig(prev => ({ ...prev, embroidery: { ...prev.embroidery, qtyTiers: et, pricing } }));
  }

  function updateEmbroideryPrice(stitchTier, qtyTier, value) {
    setConfig(prev => ({
      ...prev,
      embroidery: {
        ...prev.embroidery,
        pricing: {
          ...prev.embroidery.pricing,
          [stitchTier]: { ...prev.embroidery.pricing[stitchTier], [qtyTier]: value },
        },
      },
    }));
  }


  if (loading || !config) return <div className="text-sm text-slate-500 py-4">Loading pricing config...</div>;

  const tiers = config.tiers || DEFAULT_TIERS;
  const maxColors = config.maxColors || DEFAULT_COLORS;
  const colorRows = Array.from({ length: maxColors }, (_, i) => i + 1);
  const emb = config.embroidery || DEFAULTS.embroidery;
  const inputCls = "w-full text-xs text-center border border-slate-200 rounded px-1 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-300";

  // Same renderer for Screen Print (scope undefined) and any custom
  // technique (scope = tech name). Pulls tiers/maxColors/table data
  // from the scope's slice via getSlice, dispatches handlers with
  // the same scope. That's how DTG / DTF / etc. end up with the
  // identical UI as Screen Print instead of feeling like a
  // separate, lesser editor.
  function renderPrintTable(tableKey, title, scope) {
    return (
      <PrintTableEditor
        config={config}
        tableKey={tableKey}
        title={title}
        scope={scope}
        inputCls={inputCls}
        updateTierValue={updateTierValue}
        removeTier={removeTier}
        addTier={addTier}
        updatePrintTable={updatePrintTable}
      />
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-xs text-slate-500">Customize your pricing for quotes. These rates apply to all new quotes.</p>

      {/* Garment Markup — applies to all decoration types */}
      <div>
        <h4 className="text-xs font-bold text-slate-600 uppercase tracking-widest mb-2">Garment Markup</h4>
        <p className="text-[10px] text-slate-500 mb-2">Percentage added to wholesale garment cost. Higher markup for cheaper garments.</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {config.garmentMarkup.map((tier, i) => (
            <div key={i} className="border border-slate-200 rounded-lg p-2">
              <label className="text-[10px] text-slate-500 block mb-1">
                {tier.above > 0 ? `Above $${tier.above}` : "Default"}
              </label>
              <div className="relative">
                <NumericInput
                  value={Math.round((tier.markup - 1) * 100)}
                  onChange={(pct) => updateMarkup(i, "markup", pct / 100 + 1)}
                  min={0}
                  max={1000}
                  integer
                  label={`Markup tier ${i + 1} %`}
                  className={inputCls}
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-slate-500 pointer-events-none">%</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Broker Markup Share */}
      <div>
        <h4 className="text-xs font-bold text-slate-600 uppercase tracking-widest mb-2">Broker Markup Share</h4>
        <p className="text-[10px] text-slate-500 mb-2">Discount off your garment markup that brokers receive on every quote. Higher = lower wholesale price for brokers (they earn margin by reselling above it).</p>
        <div className="flex items-center gap-3">
          <div className="relative w-28">
            <NumericInput
              value={Math.round((config.brokerMarkupShare ?? 0.2) * 100)}
              onChange={(pct) => setConfig(prev => ({ ...prev, brokerMarkupShare: pct / 100 }))}
              min={0}
              max={100}
              integer
              label="Broker markup share %"
              className={inputCls}
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-slate-500 pointer-events-none">%</span>
          </div>
          <span className="text-xs text-slate-500">off garment markup for brokers</span>
        </div>
      </div>

      {/* Per-broker overrides — stored in the broker_pricing table (its
          own storage on purpose: never rides into the public wizard's
          pricing_config payload). Saves independently of the Save
          Pricing button below. */}
      <BrokerPricingSection user={user} config={config} />

      {/* Standard turnaround — shop-wide, lives above the decoration
          tabs because the default due date and rush surcharge are not
          decoration-specific. */}
      <div>
        <label className="text-[10px] text-slate-500 block mb-1">Standard Turnaround</label>
        <div className="relative w-40">
          <NumericInput
            value={config.standardTurnaroundDays ?? 10}
            onChange={(n) => setConfig(prev => ({ ...prev, standardTurnaroundDays: Math.max(1, Math.round(Number(n) || 1)) }))}
            min={1}
            max={365}
            integer
            label="Standard turnaround days"
            className="w-full text-xs border border-slate-200 rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-300"
          />
          <span className="absolute right-2 top-1.5 text-[10px] text-slate-500">days</span>
        </div>
        <p className="text-[10px] text-slate-500 mt-1">Default due-date offset on new quotes. Anything sooner than this triggers the rush rate below.</p>
      </div>

      {/* Variable Rush Surcharge — shop-wide tier list. */}
      <div>
        <h4 className="text-xs font-bold text-slate-600 uppercase tracking-widest mb-1">Rush Surcharge Tiers</h4>
        <p className="text-[10px] text-slate-500 mb-2">
          Variable rush rate based on how soon the order is due. Add a tier per "cliff": e.g. less than 3 days = +50%, less than 6 days = +25%. The tightest matching tier wins.
          {" "}Tier days can't be longer than Standard Turnaround above — rush is faster than standard, by definition.
        </p>
        <div className="border border-slate-200 rounded-xl p-3 space-y-2">
          <div className="grid grid-cols-[1fr_120px_120px_32px] gap-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider px-1">
            <div>If due in less than</div>
            <div>Surcharge</div>
            <div />
            <div />
          </div>
          {(() => {
            const tiers = Array.isArray(config.rushTiers) ? [...config.rushTiers] : [];
            const sorted = tiers
              .map((t, i) => ({ ...t, _origIdx: i }))
              .sort((a, b) => (Number(a.maxDays) || 0) - (Number(b.maxDays) || 0));
            if (sorted.length === 0) {
              return (
                <div className="text-xs text-slate-500 italic px-1 py-1">No rush tiers — your shop won't charge any rush surcharge until you add at least one.</div>
              );
            }
            return sorted.map((tier, idx) => (
              <div key={tier._origIdx} className="grid grid-cols-[1fr_120px_120px_32px] gap-2 items-center">
                <div className="relative">
                  <NumericInput
                    value={tier.maxDays ?? ""}
                    onChange={(n) => setConfig(prev => {
                      const next = [...(prev.rushTiers || [])];
                      next[tier._origIdx] = {
                        ...next[tier._origIdx],
                        maxDays: clampRushTierMaxDays(n, prev.standardTurnaroundDays),
                      };
                      return { ...prev, rushTiers: next };
                    })}
                    min={1}
                    max={Math.max(1, Math.round(Number(config.standardTurnaroundDays || 10)))}
                    integer
                    label={`Rush tier ${idx + 1} max days`}
                    className="w-full text-xs border border-slate-200 rounded pl-3 pr-12 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-300"
                  />
                  <span className="absolute right-2 top-1.5 text-[10px] text-slate-500">days</span>
                </div>
                <div className="relative">
                  <NumericInput
                    value={Math.round((Number(tier.rate) || 0) * 100)}
                    onChange={(pct) => setConfig(prev => {
                      const next = [...(prev.rushTiers || [])];
                      next[tier._origIdx] = { ...next[tier._origIdx], rate: Math.max(0, Math.min(100, Number(pct) || 0)) / 100 };
                      return { ...prev, rushTiers: next };
                    })}
                    min={0}
                    max={500}
                    integer
                    label={`Rush tier ${idx + 1} rate %`}
                    className="w-full text-xs border border-slate-200 rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-300"
                  />
                  <span className="absolute right-2 top-1.5 text-xs text-slate-500">%</span>
                </div>
                <div />
                <button
                  onClick={() => setConfig(prev => ({
                    ...prev,
                    rushTiers: (prev.rushTiers || []).filter((_, i) => i !== tier._origIdx),
                  }))}
                  className="text-slate-300 hover:text-red-500 transition text-sm"
                  title="Remove tier"
                >&times;</button>
              </div>
            ));
          })()}
          <button
            type="button"
            onClick={() => {
              const defaultDays = defaultNewRushTierMaxDays(
                config.rushTiers,
                config.standardTurnaroundDays,
              );
              setConfig(prev => ({
                ...prev,
                rushTiers: [...(prev.rushTiers || []), { maxDays: defaultDays, rate: 0.25 }],
              }));
            }}
            className="text-xs font-semibold text-teal-600 hover:text-teal-700 mt-1 transition"
          >
            + Add tier
          </button>
        </div>
      </div>

      {/* Decoration type tabs */}
      {/* First-Location Ordering — global setting, applies to every
          non-embroidery decoration method. Lives above the tabs so
          it's clear it isn't a per-technique knob. */}
      <div>
        <h4 className="text-xs font-bold text-slate-600 uppercase tracking-widest mb-2">First-Location Ordering</h4>
        <p className="text-[10px] text-slate-500 mb-2">
          When a job has multiple imprint locations with different color counts, which one absorbs the "first" rate (where you&apos;ve baked in setup)? Applies to all decoration methods.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[
            { value: "fewest", label: "Fewest colors first", hint: "Simpler imprint carries setup. Lower bill on mixed jobs." },
            { value: "most", label: "Most colors first", hint: "Complex imprint carries setup. Matches typical industry convention." },
          ].map(opt => {
            const current = config.firstPrintOrdering || "fewest";
            const selected = current === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setConfig(prev => ({ ...prev, firstPrintOrdering: opt.value }))}
                className={`text-left border rounded-lg p-3 transition ${
                  selected
                    ? "border-teal-500 bg-teal-50 ring-1 ring-teal-300"
                    : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <div className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <span className={`inline-block w-3 h-3 rounded-full border ${selected ? "bg-teal-500 border-teal-500" : "border-slate-300"}`} />
                  {opt.label}
                </div>
                <p className="text-[10px] text-slate-500 mt-1 ml-4">{opt.hint}</p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex gap-1 border-b border-slate-200 pb-0 flex-wrap">
        <button onClick={() => setPricingTab("screen_print")}
          className={`text-xs font-semibold px-4 py-2 rounded-t-lg transition ${pricingTab === "screen_print" ? "bg-teal-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}>
          Screen Print
        </button>
        <button onClick={() => { setPricingTab("embroidery"); if (!emb.enabled) setConfig(prev => ({ ...prev, embroidery: { ...prev.embroidery, enabled: true } })); }}
          className={`text-xs font-semibold px-4 py-2 rounded-t-lg transition ${pricingTab === "embroidery" ? "bg-teal-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}>
          Embroidery {emb.enabled && <span className="ml-1 text-emerald-400">*</span>}
        </button>
        {/* Custom techniques (DTG, DTF, Heat Transfer, Sublimation,
            anything the shop has named). Inserted between Embroidery
            and the + Add button so the order matches the technique
            dropdown the line-item editor sees. */}
        {Object.keys(config.custom_techniques || {}).map((name) => (
          <button
            key={name}
            onClick={() => setPricingTab(`custom:${name}`)}
            className={`text-xs font-semibold px-4 py-2 rounded-t-lg transition ${pricingTab === `custom:${name}` ? "bg-teal-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}
          >
            {name}
          </button>
        ))}
        <button
          onClick={() => {
            const name = (window.prompt("New decoration method name (e.g. DTG, DTF, Heat Transfer):", "DTG") || "").trim();
            if (!name) return;
            if (name === "Screen Print" || name === "Embroidery") {
              window.alert(`"${name}" already exists as a built-in tab.`);
              return;
            }
            if (config.custom_techniques?.[name]) {
              window.alert(`"${name}" already exists.`);
              setPricingTab(`custom:${name}`);
              return;
            }
            // Seed with the current Screen Print values so the shop
            // has a sane starting point. They can edit any cell.
            setConfig(prev => ({
              ...prev,
              custom_techniques: {
                ...(prev.custom_techniques || {}),
                [name]: {
                  firstPrint: JSON.parse(JSON.stringify(prev.firstPrint || {})),
                  addlPrint:  JSON.parse(JSON.stringify(prev.addlPrint  || {})),
                  tiers:      [...(prev.tiers || [25, 50, 100, 200])],
                  maxColors:  prev.maxColors || 8,
                },
              },
            }));
            setPricingTab(`custom:${name}`);
          }}
          className="text-xs font-semibold px-3 py-2 rounded-t-lg transition text-teal-600 hover:bg-teal-50"
          title="Add a custom decoration method with its own rate table"
        >
          + Add Method
        </button>
      </div>

      {pricingTab === "screen_print" && <>

      {/* Color Count */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <h4 className="text-xs font-bold text-slate-600 uppercase tracking-widest">Max Print Colors</h4>
          <div className="flex items-center gap-1">
            <button onClick={removeColorRow} disabled={maxColors <= 1}
              className="w-6 h-6 flex items-center justify-center text-xs font-bold border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-30">-</button>
            <span className="text-sm font-bold text-slate-700 w-6 text-center">{maxColors}</span>
            <button onClick={addColorRow}
              className="w-6 h-6 flex items-center justify-center text-xs font-bold border border-slate-200 rounded hover:bg-slate-50">+</button>
          </div>
        </div>
      </div>

      {renderPrintTable("firstPrint", "First Print Location (per piece)")}
      {renderPrintTable("addlPrint", "Additional Print Locations (per piece)")}

      {/* Extras & Fees — same editor used by Embroidery + each custom
          method so the layout never drifts between tabs. */}
      {/* Global preference: show add-on names on line descriptions everywhere
          (quote page, PDF, QuickBooks invoice) vs. baking them silently into
          the price. Default off preserves the prior hidden behavior. Snapshotted
          per-line at quote save, so it only affects quotes saved while it's on. */}
      <label className="flex items-start gap-2 text-xs text-slate-600 mb-3 cursor-pointer select-none bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
        <input
          type="checkbox"
          checked={!!config.show_addons_in_description}
          onChange={(e) => setConfig(prev => ({ ...prev, show_addons_in_description: e.target.checked }))}
          className="w-4 h-4 mt-0.5 rounded border-slate-300 text-teal-600"
        />
        <span>
          <span className="font-semibold text-slate-700">Show add-on names on line items</span>
          {" — "}list each line's active add-ons (e.g. "Ink Color Match") on the quote, PDF, and
          QuickBooks invoice. When off, add-ons are still charged but not itemized.
        </span>
      </label>
      {renderExtrasEditor(null)}

      {/* Setup Fees — per-screen multiplier (list) */}
      <SetupFeesEditor config={config} setConfig={setConfig} />

      </>}

      {/* Embroidery Tab */}
      {pricingTab === "embroidery" && (
        <EmbroideryTab
          emb={emb}
          inputCls={inputCls}
          setConfig={setConfig}
          addEmbTier={addEmbTier}
          removeEmbTier={removeEmbTier}
          updateEmbTierValue={updateEmbTierValue}
          updateEmbroideryPrice={updateEmbroideryPrice}
          renderExtrasEditor={renderExtrasEditor}
        />
      )}

      {/* Custom technique editor — uses the SAME blocks as Screen
          Print (Max Colors header + inline +/× matrices + Extras
          section) via the scope-aware handlers above. That's how
          DTG / DTF / etc. end up structurally identical to Screen
          Print instead of feeling like a separate, lesser editor. */}
      {pricingTab.startsWith("custom:") && (
        <CustomTechniqueTab
          pricingTab={pricingTab}
          config={config}
          maxColors={maxColors}
          setConfig={setConfig}
          setPricingTab={setPricingTab}
          removeColorRow={removeColorRow}
          addColorRow={addColorRow}
          renderPrintTable={renderPrintTable}
          renderExtrasEditor={renderExtrasEditor}
        />
      )}

      {/* Event / package pricing — flat-rate service packages (live
          event printing) that don't fit the decoration matrices.
          Sits below the decoration tabs: it's job-level pricing, not a
          per-piece technique. Saved with the same Save button. */}
      <EventPackagesEditor config={config} setConfig={setConfig} inputCls={inputCls} />

      <div className="flex items-center gap-3">
        <button onClick={handleSave} disabled={saving}
          className="bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition disabled:opacity-50">
          {saving ? "Saving..." : saved ? "Saved" : "Save Pricing"}
        </button>
        <button
          onClick={handleUndo}
          disabled={undoDepth === 0}
          title="Undo the last pricing edit (also recovers a Reset). Doesn't touch what's already saved."
          className="text-xs text-slate-500 hover:text-slate-700 font-semibold disabled:opacity-40 disabled:cursor-not-allowed">
          ↩ Undo
        </button>
        <button
          onClick={() => {
            if (window.confirm("Reset all pricing to defaults? This wipes your custom tiers, print rates, markups, extras, and embroidery config. You'll still need to click Save to persist the reset.")) {
              setConfig({ ...DEFAULTS });
            }
          }}
          className="text-xs text-slate-500 hover:text-slate-700 font-semibold">
          Reset to Defaults
        </button>
      </div>
    </div>
  );
}
