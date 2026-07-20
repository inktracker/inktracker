import { useState } from "react";
import { base44 } from "@/api/supabaseClient";
import NumericInput from "@/components/shared/NumericInput";
import { notify } from "@/lib/notify";
import { BROKER_MARKUP_SHARE } from "@/components/shared/pricing";
import {
  sanitizeBrokerOverrides,
  brokerPricingMode,
  buildScaledSheet,
} from "@/lib/broker/brokerPricing";
import { DEFAULT_TIERS, DEFAULT_COLORS } from "@/components/account/pricingConfigDefaults";

// Per-broker pricing editor — shared between Account → Pricing
// (BrokerPricingSection) and the Admin tab's Broker Management cards
// (BrokerManager). One broker × one shop per instance; writes go to
// the broker_pricing table under the caller's shop scope (RLS: owner
// + manager).
//
// The toggle (Joe 2026-07-19: "flexible for how the shop wants to
// handle brokers"):
//   Markup percentage — the original model. The broker prices off the
//     shop sheet with a discount share; optionally a per-broker share
//     instead of the shop-wide default. No custom sheet.
//   Custom price sheet — this broker's own garment brackets + print
//     matrices, applied AS-IS (stored with brokerMarkupShare: 0 so the
//     brackets are exactly what the broker pays — no share discount
//     stacked on top).
//
// Only affects quotes the broker saves after the change — saved quotes
// are immutable snapshots.

