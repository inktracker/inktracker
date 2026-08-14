import { useState, useEffect, useMemo, useCallback } from "react";
import { useAuth } from "@/lib/AuthContext";
import { shopScope } from "@/lib/shopScope";
import { notify } from "@/lib/notify";
import NumericInput from "@/components/shared/NumericInput";
import { getShopPricingConfig } from "@/components/shared/pricing";
import { fmtMoney } from "../shared/pricing";
import { buildScaledSheet } from "@/lib/broker/brokerPricing";
import { DEFAULT_TIERS, DEFAULT_COLORS } from "@/components/account/pricingConfigDefaults";
import { listPartnerships, activePartners } from "@/lib/partners";
import {
  tradeConfigFromDraft,
  computeTradeTotal,
  getMyTradeSheet,
  savePartnerTradeSheet,
  DEFAULT_PARTNER,
} from "@/lib/partnerTradeSheet";
import { Tag, Loader2 } from "lucide-react";

// Account → Partners: publish YOUR trade rates. Same flexibility as broker
// pricing (docs/shop-partnerships-design.md, Phase 2a) — a DEFAULT sheet for
// all partners plus per-partner overrides, with full per-cell matrices across
// every decoration method. "Here's my partner rate" instead of "my broker
// rate". Decoration-only unless YOU supply the blanks (then garment markup
// rides along). Pricing reuses the real engine — no forked math.
const SAMPLE_QTY = 50;
const inputCls = "w-full text-xs text-center border border-slate-200 rounded px-1 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-300";

function deepClone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

function seedGrid(savedTable, shopTable, rowKeys, colKeys) {
  const src = deepClone(savedTable || shopTable) || {};
  const out = {};
  for (const r of rowKeys) {
    out[r] = {};
    for (const c of colKeys) out[r][c] = src[r]?.[c] ?? 0;
  }
  return out;
}

// Seed an editor draft from a saved sheet (resolved config) or, first time,
// from the shop's own standard rates.
function buildDraft(saved, shopConfig) {
  const s = saved && Object.keys(saved).length ? saved : null;
  const tiers = s?.tiers || shopConfig.tiers || DEFAULT_TIERS;
  const maxColors = s?.maxColors || shopConfig.maxColors || DEFAULT_COLORS;
  const colorRows = Array.from({ length: maxColors }, (_, i) => i + 1);

  const shopEmb = shopConfig.embroidery || {};
  const sEmb = s?.embroidery;
  const embQtyTiers = sEmb?.qtyTiers || shopEmb.qtyTiers || [12, 24, 48, 72, 144];
  const embStitchTiers = sEmb?.stitchTiers || shopEmb.stitchTiers || [];
  const embroidery = shopEmb.enabled
    ? {
        qtyTiers: embQtyTiers,
        stitchTiers: embStitchTiers,
        digitizingFee: sEmb?.digitizingFee ?? (Number(shopEmb.digitizingFee) || 0),
        pricing: seedGrid(sEmb?.pricing, shopEmb.pricing, embStitchTiers, embQtyTiers),
      }
    : null;

  const customTechniques = {};
  for (const [name, shopTech] of Object.entries(shopConfig.custom_techniques || {})) {
    const sTech = s?.custom_techniques?.[name];
    const tTiers = sTech?.tiers || shopTech.tiers || tiers;
    const tMax = sTech?.maxColors || shopTech.maxColors || maxColors;
    const tRows = Array.from({ length: tMax }, (_, i) => i + 1);
    customTechniques[name] = {
      tiers: tTiers,
      maxColors: tMax,
      firstPrint: seedGrid(sTech?.firstPrint, shopTech.firstPrint, tRows, tTiers),
      addlPrint: seedGrid(sTech?.addlPrint, shopTech.addlPrint, tRows, tTiers),
    };
  }

  return {
    garmentMarkup: deepClone(s?.garmentMarkup || shopConfig.garmentMarkup) || [],
    firstPrint: seedGrid(s?.firstPrint, shopConfig.firstPrint, colorRows, tiers),
    addlPrint: seedGrid(s?.addlPrint, shopConfig.addlPrint, colorRows, tiers),
    tiers,
    maxColors,
    embroidery,
    customTechniques,
  };
}

