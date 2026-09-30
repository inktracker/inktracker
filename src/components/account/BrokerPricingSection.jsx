import { useEffect, useState } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import { notify } from "@/lib/notify";
import { shopScope } from "@/lib/shopScope";
import { hasBrokerOverrides, brokerPricingMode } from "@/lib/broker/brokerPricing";
import { isBrokerBillUpFront } from "@/lib/broker/brokerBillTiming";
import BrokerPricingEditor from "@/components/broker/BrokerPricingEditor";

// Account → Pricing → Per-Broker Pricing. Wraps the shared
// BrokerPricingEditor (also mounted in the Admin tab's Broker
// Management cards) with this shop's broker list. Storage is the
// broker_pricing table — never inside shops.pricing_config, which
// ships to the anonymous public wizard via getPublicShopConfig.
//
// Only affects quotes the broker saves AFTER the change — saved quotes
// are immutable snapshots (Quote Snapshot Invariant).
//
// Note: the broker list read relies on the profiles_select_team RLS
// policy, which matches on the OWNER's email inside the broker's
// assigned_shops — so a manager viewing this section sees an empty
// list. The overrides table itself is manager-writable (see migration).

function brokerLabel(b) {
  return b.company_name || b.full_name || b.email;
}

export default function BrokerPricingSection({ user, config }) {
  const shopEmail = shopScope(user);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [brokers, setBrokers] = useState([]);
  const [rows, setRows] = useState([]); // broker_pricing rows for this shop
  const [openEmail, setOpenEmail] = useState(null);

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

  // Per-broker wholesale billing timing (bill_up_front on the broker_pricing
  // row). Upserts: update the row if it exists, else create a minimal one.
  // Stored in its own column so it never collides with the pricing overrides.
  async function setBillUpFront(brokerEmail, next) {
    try {
      const existing = rowFor(brokerEmail);
      const saved = existing
        ? await base44.entities.BrokerPricingOverride.update(existing.id, { bill_up_front: next })
        : await base44.entities.BrokerPricingOverride.create({
            shop_owner: shopEmail,
            broker_email: brokerEmail,
            overrides: {},
            bill_up_front: next,
          });
      setRows((prev) => {
        const without = prev.filter((r) => r.id !== (existing?.id ?? saved?.id));
        return saved ? [...without, saved] : without;
      });
    } catch (err) {
      notify.error("Couldn't update billing timing", err);
    }
  }

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
        Choose how each broker is priced: your sheet with a markup-share discount (the default),
        or their own custom price sheet. Never shown in your public wizard. Applies to quotes the
        broker saves after the change. Also editable from Admin → Broker Management.
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
                        {brokerPricingMode(saved?.overrides) === "sheet" ? "Custom sheet" : "Custom markup"}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setOpenEmail(isOpen ? null : b.email)}
                      className="text-xs font-semibold text-teal-600 hover:text-teal-700"
                    >
                      {isOpen ? "Close" : custom ? "Edit" : "Customize"}
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div className="border-t border-slate-100 px-3 py-3">
                    {/* Wholesale billing timing — when the shop bills this broker
                        the wholesale amount. Only takes effect when broker
                        billing is on (Account → QuickBooks). */}
                    <div className="mb-3 pb-3 border-b border-slate-100">
                      <div className="text-[11px] font-bold text-slate-600 uppercase tracking-wide mb-1.5">Wholesale billing timing</div>
                      {config?.brokerBillingEnabled !== true && (
                        <div className="text-[10px] text-amber-600 mb-1.5">
                          Turn on broker billing in Account → QuickBooks for this to take effect.
                        </div>
                      )}
                      <label className="flex items-center gap-2 text-xs text-slate-600 mb-1 cursor-pointer">
                        <input
                          type="radio"
                          name={`billing-timing-${b.email}`}
                          checked={!isBrokerBillUpFront(saved)}
                          onChange={() => setBillUpFront(b.email, false)}
                        />
                        When the job is done
                      </label>
                      <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                        <input
                          type="radio"
                          name={`billing-timing-${b.email}`}
                          checked={isBrokerBillUpFront(saved)}
                          onChange={() => setBillUpFront(b.email, true)}
                        />
                        Up front, before production starts
                      </label>
                    </div>
                    <BrokerPricingEditor
                      key={`${b.email}:${saved?.id || "new"}`}
                      broker={{ email: b.email, label: brokerLabel(b) }}
                      shopOwner={shopEmail}
                      shopConfig={config}
                      existingRow={saved || null}
                      onSaved={(nextRow) => {
                        setRows((prev) => {
                          const without = prev.filter((r) => r.id !== (saved?.id ?? nextRow?.id));
                          return nextRow ? [...without, nextRow] : without;
                        });
                        setOpenEmail(null);
                      }}
                    />
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
