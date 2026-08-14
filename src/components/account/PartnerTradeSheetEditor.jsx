import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/AuthContext";
import { shopScope } from "@/lib/shopScope";
import { notify } from "@/lib/notify";
import { getShopPricingConfig } from "@/components/shared/pricing";
import { fmtMoney } from "../shared/pricing";
import {
  buildTradeSheetConfig,
  computeTradeTotal,
  getMyTradeSheet,
  savePartnerTradeSheet,
} from "@/lib/partnerTradeSheet";
import { Tag, Loader2 } from "lucide-react";

// Account → Partners: publish YOUR trade rates. When a partner sends you a
// job, its trade price auto-fills from this (docs/shop-partnerships-design.md,
// Phase 2). v1 is one control — a % of your own standard decoration rates —
// so "partners pay 75% of my rates" is one move; the preview reprices real
// sample jobs live through the same engine your quotes use.
const SAMPLE_QTY = 50;

export default function PartnerTradeSheetEditor() {
  const { user } = useAuth();
  const myShop = shopScope(user);
  const shopConfig = getShopPricingConfig();
  const [scale, setScale] = useState(75);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const row = await getMyTradeSheet(myShop);
        if (row?.scale_pct != null) setScale(Number(row.scale_pct));
      } catch { /* first-time: keep default */ }
      setLoaded(true);
    })();
  }, [myShop]);

  const tradeConfig = useMemo(
    () => (shopConfig ? buildTradeSheetConfig(shopConfig, scale) : null),
    [shopConfig, scale],
  );

  // Representative per-piece trade prices at the current scale, for the
  // methods this shop actually offers.
  const samples = useMemo(() => {
    if (!tradeConfig) return [];
    const out = [];
    const perPiece = (line) => computeTradeTotal([line], tradeConfig) / SAMPLE_QTY;
    if (shopConfig?.embroidery?.enabled) {
      out.push({
        label: "Embroidery (mid stitch tier)",
        pp: perPiece({ sizes: { OS: SAMPLE_QTY }, imprints: [{ technique: "Embroidery", colors: 2 }] }),
      });
    }
    out.push({
      label: "Screen print, 1 color",
      pp: perPiece({ sizes: { OS: SAMPLE_QTY }, imprints: [{ technique: "Screen Print", colors: 1 }] }),
    });
    for (const tech of Object.keys(shopConfig?.custom_techniques || {})) {
      out.push({
        label: `${tech}, 1 color`,
        pp: perPiece({ sizes: { OS: SAMPLE_QTY }, imprints: [{ technique: tech, colors: 1 }] }),
      });
    }
    return out;
  }, [tradeConfig, shopConfig]);

  const handleSave = async () => {
    if (!tradeConfig) return;
    setSaving(true);
    try {
      await savePartnerTradeSheet(myShop, scale, tradeConfig);
      notify.success("Trade rates saved", "Partners now see this price when you're sent a job.");
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

  return (
    <div className="border-t border-slate-200 dark:border-slate-700 pt-4 mt-2 space-y-3">
      <div className="flex items-center gap-2">
        <Tag className="w-4 h-4 text-teal-600" />
        <h4 className="font-bold text-slate-900 dark:text-slate-100 text-sm">Your trade rates for partners</h4>
      </div>
      <p className="text-xs text-slate-500 leading-relaxed">
        What partners pay when they send you work, as a share of your own standard
        decoration rates. Auto-fills the trade price on jobs sent to you — you still
        confirm each one by accepting it.
      </p>

      <div className="flex items-center gap-3">
        <input
          type="range" min="0" max="100" step="5" value={scale}
          onChange={(e) => setScale(Number(e.target.value))}
          disabled={!loaded}
          className="flex-1 accent-teal-600"
        />
        <span className="text-sm font-bold text-teal-700 w-14 text-right">{scale}%</span>
      </div>

      {samples.length > 0 && (
        <div className="bg-slate-50 dark:bg-slate-800 rounded-xl px-3 py-2 space-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            At {scale}% · sample per-piece ({SAMPLE_QTY} pcs)
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
        <button
          onClick={handleSave} disabled={saving || !loaded}
          className="px-4 py-2 text-sm font-bold bg-teal-600 hover:bg-teal-700 text-white rounded-xl transition disabled:opacity-50 flex items-center gap-2"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save trade rates"}
        </button>
      </div>
    </div>
  );
}
