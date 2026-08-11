import NumericInput from "@/components/shared/NumericInput";
import { DEFAULT_TIERS, DEFAULT_COLORS } from "./pricingConfigDefaults";

// Presentational sub-editors for PricingConfigEditor. Extracted verbatim
// as a pure decomposition — the JSX + inline logic are unchanged; the only
// difference is that the values/handlers the render helpers used to close
// over are now received as explicit props. Parent still owns all state.

// Single editor for any technique's extras. Same row layout
// (label | $/% toggle | value | × remove) and + Add fee button
// everywhere — Screen Print, Embroidery, and any custom method.
// The scope-aware handlers above route writes to the right slice.
export function ExtrasEditor({
  config,
  scope,
  opts = {},
  getSlice,
  updateExtraLabel,
  setExtraMode,
  setExtraBasis,
  setExtraTaxable,
  updateExtra,
  removeExtra,
  addExtra,
}) {
  const slice = getSlice(config, scope);
  const extras = slice.extras || {};
  const extraLabels = slice.extraLabels || {};
  const extraModes = slice.extraModes || {};
  const extraBasis = slice.extraBasis || {};
  const extraTaxable = slice.extraTaxable || {};
  const title = opts.title ?? "Extra Fees";
  const description = opts.description ?? "Rename, reprice, recategorize, or remove fees. The category sets how a fee applies: per garment (× pieces), per print (× print locations × pieces), or per job (once for the whole order). Toggle $ / % for a flat amount or a percentage of the line's decoration cost.";
  return (
    <div>
      <h4 className="text-xs font-bold text-slate-600 uppercase tracking-widest mb-2">{title}</h4>
      <p className="text-[10px] text-slate-500 mb-2">{description}</p>
      <div className="space-y-2">
        {Object.entries(extras).map(([key, val]) => {
          const mode = extraModes[key] === "percent" ? "percent" : "flat";
          const isPercent = mode === "percent";
          const basis = ["per_print", "per_garment", "per_job"].includes(extraBasis[key]) ? extraBasis[key] : "per_garment";
          return (
            <div key={key} className="flex items-center gap-2">
              <input
                type="text"
                value={extraLabels[key] || key.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase()).trim()}
                onChange={e => updateExtraLabel(key, e.target.value, scope)}
                className="flex-1 text-xs border border-slate-200 rounded px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-300"
              />
              <select
                value={basis}
                onChange={e => setExtraBasis(key, e.target.value, scope)}
                className="shrink-0 text-xs border border-slate-200 rounded px-1.5 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-teal-300"
                title="How this fee applies"
              >
                <option value="per_garment">Per garment</option>
                <option value="per_print">Per print</option>
                <option value="per_job">Per job</option>
              </select>
              {/* Taxability — per-job fees only (they bill as whole-order
                  additional charges; digitizing/shipping-style fees are
                  non-taxable in many states). Absent from the map = taxable,
                  so existing fees keep charging tax exactly as before. */}
              {basis === "per_job" && (
                <label
                  className="flex items-center gap-1 shrink-0 text-[10px] text-slate-500 cursor-pointer select-none"
                  title="Apply sales tax when this fee is added to a quote"
                >
                  <input
                    type="checkbox"
                    checked={extraTaxable[key] !== false}
                    onChange={e => setExtraTaxable(key, e.target.checked, scope)}
                    className="w-3.5 h-3.5 rounded border-slate-300 text-teal-600"
                  />
                  Tax
                </label>
              )}
              <div className="flex shrink-0 border border-slate-200 rounded overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExtraMode(key, "flat", scope)}
                  className={`text-xs font-semibold w-7 py-1.5 transition ${!isPercent ? "bg-teal-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}
                  title="Flat dollar amount per piece"
                >$</button>
                <button
                  type="button"
                  onClick={() => setExtraMode(key, "percent", scope)}
                  className={`text-xs font-semibold w-7 py-1.5 transition border-l border-slate-200 ${isPercent ? "bg-teal-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}
                  title="Percent of the line's per-piece decoration cost"
                >%</button>
              </div>
              <div className="relative w-24 shrink-0">
                {!isPercent && <span className="absolute left-2 top-1.5 text-xs text-slate-500">$</span>}
                <NumericInput
                  value={val}
                  onChange={(n) => updateExtra(key, n, scope)}
                  min={0}
                  max={isPercent ? 100 : 10000}
                  label={`Extras → ${key}`}
                  className={`w-full text-xs border border-slate-200 rounded py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-300 ${isPercent ? "pl-2 pr-6" : "pl-5 pr-2"}`}
                />
                {isPercent && <span className="absolute right-2 top-1.5 text-xs text-slate-500">%</span>}
              </div>
              <button
                onClick={() => removeExtra(key, scope)}
                className="text-slate-300 hover:text-red-500 transition text-sm px-1"
                title="Remove"
              >&times;</button>
            </div>
          );
        })}
      </div>
      <button
        onClick={() => addExtra(scope)}
        className="text-xs font-semibold text-teal-600 hover:text-teal-700 mt-2 transition"
      >
        + Add fee
      </button>
    </div>
  );
}

// Same renderer for Screen Print (scope undefined) and any custom
// technique (scope = tech name). Pulls tiers/maxColors/table data
// from the scope's slice via getSlice, dispatches handlers with
// the same scope. That's how DTG / DTF / etc. end up with the
// identical UI as Screen Print instead of feeling like a
// separate, lesser editor.
export function PrintTableEditor({
  config,
  tableKey,
  title,
  scope,
  inputCls,
  updateTierValue,
  removeTier,
  addTier,
  updatePrintTable,
}) {
  const cfg = scope ? (config.custom_techniques?.[scope] || {}) : config;
  const t_iers = (Array.isArray(cfg.tiers) && cfg.tiers.length > 0)
    ? cfg.tiers
    : (config.tiers || DEFAULT_TIERS);
  const maxC = cfg.maxColors || (scope ? (config.maxColors || DEFAULT_COLORS) : (config.maxColors || DEFAULT_COLORS));
  const c_rows = Array.from({ length: maxC }, (_, i) => i + 1);
  const table = cfg[tableKey] || {};
  return (
    <div>
      <h4 className="text-xs font-bold text-slate-600 uppercase tracking-widest mb-2">{title}</h4>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500">
              <th className="text-left py-1 pr-2">Colors</th>
              {t_iers.map(t => (
                <th key={t} className="text-center py-1">
                  <div className="inline-flex items-center gap-1">
                    <input type="number" value={t}
                      onChange={e => updateTierValue(t, e.target.value, scope)}
                      className="w-14 text-xs text-center border border-transparent hover:border-slate-200 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-teal-300 bg-transparent text-slate-500 font-semibold" />
                    <span className="text-slate-300">+</span>
                    {/* Remove this tier column. Hidden when there's
                        only one tier left (can't remove the last). */}
                    {t_iers.length > 1 && (
                      <button
                        onClick={() => removeTier(t, scope)}
                        className="text-slate-300 hover:text-red-500 text-xs ml-0.5"
                        title={`Remove ${t}+ tier`}
                      >×</button>
                    )}
                  </div>
                </th>
              ))}
              <th className="py-1 px-1">
                <button onClick={() => addTier(scope)} className="text-teal-500 hover:text-teal-700 text-xs font-bold" title="Add tier">+</button>
              </th>
            </tr>
          </thead>
          <tbody>
            {c_rows.map(c => (
              <tr key={c}>
                <td className="py-1 pr-2 font-semibold text-slate-600 whitespace-nowrap">{c} color{c > 1 ? "s" : ""}</td>
                {t_iers.map(t => (
                  <td key={t} className="py-1 px-0.5">
                    <NumericInput
                      value={table[c]?.[t]}
                      onChange={(n) => updatePrintTable(tableKey, c, t, n, scope)}
                      min={0}
                      max={10000}
                      label={`${scope || "Screen Print"} ${tableKey === "firstPrint" ? "first" : "additional"} ${c} color × ${t} pcs`}
                      className={inputCls}
                    />
                  </td>
                ))}
                <td></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Embroidery pricing tab. Extracted verbatim from PricingConfigEditor's
// render — the JSX is unchanged; values/handlers it closed over are now
// props. `renderExtrasEditor` is threaded in so the Embroidery Extras
// block stays identical to the Screen Print / custom-method editor.
export function EmbroideryTab({
  emb,
  inputCls,
  setConfig,
  addEmbTier,
  removeEmbTier,
  updateEmbTierValue,
  updateEmbroideryPrice,
  renderExtrasEditor,
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">Embroidery pricing by stitch count and quantity.</p>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={emb.enabled}
            onChange={e => setConfig(prev => ({ ...prev, embroidery: { ...prev.embroidery, enabled: e.target.checked } }))}
            className="w-4 h-4 rounded border-slate-300 text-teal-600" />
          <span className="text-xs font-semibold text-slate-600">Enable Embroidery</span>
        </label>
      </div>

      {emb.enabled && <>
        {/* Digitizing Fee */}
        <div>
          <h4 className="text-xs font-bold text-slate-600 uppercase tracking-widest mb-2">Digitizing / Setup Fee</h4>
          <div className="w-40">
            <div className="relative">
              <span className="absolute left-2 top-1.5 text-xs text-slate-500">$</span>
              <NumericInput
                value={emb.digitizingFee}
                onChange={(n) => setConfig(prev => ({ ...prev, embroidery: { ...prev.embroidery, digitizingFee: n } }))}
                min={0}
                max={10000}
                label="Digitizing fee"
                className="w-full text-xs border border-slate-200 rounded px-5 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-300"
              />
            </div>
            <p className="text-[10px] text-slate-500 mt-1">One-time fee per new design</p>
          </div>
        </div>

        {/* Embroidery Pricing Table */}
        {/* Tier editing lives in the table header (same pattern as
            renderPrintTable above) — the previous standalone
            "Quantity Tiers" section was redundant since the table
            already renders one column per tier. Edit a tier value
            inline, click × to remove a column, click + at the end
            to add one. */}
        <div>
          <h4 className="text-xs font-bold text-slate-600 uppercase tracking-widest mb-2">Per Piece Pricing</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500">
                  <th className="text-left py-1 pr-2">Stitch Count</th>
                  {(emb.qtyTiers || []).map(t => (
                    <th key={t} className="text-center py-1">
                      <div className="inline-flex items-center gap-1">
                        <input type="number" value={t}
                          onChange={e => updateEmbTierValue(t, e.target.value)}
                          className="w-14 text-xs text-center border border-transparent hover:border-slate-200 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-teal-300 bg-transparent text-slate-500 font-semibold" />
                        <span className="text-slate-300">+</span>
                        {(emb.qtyTiers || []).length > 1 && (
                          <button
                            onClick={() => removeEmbTier(t)}
                            className="text-slate-300 hover:text-red-500 text-xs ml-0.5"
                            title={`Remove ${t}+ tier`}
                          >×</button>
                        )}
                      </div>
                    </th>
                  ))}
                  <th className="py-1 px-1">
                    <button onClick={addEmbTier} className="text-teal-500 hover:text-teal-700 text-xs font-bold" title="Add tier">+</button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {(emb.stitchTiers || []).map(st => (
                  <tr key={st}>
                    <td className="py-1 pr-2 font-semibold text-slate-600 whitespace-nowrap">{st}</td>
                    {(emb.qtyTiers || []).map(t => (
                      <td key={t} className="py-1 px-0.5">
                        <NumericInput
                          value={emb.pricing?.[st]?.[t]}
                          onChange={(n) => updateEmbroideryPrice(st, t, n)}
                          min={0}
                          max={10000}
                          label={`Embroidery "${st}" × ${t} pcs`}
                          className={inputCls}
                        />
                      </td>
                    ))}
                    {/* Pad for the + add-tier column in the header */}
                    <td></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Embroidery Extras — same editor as Screen Print, scoped
            to the embroidery slice. Existing rows without
            extraLabels/extraModes fall back to camelCase→Title +
            "flat" so the migration is implicit. */}
        {renderExtrasEditor("embroidery", {
          title: "Embroidery Extras (per piece)",
          description: "Fees that only apply when an imprint's technique is Embroidery. Toggle $ / % per fee.",
        })}
      </>}
    </div>
  );
}

// Custom technique editor — uses the SAME blocks as Screen
// Print (Max Colors header + inline +/× matrices + Extras
// section) via the scope-aware handlers above. That's how
// DTG / DTF / etc. end up structurally identical to Screen
// Print instead of feeling like a separate, lesser editor.
// Extracted verbatim from the render IIFE; the guard for a
// deleted technique + all handlers are threaded as props.
export function CustomTechniqueTab({
  pricingTab,
  config,
  maxColors,
  setConfig,
  setPricingTab,
  removeColorRow,
  addColorRow,
  renderPrintTable,
  renderExtrasEditor,
}) {
  const name = pricingTab.slice("custom:".length);
  const tech = config.custom_techniques?.[name];
  if (!tech) {
    return (
      <div className="text-xs text-slate-500 italic py-4">
        This method no longer exists.
        <button
          onClick={() => setPricingTab("screen_print")}
          className="ml-2 text-teal-600 font-semibold hover:text-teal-700"
        >
          Back to Screen Print
        </button>
      </div>
    );
  }

  const techMaxC = tech.maxColors || maxColors;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-slate-500">
          Rates apply when an imprint's technique is set to <span className="font-semibold text-slate-700">{name}</span>. Fields with no value fall back to your Screen Print rates so a partial save still produces a quote.
        </p>
        <button
          onClick={() => {
            if (!window.confirm(`Remove "${name}"? Past quotes stay anchored to their saved values — only future imprints are affected.`)) return;
            setConfig(prev => {
              const next = { ...prev, custom_techniques: { ...(prev.custom_techniques || {}) } };
              delete next.custom_techniques[name];
              return next;
            });
            setPricingTab("screen_print");
          }}
          className="text-xs font-semibold text-red-400 hover:text-red-600 transition px-3 py-1.5 rounded-lg border border-red-100 hover:bg-red-50 whitespace-nowrap"
        >
          Remove {name}
        </button>
      </div>

      {/* Max Colors — same control as Screen Print, scoped to this tech */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <h4 className="text-xs font-bold text-slate-600 uppercase tracking-widest">Max Colors</h4>
          <div className="flex items-center gap-1">
            <button onClick={() => removeColorRow(name)} disabled={techMaxC <= 1}
              className="w-6 h-6 flex items-center justify-center text-xs font-bold border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-30">-</button>
            <span className="text-sm font-bold text-slate-700 w-6 text-center">{techMaxC}</span>
            <button onClick={() => addColorRow(name)}
              className="w-6 h-6 flex items-center justify-center text-xs font-bold border border-slate-200 rounded hover:bg-slate-50">+</button>
          </div>
        </div>
      </div>

      {renderPrintTable("firstPrint", `First ${name} Location (per piece)`, name)}
      {renderPrintTable("addlPrint",  `Additional ${name} Locations (per piece)`, name)}

      {/* Per-technique Extras — same editor as Screen Print + Embroidery. */}
      {renderExtrasEditor(name, {
        description: `Fees that only apply when an imprint's technique is ${name}. Toggle $ / % per fee.`,
      })}
    </div>
  );
}

// Setup Fees — per-screen multiplier list. Extracted verbatim from the
// Screen Print tab; reads/writes config.setupFees via setConfig.
export function SetupFeesEditor({ config, setConfig }) {
  return (
      <div className="border-t border-slate-100 dark:border-slate-700 pt-5 mt-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-bold text-slate-700 dark:text-slate-200">Setup Fees</div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Per-screen charges added to each quote (e.g. Screens, Film, Color Match). Each fee multiplies by the screen count. Linked artwork shared between line items only counts once. Editable per-quote.
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={!!config.setupFees?.enabled}
              onChange={(e) => setConfig(prev => ({
                ...prev,
                setupFees: { ...(prev.setupFees || {}), enabled: e.target.checked },
              }))}
              className="w-4 h-4 rounded border-slate-300 text-teal-600"
            />
            Enabled
          </label>
        </div>

        <div className={config.setupFees?.enabled ? "" : "opacity-50 pointer-events-none"}>
          {/* Column headers */}
          <div className="grid grid-cols-[1fr_120px_120px_32px] gap-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5 px-1">
            <div>Fee Name</div>
            <div>Per-Screen Rate</div>
            <div>Reorder Rate</div>
            <div />
          </div>

          {(config.setupFees?.items || []).map((fee, idx) => (
            <div key={fee.id || idx} className="grid grid-cols-[1fr_120px_120px_32px] gap-2 mb-2">
              <input
                type="text"
                value={fee.label || ""}
                onChange={(e) => setConfig(prev => {
                  const items = [...(prev.setupFees?.items || [])];
                  items[idx] = { ...items[idx], label: e.target.value };
                  return { ...prev, setupFees: { ...(prev.setupFees || {}), items } };
                })}
                placeholder="e.g. Screens"
                className="text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-300"
              />
              <div className="relative">
                <span className="absolute left-2 top-1.5 text-xs text-slate-500">$</span>
                <NumericInput
                  value={Number(fee.rate || 0)}
                  onChange={(v) => setConfig(prev => {
                    const items = [...(prev.setupFees?.items || [])];
                    items[idx] = { ...items[idx], rate: v };
                    return { ...prev, setupFees: { ...(prev.setupFees || {}), items } };
                  })}
                  min={0}
                  label={`${fee.label} per-screen rate`}
                  className="w-full text-xs border border-slate-200 rounded pl-5 pr-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-300"
                />
              </div>
              <div className="relative">
                <span className="absolute left-2 top-1.5 text-xs text-slate-500">$</span>
                <NumericInput
                  value={Number(fee.reorderRate || 0)}
                  onChange={(v) => setConfig(prev => {
                    const items = [...(prev.setupFees?.items || [])];
                    items[idx] = { ...items[idx], reorderRate: v };
                    return { ...prev, setupFees: { ...(prev.setupFees || {}), items } };
                  })}
                  min={0}
                  label={`${fee.label} reorder rate`}
                  className="w-full text-xs border border-slate-200 rounded pl-5 pr-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-300"
                />
              </div>
              <button
                type="button"
                onClick={() => setConfig(prev => {
                  const items = (prev.setupFees?.items || []).filter((_, i) => i !== idx);
                  return { ...prev, setupFees: { ...(prev.setupFees || {}), items } };
                })}
                title={`Remove ${fee.label || "fee"}`}
                className="text-slate-300 hover:text-red-500 transition flex items-center justify-center"
              >
                ×
              </button>
            </div>
          ))}

          <button
            type="button"
            onClick={() => setConfig(prev => {
              const items = [...(prev.setupFees?.items || [])];
              // Generate a unique id by combining a slug with a timestamp
              // suffix — labels can collide ("Color Match" twice) so the
              // id has to be the stable handle for skippedFeeIds.
              const id = `fee_${Date.now().toString(36)}`;
              items.push({ id, label: "New Fee", rate: 0, reorderRate: 0 });
              return { ...prev, setupFees: { ...(prev.setupFees || {}), items } };
            })}
            className="text-xs font-semibold text-teal-600 hover:text-teal-700 mt-1 transition"
          >
            + Add fee
          </button>

          <p className="text-[10px] text-slate-500 mt-3">
            Reorder rate is used when "Reorder" is checked on the quote — screens already exist from the first run, so film/burn can be skipped.
          </p>
        </div>
      </div>
  );
}