function deepClone(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

// Build a complete color×tier grid from an override (preferred) or the
// shop's table, filling absent cells with 0 so the grid renders fully.
function seedGrid(ovTable, shopTable, rowKeys, colKeys) {
  const src = deepClone(ovTable || shopTable) || {};
  const out = {};
  for (const r of rowKeys) {
    out[r] = {};
    for (const c of colKeys) out[r][c] = src[r]?.[c] ?? 0;
  }
  return out;
}

function buildDraft(savedOverrides, shopConfig) {
  const ov = sanitizeBrokerOverrides(savedOverrides);
  const mode = brokerPricingMode(savedOverrides);
  const tiers = ov.tiers || shopConfig.tiers || DEFAULT_TIERS;
  const maxColors = ov.maxColors || shopConfig.maxColors || DEFAULT_COLORS;
  const colorRows = Array.from({ length: maxColors }, (_, i) => i + 1);

  // Embroidery (only when the shop offers it): rates + tier snapshot.
  const shopEmb = shopConfig.embroidery || {};
  const embQtyTiers = ov.embroidery?.qtyTiers || shopEmb.qtyTiers || [12, 24, 48, 72, 144];
  const embStitchTiers = ov.embroidery?.stitchTiers || shopEmb.stitchTiers || [];
  const embroidery = shopEmb.enabled
    ? {
        qtyTiers: embQtyTiers,
        stitchTiers: embStitchTiers,
        digitizingFee: ov.embroidery?.digitizingFee ?? (Number(shopEmb.digitizingFee) || 0),
        pricing: seedGrid(ov.embroidery?.pricing, shopEmb.pricing, embStitchTiers, embQtyTiers),
      }
    : null;

  // Custom techniques (DTG, DTF, …): one matrix pair per shop method.
  const customTechniques = {};
  for (const [name, shopTech] of Object.entries(shopConfig.custom_techniques || {})) {
    const ovTech = ov.custom_techniques?.[name];
    const tTiers = ovTech?.tiers || shopTech.tiers || tiers;
    const tMax = ovTech?.maxColors || shopTech.maxColors || maxColors;
    const tRows = Array.from({ length: tMax }, (_, i) => i + 1);
    customTechniques[name] = {
      tiers: tTiers,
      maxColors: tMax,
      firstPrint: seedGrid(ovTech?.firstPrint, shopTech.firstPrint, tRows, tTiers),
      addlPrint: seedGrid(ovTech?.addlPrint, shopTech.addlPrint, tRows, tTiers),
    };
  }

  return {
    mode,
    // markup mode: whether this broker has their own share (vs shop default)
    customShare: mode === "markup" && ov.brokerMarkupShare != null,
    share:
      mode === "markup" && ov.brokerMarkupShare != null
        ? ov.brokerMarkupShare
        : (shopConfig.brokerMarkupShare ?? BROKER_MARKUP_SHARE),
    garmentMarkup: deepClone(ov.garmentMarkup || shopConfig.garmentMarkup) || [],
    firstPrint: seedGrid(ov.firstPrint, shopConfig.firstPrint, colorRows, tiers),
    addlPrint: seedGrid(ov.addlPrint, shopConfig.addlPrint, colorRows, tiers),
    tiers,
    maxColors,
    embroidery,
    customTechniques,
  };
}

// Draft → persisted overrides. {} means "delete the row / pure default".
function draftToOverrides(draft) {
  if (draft.mode === "sheet") {
    return sanitizeBrokerOverrides({
      mode: "sheet",
      // Brackets apply exactly — no share discount stacked on top.
      brokerMarkupShare: 0,
      garmentMarkup: draft.garmentMarkup,
      firstPrint: draft.firstPrint,
      addlPrint: draft.addlPrint,
      // Snapshot the tier structure the matrices were authored against —
      // the engine picks the qty tier from config.tiers.
      tiers: draft.tiers,
      maxColors: draft.maxColors,
      // Every decoration method the shop offers rides on the sheet
      // (Joe 2026-07-19: "only works for printing?" — not anymore).
      embroidery: draft.embroidery
        ? {
            digitizingFee: draft.embroidery.digitizingFee,
            qtyTiers: draft.embroidery.qtyTiers,
            stitchTiers: draft.embroidery.stitchTiers,
            pricing: draft.embroidery.pricing,
          }
        : undefined,
      custom_techniques: Object.keys(draft.customTechniques || {}).length
        ? draft.customTechniques
        : undefined,
    });
  }
  if (!draft.customShare) return {};
  return sanitizeBrokerOverrides({ mode: "markup", brokerMarkupShare: draft.share });
}

function ModeButton({ active, onClick, title, sub }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 text-left border-2 rounded-xl px-3 py-2.5 transition ${
        active ? "border-teal-600 bg-teal-50" : "border-slate-200 hover:border-slate-300 bg-white"
      }`}
    >
      <div className={`text-xs font-bold ${active ? "text-teal-700" : "text-slate-700"}`}>{title}</div>
      <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>
    </button>
  );
}

// Generic rate-matrix grid. `rows` is [{ key, label }] so the same
// component serves color-count rows (Screen Print / custom methods)
// and stitch-tier rows (Embroidery).
function OverrideMatrix({ title, table, tiers, rows, rowHeader, onCell, inputCls }) {
  return (
    <div>
      <h5 className="text-[11px] font-bold text-slate-600 uppercase tracking-widest mb-1.5">{title}</h5>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500">
              <th className="text-left py-1 pr-2">{rowHeader}</th>
              {tiers.map((t) => (
                <th key={t} className="text-center py-1 font-semibold">{t}+</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="py-1 pr-2 font-semibold text-slate-600 whitespace-nowrap">{r.label}</td>
                {tiers.map((t) => (
                  <td key={t} className="py-1 px-0.5">
                    <NumericInput
                      value={table[r.key]?.[t]}
                      onChange={(n) => onCell(r.key, t, n)}
                      min={0}
                      max={10000}
                      label={`${title} ${r.label} × ${t} pcs`}
                      className={inputCls}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const colorRowsFor = (maxColors) =>
  Array.from({ length: maxColors }, (_, i) => ({ key: i + 1, label: `${i + 1} color${i > 0 ? "s" : ""}` }));

/**
 * @param broker      { email, label } — label is display-only
 * @param shopOwner   the shop scope the row is written under
 * @param shopConfig  that shop's live pricing_config (seeds the sheet)
 * @param existingRow the broker_pricing row for (shopOwner, broker), or null
 * @param onSaved     called with the new row (or null after a delete)
 */
export default function BrokerPricingEditor({ broker, shopOwner, shopConfig, existingRow, onSaved }) {
  const [draft, setDraft] = useState(() => buildDraft(existingRow?.overrides, shopConfig || {}));
  const [saving, setSaving] = useState(false);
  // "Quick price" (Joe 2026-07-20): one control that sets every cell of
  // the sheet to a % of the shop's standard rates. Always derives from
  // the STANDARD sheet (no compounding); cells stay editable after.
  const [quickPct, setQuickPct] = useState(90);

  function applyQuickScale() {
    const scaled = buildScaledSheet(shopConfig || {}, quickPct);
    setDraft((d) => ({
      ...d,
      garmentMarkup: scaled.garmentMarkup.length ? scaled.garmentMarkup : d.garmentMarkup,
      firstPrint: scaled.firstPrint,
      addlPrint: scaled.addlPrint,
      tiers: scaled.tiers,
      maxColors: scaled.maxColors,
      embroidery: d.embroidery && scaled.embroidery ? scaled.embroidery : d.embroidery,
      customTechniques: Object.keys(scaled.customTechniques).length ? scaled.customTechniques : d.customTechniques,
    }));
  }

  const inputCls = "w-full text-xs text-center border border-slate-200 rounded px-1 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-300";
  const shopSharePct = Math.round(((shopConfig?.brokerMarkupShare ?? BROKER_MARKUP_SHARE)) * 100);

  async function handleSave(forcedOverrides) {
    const overrides = forcedOverrides ?? draftToOverrides(draft);
    const isDefault = Object.keys(overrides).length === 0;
    setSaving(true);
    try {
      let nextRow = null;
      if (isDefault) {
        if (existingRow?.id) await base44.entities.BrokerPricingOverride.delete(existingRow.id);
      } else if (existingRow?.id) {
        nextRow = await base44.entities.BrokerPricingOverride.update(existingRow.id, { overrides });
      } else {
        nextRow = await base44.entities.BrokerPricingOverride.create({
          shop_owner: shopOwner,
          broker_email: (broker.email || "").toLowerCase(),
          overrides,
        });
      }
      notify.success(
        "Broker pricing saved",
        isDefault
          ? `${broker.label} is back on your standard broker terms.`
          : draft.mode === "sheet"
            ? `${broker.label} now prices off their own sheet.`
            : `${broker.label} now gets a ${Math.round(draft.share * 100)}% markup share.`
      );
      onSaved?.(nextRow);
    } catch (err) {
      notify.error("Couldn't save broker pricing", err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* The mode toggle */}
      <div className="flex gap-2">
        <ModeButton
          active={draft.mode === "markup"}
          onClick={() => setDraft((d) => ({ ...d, mode: "markup" }))}
          title="Markup percentage"
          sub="Your pricing sheet with a broker discount share"
        />
        <ModeButton
          active={draft.mode === "sheet"}
          onClick={() => setDraft((d) => ({ ...d, mode: "sheet" }))}
          title="Custom price sheet"
          sub="This broker's own garment + print rates, applied as-is"
        />
      </div>

      {draft.mode === "markup" && (
        <div className="space-y-2">
          <label className="flex items-start gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={draft.customShare}
              onChange={(e) => setDraft((d) => ({ ...d, customShare: e.target.checked }))}
              className="w-4 h-4 mt-0.5 rounded border-slate-300 text-teal-600"
            />
            <span className="text-xs">
              <span className="font-semibold text-slate-700">Custom share for this broker</span>
              <span className="text-slate-500"> — unchecked uses your shop-wide {shopSharePct}%</span>
            </span>
          </label>
          {draft.customShare && (
            <div className="flex items-center gap-2 pl-6">
              <div className="relative w-24">
                <NumericInput
                  value={Math.round((draft.share ?? 0) * 100)}
                  onChange={(pct) => setDraft((d) => ({ ...d, share: (pct || 0) / 100 }))}
                  min={0}
                  max={100}
                  integer
                  label={`${broker.label} markup share %`}
                  className={inputCls}
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-slate-500 pointer-events-none">%</span>
              </div>
              <span className="text-[10px] text-slate-500">off garment markup for this broker</span>
            </div>
          )}
        </div>
      )}

      {draft.mode === "sheet" && (
        <div className="space-y-3">
          {/* Quick price — scale everything at once, then fine-tune. */}
          <div className="border border-teal-200 bg-teal-50/50 rounded-xl p-3">
            <div className="flex items-center justify-between gap-3 mb-1.5">
              <span className="text-[11px] font-bold text-slate-600 uppercase tracking-widest">Quick Price</span>
              <span className="text-[10px] text-slate-500">optional — cells below stay individually editable</span>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <input
                type="range"
                min={50}
                max={110}
                step={1}
                value={Math.min(110, Math.max(50, quickPct))}
                onChange={(e) => setQuickPct(Number(e.target.value))}
                aria-label="Quick price percent of standard rates"
                className="flex-1 min-w-[140px] accent-teal-600"
              />
              <div className="relative w-20">
                <NumericInput
                  value={quickPct}
                  onChange={(n) => setQuickPct(Math.min(200, Math.max(1, Math.round(Number(n) || 0))))}
                  min={1}
                  max={200}
                  integer
                  label="Quick price percent"
                  className={inputCls}
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-slate-500 pointer-events-none">%</span>
              </div>
              <button
                type="button"
                onClick={applyQuickScale}
                className="bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition"
              >
                Apply {quickPct}% of standard
              </button>
            </div>
            <p className="text-[10px] text-slate-500 mt-1.5">
              Fills every rate below with {quickPct}% of your current standard sheet (garment markup
              scales its margin: a 40% markup becomes {Math.round(40 * quickPct) / 100}%). Applying
              replaces the rates below — always from your standard sheet, so re-applying never compounds.
            </p>
          </div>

          <div>
            <h5 className="text-[11px] font-bold text-slate-600 uppercase tracking-widest mb-1.5">
              Garment Markup (what this broker pays over wholesale cost)
            </h5>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(draft.garmentMarkup || []).map((tier, i) => (
                <div key={i} className="border border-slate-200 rounded-lg p-2">
                  <label className="text-[10px] text-slate-500 block mb-1">
                    {tier.above > 0 ? `Above $${tier.above}` : "Default"}
                  </label>
                  <div className="relative">
                    <NumericInput
                      value={Math.round(((tier.markup || 1) - 1) * 100)}
                      onChange={(pct) => setDraft((d) => {
                        const m = [...d.garmentMarkup];
                        m[i] = { ...m[i], markup: (pct || 0) / 100 + 1 };
                        return { ...d, garmentMarkup: m };
                      })}
                      min={0}
                      max={1000}
                      integer
                      label={`${broker.label} markup tier ${i + 1} %`}
                      className={inputCls}
                    />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-slate-500 pointer-events-none">%</span>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-slate-500 mt-1">
              Applied exactly — the broker discount share does not stack on top of these.
            </p>
          </div>

          <OverrideMatrix
            title="Screen Print — First Location (per piece)"
            table={draft.firstPrint}
            tiers={draft.tiers}
            rows={colorRowsFor(draft.maxColors)}
            rowHeader="Colors"
            inputCls={inputCls}
            onCell={(c, t, n) => setDraft((d) => ({
              ...d,
              firstPrint: { ...d.firstPrint, [c]: { ...(d.firstPrint[c] || {}), [t]: n } },
            }))}
          />
          <OverrideMatrix
            title="Screen Print — Additional Locations (per piece)"
            table={draft.addlPrint}
            tiers={draft.tiers}
            rows={colorRowsFor(draft.maxColors)}
            rowHeader="Colors"
            inputCls={inputCls}
            onCell={(c, t, n) => setDraft((d) => ({
              ...d,
              addlPrint: { ...d.addlPrint, [c]: { ...(d.addlPrint[c] || {}), [t]: n } },
            }))}
          />

          {/* Embroidery — shown when the shop offers it. Rates +
              digitizing fee only; enable state and add-on fees keep
              inheriting from the shop sheet. */}
          {draft.embroidery && (
            <div className="space-y-2 pt-1">
              <OverrideMatrix
                title="Embroidery (per piece)"
                table={draft.embroidery.pricing}
                tiers={draft.embroidery.qtyTiers}
                rows={draft.embroidery.stitchTiers.map((s) => ({ key: s, label: s }))}
                rowHeader="Stitches"
                inputCls={inputCls}
                onCell={(s, t, n) => setDraft((d) => ({
                  ...d,
                  embroidery: {
                    ...d.embroidery,
                    pricing: { ...d.embroidery.pricing, [s]: { ...(d.embroidery.pricing[s] || {}), [t]: n } },
                  },
                }))}
              />
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-slate-600 uppercase tracking-widest">Digitizing Fee</span>
                <div className="relative w-24">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-slate-500 pointer-events-none">$</span>
                  <NumericInput
                    value={draft.embroidery.digitizingFee}
                    onChange={(n) => setDraft((d) => ({
                      ...d,
                      embroidery: { ...d.embroidery, digitizingFee: Math.max(0, Number(n) || 0) },
                    }))}
                    min={0}
                    max={10000}
                    label={`${broker.label} digitizing fee`}
                    className={`${inputCls} pl-5`}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Custom decoration methods (DTG, DTF, …) — one matrix pair
              per method the shop has configured. */}
          {Object.entries(draft.customTechniques || {}).map(([name, tech]) => (
            <div key={name} className="space-y-3 pt-1">
              <OverrideMatrix
                title={`${name} — First Location (per piece)`}
                table={tech.firstPrint}
                tiers={tech.tiers}
                rows={colorRowsFor(tech.maxColors)}
                rowHeader="Colors"
                inputCls={inputCls}
                onCell={(c, t, n) => setDraft((d) => ({
                  ...d,
                  customTechniques: {
                    ...d.customTechniques,
                    [name]: {
                      ...d.customTechniques[name],
                      firstPrint: { ...tech.firstPrint, [c]: { ...(tech.firstPrint[c] || {}), [t]: n } },
                    },
                  },
                }))}
              />
              <OverrideMatrix
                title={`${name} — Additional Locations (per piece)`}
                table={tech.addlPrint}
                tiers={tech.tiers}
                rows={colorRowsFor(tech.maxColors)}
                rowHeader="Colors"
                inputCls={inputCls}
                onCell={(c, t, n) => setDraft((d) => ({
                  ...d,
                  customTechniques: {
                    ...d.customTechniques,
                    [name]: {
                      ...d.customTechniques[name],
                      addlPrint: { ...tech.addlPrint, [c]: { ...(tech.addlPrint[c] || {}), [t]: n } },
                    },
                  },
                }))}
              />
            </div>
          ))}

          <p className="text-[10px] text-slate-500">
            The sheet covers every decoration method your shop offers, seeded from your
            current rates. Quantity tiers are copied as of now; add-on fees and which
            methods are offered always follow your standard sheet.
          </p>
        </div>
      )}

      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={() => handleSave()}
          disabled={saving}
          className="bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save Broker Pricing"}
        </button>
        {existingRow && (
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`Remove all custom pricing for ${broker.label}? They go back to your standard broker terms.`)) {
                handleSave({});
              }
            }}
            disabled={saving}
            className="text-xs text-slate-500 hover:text-red-600 font-semibold"
          >
            Remove overrides
          </button>
        )}
      </div>
    </div>
  );
}