const colorRowsFor = (maxColors) =>
  Array.from({ length: maxColors }, (_, i) => ({ key: i + 1, label: `${i + 1} color${i > 0 ? "s" : ""}` }));

function RateMatrix({ title, table, tiers, rows, rowHeader, onCell }) {
  return (
    <div>
      <h5 className="text-[11px] font-bold text-slate-600 uppercase tracking-widest mb-1.5">{title}</h5>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500">
              <th className="text-left py-1 pr-2">{rowHeader}</th>
              {tiers.map((t) => <th key={t} className="text-center py-1 font-semibold">{t}+</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="py-1 pr-2 font-semibold text-slate-600 whitespace-nowrap">{r.label}</td>
                {tiers.map((t) => (
                  <td key={t} className="py-1 px-0.5">
                    <NumericInput value={table[r.key]?.[t]} onChange={(n) => onCell(r.key, t, n)}
                      min={0} max={10000} label={`${title} ${r.label} × ${t} pcs`} className={inputCls} />
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

export default function PartnerTradeSheetEditor() {
  const { user } = useAuth();
  const myShop = shopScope(user);
  const shopConfig = getShopPricingConfig();

  const [partners, setPartners] = useState([]);
  const [selectedPartner, setSelectedPartner] = useState(DEFAULT_PARTNER);
  const [draft, setDraft] = useState(() => (shopConfig ? buildDraft(null, shopConfig) : null));
  const [receiverSupplies, setReceiverSupplies] = useState(false);
  const [quickPct, setQuickPct] = useState(75);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const links = await listPartnerships();
        setPartners(activePartners(links, myShop));
      } catch { /* no partners */ }
    })();
  }, [myShop]);

  // Load the selected sheet (specific partner or the '*' default).
  useEffect(() => {
    if (!shopConfig) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      let row = null;
      try { row = await getMyTradeSheet(myShop, selectedPartner); } catch { /* first-time */ }
      if (cancelled) return;
      setDraft(buildDraft(row?.config, shopConfig));
      setReceiverSupplies(!!row?.config?.receiver_supplies_garments);
      setQuickPct(row?.scale_pct != null ? Number(row.scale_pct) : 75);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [myShop, selectedPartner, shopConfig]);

  const handleQuickPct = useCallback((next) => {
    const pct = Math.min(200, Math.max(0, Math.round(Number(next) || 0)));
    setQuickPct(pct);
    const scaled = buildScaledSheet(shopConfig || {}, pct);
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
  }, [shopConfig]);

  const previewConfig = useMemo(
    () => (draft ? tradeConfigFromDraft(draft, shopConfig, receiverSupplies) : null),
    [draft, shopConfig, receiverSupplies],
  );

  const samples = useMemo(() => {
    if (!previewConfig) return [];
    const out = [];
    const perPiece = (line) => computeTradeTotal([line], previewConfig) / SAMPLE_QTY;
    const g = receiverSupplies ? 8 : 0; // sample blank cost when the receiver supplies
    if (shopConfig?.embroidery?.enabled) {
      out.push({ label: "Embroidery (mid stitch tier)", pp: perPiece({ sizes: { OS: SAMPLE_QTY }, garmentCost: g, imprints: [{ technique: "Embroidery", colors: 2 }] }) });
    }
    out.push({ label: "Screen print, 1 color", pp: perPiece({ sizes: { OS: SAMPLE_QTY }, garmentCost: g, imprints: [{ technique: "Screen Print", colors: 1 }] }) });
    for (const tech of Object.keys(shopConfig?.custom_techniques || {})) {
      out.push({ label: `${tech}, 1 color`, pp: perPiece({ sizes: { OS: SAMPLE_QTY }, garmentCost: g, imprints: [{ technique: tech, colors: 1 }] }) });
    }
    return out;
  }, [previewConfig, shopConfig, receiverSupplies]);

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const config = tradeConfigFromDraft(draft, shopConfig, receiverSupplies);
      await savePartnerTradeSheet(myShop, selectedPartner, quickPct, config);
      const who = selectedPartner === DEFAULT_PARTNER ? "all partners" : selectedPartner;
      notify.success("Trade rates saved", `Rates for ${who} are live — they auto-fill when you're sent a job.`);
    } catch (err) {
      notify.error("Couldn't save your trade rates", err);
    } finally {
      setSaving(false);
    }
  };

  if (!shopConfig) {
    return (
      <div className="border-t border-slate-200 dark:border-slate-700 pt-4 mt-2">
        <p className="text-xs text-slate-400">Set up your pricing first to publish partner trade rates.</p>
      </div>
    );
  }

  const setCell = (key) => (c, t, n) =>
    setDraft((d) => ({ ...d, [key]: { ...d[key], [c]: { ...(d[key][c] || {}), [t]: n } } }));

  return (
    <div className="border-t border-slate-200 dark:border-slate-700 pt-4 mt-2 space-y-3">
      <div className="flex items-center gap-2">
        <Tag className="w-4 h-4 text-teal-600" />
        <h4 className="font-bold text-slate-900 dark:text-slate-100 text-sm">Your trade rates for partners</h4>
      </div>
      <p className="text-xs text-slate-500 leading-relaxed">
        What partners pay when they send you work — the same per-cell control brokers get, across
        every decoration method. Auto-fills the trade price on jobs sent to you; you still confirm
        each by accepting.
      </p>

      {/* Which partner these rates apply to */}
      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-xs font-semibold text-slate-500">Rates for:</label>
        <select value={selectedPartner} onChange={(e) => setSelectedPartner(e.target.value)}
          className="text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-900">
          <option value={DEFAULT_PARTNER}>All partners (default)</option>
          {partners.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {/* Who supplies the blanks */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className="font-semibold text-slate-500">Who supplies the garments?</span>
        <div className="flex gap-1">
          <button type="button" onClick={() => setReceiverSupplies(false)}
            className={`px-2.5 py-1 rounded-lg border font-semibold ${!receiverSupplies ? "border-teal-600 bg-teal-50 text-teal-700" : "border-slate-200 text-slate-500"}`}>
            The sending shop
          </button>
          <button type="button"
            onClick={() => {
              setReceiverSupplies(true);
              // Ensure an editable markup bracket exists even if the shop never
              // set garment brackets (else the grid would be empty & invisible).
              setDraft((d) => (d && (d.garmentMarkup || []).length ? d : { ...d, garmentMarkup: [{ above: 0, markup: 1.4 }] }));
            }}
            className={`px-2.5 py-1 rounded-lg border font-semibold ${receiverSupplies ? "border-teal-600 bg-teal-50 text-teal-700" : "border-slate-200 text-slate-500"}`}>
            I supply the blanks
          </button>
        </div>
      </div>

      {loading || !draft ? (
        <div className="text-xs text-slate-400">Loading…</div>
      ) : (
        <>
          {/* Quick Price seed */}
          <div className="border border-teal-200 bg-teal-50/50 rounded-xl p-3">
            <div className="flex items-center justify-between gap-3 mb-1.5">
              <span className="text-[11px] font-bold text-slate-600 uppercase tracking-widest">Quick Price</span>
              <span className="text-[10px] text-slate-500">optional — cells stay editable</span>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <input type="range" min={0} max={100} step={1} value={Math.min(100, Math.max(0, quickPct))}
                onChange={(e) => handleQuickPct(e.target.value)} aria-label="Quick price percent"
                className="flex-1 min-w-[140px] accent-teal-600" />
              <span className="text-sm font-bold text-teal-700 w-14 text-right">{quickPct}%</span>
              <span className="text-xs text-slate-500 whitespace-nowrap">of my standard rates</span>
            </div>
          </div>

          {receiverSupplies && (draft.garmentMarkup || []).length > 0 && (
            <div>
              <h5 className="text-[11px] font-bold text-slate-600 uppercase tracking-widest mb-1.5">Garment markup (over your blank cost)</h5>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(draft.garmentMarkup || []).map((tier, i) => (
                  <div key={i} className="border border-slate-200 rounded-lg p-2">
                    <label className="text-[10px] text-slate-500 block mb-1">{tier.above > 0 ? `Above $${tier.above}` : "Default"}</label>
                    <div className="relative">
                      <NumericInput value={Math.round(((tier.markup || 1) - 1) * 100)}
                        onChange={(pct) => setDraft((d) => { const m = [...d.garmentMarkup]; m[i] = { ...m[i], markup: (pct || 0) / 100 + 1 }; return { ...d, garmentMarkup: m }; })}
                        min={0} max={1000} integer label={`markup tier ${i + 1} %`} className={inputCls} />
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-slate-500 pointer-events-none">%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <RateMatrix title="Screen Print — First Location (per piece)" table={draft.firstPrint} tiers={draft.tiers}
            rows={colorRowsFor(draft.maxColors)} rowHeader="Colors" onCell={setCell("firstPrint")} />
          <RateMatrix title="Screen Print — Additional Locations (per piece)" table={draft.addlPrint} tiers={draft.tiers}
            rows={colorRowsFor(draft.maxColors)} rowHeader="Colors" onCell={setCell("addlPrint")} />

          {draft.embroidery && (
            <div className="space-y-2 pt-1">
              <RateMatrix title="Embroidery (per piece)" table={draft.embroidery.pricing} tiers={draft.embroidery.qtyTiers}
                rows={draft.embroidery.stitchTiers.map((s) => ({ key: s, label: s }))} rowHeader="Stitches"
                onCell={(s, t, n) => setDraft((d) => ({ ...d, embroidery: { ...d.embroidery, pricing: { ...d.embroidery.pricing, [s]: { ...(d.embroidery.pricing[s] || {}), [t]: n } } } }))} />
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-slate-600 uppercase tracking-widest">Digitizing Fee</span>
                <div className="relative w-24">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-slate-500 pointer-events-none">$</span>
                  <NumericInput value={draft.embroidery.digitizingFee}
                    onChange={(n) => setDraft((d) => ({ ...d, embroidery: { ...d.embroidery, digitizingFee: Math.max(0, Number(n) || 0) } }))}
                    min={0} max={10000} label="digitizing fee" className={`${inputCls} pl-5`} />
                </div>
              </div>
            </div>
          )}

          {Object.entries(draft.customTechniques || {}).map(([name, tech]) => (
            <div key={name} className="space-y-3 pt-1">
              <RateMatrix title={`${name} — First Location (per piece)`} table={tech.firstPrint} tiers={tech.tiers}
                rows={colorRowsFor(tech.maxColors)} rowHeader="Colors"
                onCell={(c, t, n) => setDraft((d) => ({ ...d, customTechniques: { ...d.customTechniques, [name]: { ...d.customTechniques[name], firstPrint: { ...tech.firstPrint, [c]: { ...(tech.firstPrint[c] || {}), [t]: n } } } } }))} />
              <RateMatrix title={`${name} — Additional Locations (per piece)`} table={tech.addlPrint} tiers={tech.tiers}
                rows={colorRowsFor(tech.maxColors)} rowHeader="Colors"
                onCell={(c, t, n) => setDraft((d) => ({ ...d, customTechniques: { ...d.customTechniques, [name]: { ...d.customTechniques[name], addlPrint: { ...tech.addlPrint, [c]: { ...(tech.addlPrint[c] || {}), [t]: n } } } } }))} />
            </div>
          ))}

          {samples.length > 0 && (
            <div className="bg-slate-50 dark:bg-slate-800 rounded-xl px-3 py-2 space-y-1">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Sample per-piece ({SAMPLE_QTY} pcs{receiverSupplies ? ", incl. a sample blank" : ", decoration only"})
              </div>
              {samples.map((s) => (
                <div key={s.label} className="flex items-center justify-between text-xs">
                  <span className="text-slate-600 dark:text-slate-300">{s.label}</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-100">{fmtMoney(s.pp)}/pc</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end">
            <button onClick={handleSave} disabled={saving}
              className="px-4 py-2 text-sm font-bold bg-teal-600 hover:bg-teal-700 text-white rounded-xl transition disabled:opacity-50 flex items-center gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save trade rates"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
