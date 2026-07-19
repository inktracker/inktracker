import { useState } from "react";
import { base44 } from "@/api/supabaseClient";
import NumericInput from "@/components/shared/NumericInput";
import { notify } from "@/lib/notify";
import { BROKER_MARKUP_SHARE } from "@/components/shared/pricing";
import {
  sanitizeBrokerOverrides,
  brokerPricingMode,
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

function buildDraft(savedOverrides, shopConfig) {
  const ov = sanitizeBrokerOverrides(savedOverrides);
  const mode = brokerPricingMode(savedOverrides);
  const tiers = ov.tiers || shopConfig.tiers || DEFAULT_TIERS;
  const maxColors = ov.maxColors || shopConfig.maxColors || DEFAULT_COLORS;
  const seedTable = (key) => {
    if (ov[key]) return deepClone(ov[key]);
    const src = deepClone(shopConfig[key]) || {};
    const out = {};
    for (let c = 1; c <= maxColors; c++) {
      out[c] = {};
      for (const t of tiers) out[c][t] = src[c]?.[t] ?? 0;
    }
    return out;
  };
  return {
    mode,
    // markup mode: whether this broker has their own share (vs shop default)
    customShare: mode === "markup" && ov.brokerMarkupShare != null,
    share:
      mode === "markup" && ov.brokerMarkupShare != null
        ? ov.brokerMarkupShare
        : (shopConfig.brokerMarkupShare ?? BROKER_MARKUP_SHARE),
    garmentMarkup: deepClone(ov.garmentMarkup || shopConfig.garmentMarkup) || [],
    firstPrint: seedTable("firstPrint"),
    addlPrint: seedTable("addlPrint"),
    tiers,
    maxColors,
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

function OverrideMatrix({ title, table, tiers, maxColors, onCell, inputCls }) {
  const rows = Array.from({ length: maxColors }, (_, i) => i + 1);
  return (
    <div>
      <h5 className="text-[11px] font-bold text-slate-600 uppercase tracking-widest mb-1.5">{title}</h5>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500">
              <th className="text-left py-1 pr-2">Colors</th>
              {tiers.map((t) => (
                <th key={t} className="text-center py-1 font-semibold">{t}+</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c}>
                <td className="py-1 pr-2 font-semibold text-slate-600 whitespace-nowrap">{c} color{c > 1 ? "s" : ""}</td>
                {tiers.map((t) => (
                  <td key={t} className="py-1 px-0.5">
                    <NumericInput
                      value={table[c]?.[t]}
                      onChange={(n) => onCell(c, t, n)}
                      min={0}
                      max={10000}
                      label={`${title} ${c} color × ${t} pcs`}
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
            title="First Print Location (per piece)"
            table={draft.firstPrint}
            tiers={draft.tiers}
            maxColors={draft.maxColors}
            inputCls={inputCls}
            onCell={(c, t, n) => setDraft((d) => ({
              ...d,
              firstPrint: { ...d.firstPrint, [c]: { ...(d.firstPrint[c] || {}), [t]: n } },
            }))}
          />
          <OverrideMatrix
            title="Additional Print Locations (per piece)"
            table={draft.addlPrint}
            tiers={draft.tiers}
            maxColors={draft.maxColors}
            inputCls={inputCls}
            onCell={(c, t, n) => setDraft((d) => ({
              ...d,
              addlPrint: { ...d.addlPrint, [c]: { ...(d.addlPrint[c] || {}), [t]: n } },
            }))}
          />
          <p className="text-[10px] text-slate-500">
            Quantity tiers are copied from your sheet as of now; embroidery and custom
            methods always follow your standard pricing.
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
