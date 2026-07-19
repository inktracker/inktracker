import { useEffect, useState } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import NumericInput from "@/components/shared/NumericInput";
import { notify } from "@/lib/notify";
import { shopScope } from "@/lib/shopScope";
import { BROKER_MARKUP_SHARE } from "@/components/shared/pricing";
import { sanitizeBrokerOverrides, hasBrokerOverrides } from "@/lib/broker/brokerPricing";
import { DEFAULT_TIERS, DEFAULT_COLORS } from "./pricingConfigDefaults";

// Account → Pricing → Per-Broker Pricing. Lets the shop give an
// individual broker their own wholesale terms as an OVERLAY on the shop
// sheet: any section left un-overridden keeps inheriting the live shop
// pricing. Stored in the broker_pricing table (never inside
// shops.pricing_config — that blob ships to the anonymous public
// wizard via getPublicShopConfig, and broker wholesale terms must not).
//
// Only affects quotes the broker saves AFTER the change — saved quotes
// are immutable snapshots (Quote Snapshot Invariant).
//
// Note: the broker list read relies on the profiles_select_team RLS
// policy, which matches on the OWNER's email inside the broker's
// assigned_shops — so a manager viewing this section sees an empty
// list. The overrides table itself is manager-writable (see migration).

function deepClone(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

function brokerLabel(b) {
  return b.company_name || b.full_name || b.email;
}

// Build the editor draft for one broker from their saved overrides row
// (or a blank inherit-everything draft), seeding disabled sections from
// the shop's current sheet so toggling a section on starts from the
// numbers the broker already effectively has.
function buildDraft(savedOverrides, shopConfig) {
  const ov = sanitizeBrokerOverrides(savedOverrides);
  const tiers = ov.tiers || shopConfig.tiers || DEFAULT_TIERS;
  const maxColors = ov.maxColors || shopConfig.maxColors || DEFAULT_COLORS;
  const seedTable = (key) => {
    if (ov[key]) return deepClone(ov[key]);
    const src = deepClone(shopConfig[key]) || {};
    // Ensure every color row / tier cell exists so the grid is complete.
    const out = {};
    for (let c = 1; c <= maxColors; c++) {
      out[c] = {};
      for (const t of tiers) out[c][t] = src[c]?.[t] ?? 0;
    }
    return out;
  };
  return {
    shareOn: ov.brokerMarkupShare != null,
    share: ov.brokerMarkupShare ?? (shopConfig.brokerMarkupShare ?? BROKER_MARKUP_SHARE),
    garmentOn: !!ov.garmentMarkup,
    garmentMarkup: deepClone(ov.garmentMarkup || shopConfig.garmentMarkup) || [],
    printsOn: !!(ov.firstPrint || ov.addlPrint),
    firstPrint: seedTable("firstPrint"),
    addlPrint: seedTable("addlPrint"),
    tiers,
    maxColors,
  };
}

// Draft → the partial overrides object we persist. Sections that are
// toggled off are simply absent (= inherit the shop sheet).
function draftToOverrides(draft) {
  const out = {};
  if (draft.shareOn) out.brokerMarkupShare = draft.share;
  if (draft.garmentOn) out.garmentMarkup = draft.garmentMarkup;
  if (draft.printsOn) {
    out.firstPrint = draft.firstPrint;
    out.addlPrint = draft.addlPrint;
    // Snapshot the tier structure the matrices were authored against —
    // the engine picks the qty tier from config.tiers, so an overridden
    // matrix must carry its own tiers even if the shop re-tiers later.
    out.tiers = draft.tiers;
    out.maxColors = draft.maxColors;
  }
  return sanitizeBrokerOverrides(out);
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

function SectionToggle({ checked, onChange, title, hint }) {
  return (
    <label className="flex items-start gap-2 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 mt-0.5 rounded border-slate-300 text-teal-600"
      />
      <span className="text-xs">
        <span className="font-semibold text-slate-700">{title}</span>
        {hint && <span className="text-slate-500"> — {hint}</span>}
      </span>
    </label>
  );
}

export default function BrokerPricingSection({ user, config }) {
  const shopEmail = shopScope(user);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [brokers, setBrokers] = useState([]);
  const [rows, setRows] = useState([]); // broker_pricing rows for this shop
  const [openEmail, setOpenEmail] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!expanded || !shopEmail) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [{ data: brokerRows }, overrideRows] = await Promise.all([
          supabase
            .from("profiles")
            .select("id,email,full_name,company_name")
            .eq("role", "broker")
            .contains("assigned_shops", JSON.stringify([shopEmail])),
          base44.entities.BrokerPricingOverride
            .filter({ shop_owner: shopEmail })
            .catch(() => []),
        ]);
        if (cancelled) return;
        setBrokers(brokerRows || []);
        setRows(overrideRows || []);
      } catch (err) {
        if (!cancelled) notify.error("Couldn't load broker pricing", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [expanded, shopEmail]);

  const rowFor = (email) =>
    rows.find((r) => (r.broker_email || "").toLowerCase() === (email || "").toLowerCase());

  function openEditor(broker) {
    setOpenEmail(broker.email);
    setDraft(buildDraft(rowFor(broker.email)?.overrides, config || {}));
  }

  // `forcedOverrides` bypasses the draft (Remove overrides passes {}) —
  // setState is async, so building from `draft` right after a setDraft
  // would read the stale closure value.
  async function handleSave(broker, forcedOverrides) {
    const overrides = forcedOverrides ?? draftToOverrides(draft);
    const existing = rowFor(broker.email);
    setSaving(true);
    try {
      if (Object.keys(overrides).length === 0) {
        if (existing) await base44.entities.BrokerPricingOverride.delete(existing.id);
        setRows((prev) => prev.filter((r) => r.id !== existing?.id));
      } else if (existing) {
        const updated = await base44.entities.BrokerPricingOverride.update(existing.id, { overrides });
        setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      } else {
        const created = await base44.entities.BrokerPricingOverride.create({
          shop_owner: shopEmail,
          broker_email: (broker.email || "").toLowerCase(),
          overrides,
        });
        setRows((prev) => [...prev, created]);
      }
      notify.success("Broker pricing saved", `${brokerLabel(broker)} now prices with ${Object.keys(overrides).length ? "custom wholesale terms" : "your standard sheet"}.`);
      setOpenEmail(null);
      setDraft(null);
    } catch (err) {
      notify.error("Couldn't save broker pricing", err);
    } finally {
      setSaving(false);
    }
  }

  const inputCls = "w-full text-xs text-center border border-slate-200 rounded px-1 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-300";

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 text-left"
      >
        <h4 className="text-xs font-bold text-slate-600 uppercase tracking-widest">Per-Broker Pricing</h4>
        <span className="text-xs text-teal-600 font-semibold">{expanded ? "Hide" : "Customize"}</span>
      </button>
      <p className="text-[10px] text-slate-500 mt-1 mb-2">
        Give an individual broker their own wholesale terms — markup share, garment markup, or a full
        contract print-rate sheet. Anything you don&apos;t override keeps following your pricing above.
        Never shown in your public wizard. Applies to quotes the broker saves after the change.
      </p>

      {expanded && (
        <div className="border border-slate-200 rounded-xl p-3 space-y-2">
          {loading && <div className="text-xs text-slate-500 py-1">Loading brokers…</div>}
          {!loading && brokers.length === 0 && (
            <div className="text-xs text-slate-500 py-1">
              No brokers are assigned to your shop yet.
            </div>
          )}
          {!loading && brokers.map((b) => {
            const saved = rowFor(b.email);
            const custom = hasBrokerOverrides(saved?.overrides);
            const isOpen = openEmail === b.email;
            return (
              <div key={b.id} className="border border-slate-100 rounded-lg">
                <div className="flex items-center justify-between px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-700 truncate">{brokerLabel(b)}</div>
                    <div className="text-[10px] text-slate-500 truncate">{b.email}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {custom && (
                      <span className="text-[10px] font-semibold text-teal-700 bg-teal-50 border border-teal-200 rounded px-1.5 py-0.5">
                        Custom pricing
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => (isOpen ? (setOpenEmail(null), setDraft(null)) : openEditor(b))}
                      className="text-xs font-semibold text-teal-600 hover:text-teal-700"
                    >
                      {isOpen ? "Close" : custom ? "Edit" : "Customize"}
                    </button>
                  </div>
                </div>

                {isOpen && draft && (
                  <div className="border-t border-slate-100 px-3 py-3 space-y-4">
                    {/* Markup share */}
                    <div className="space-y-2">
                      <SectionToggle
                        checked={draft.shareOn}
                        onChange={(on) => setDraft((d) => ({ ...d, shareOn: on }))}
                        title="Override markup share"
                        hint="this broker's discount off your garment markup"
                      />
                      {draft.shareOn && (
                        <div className="flex items-center gap-2 pl-6">
                          <div className="relative w-24">
                            <NumericInput
                              value={Math.round((draft.share ?? 0) * 100)}
                              onChange={(pct) => setDraft((d) => ({ ...d, share: (pct || 0) / 100 }))}
                              min={0}
                              max={100}
                              integer
                              label={`${brokerLabel(b)} markup share %`}
                              className={inputCls}
                            />
                            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-slate-500 pointer-events-none">%</span>
                          </div>
                          <span className="text-[10px] text-slate-500">off garment markup for this broker</span>
                        </div>
                      )}
                    </div>

                    {/* Garment markup brackets */}
                    <div className="space-y-2">
                      <SectionToggle
                        checked={draft.garmentOn}
                        onChange={(on) => setDraft((d) => ({ ...d, garmentOn: on }))}
                        title="Override garment markup"
                        hint="custom brackets for this broker's garments"
                      />
                      {draft.garmentOn && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pl-6">
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
                                  label={`${brokerLabel(b)} markup tier ${i + 1} %`}
                                  className={inputCls}
                                />
                                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-slate-500 pointer-events-none">%</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Contract print rates */}
                    <div className="space-y-2">
                      <SectionToggle
                        checked={draft.printsOn}
                        onChange={(on) => setDraft((d) => ({ ...d, printsOn: on }))}
                        title="Override print rates (Screen Print)"
                        hint="contract wholesale rate sheet; starts from your current rates"
                      />
                      {draft.printsOn && (
                        <div className="pl-6 space-y-3">
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
                    </div>

                    <div className="flex items-center gap-3 pt-1">
                      <button
                        type="button"
                        onClick={() => handleSave(b)}
                        disabled={saving}
                        className="bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50"
                      >
                        {saving ? "Saving…" : "Save Broker Pricing"}
                      </button>
                      {custom && (
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(`Remove all custom pricing for ${brokerLabel(b)}? They go back to your standard broker terms.`)) {
                              handleSave(b, {});
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
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
