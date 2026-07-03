import { useState, useEffect } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import { InlineLinesSkeleton } from "@/components/shared/Skeletons";
import { CheckCircle2 } from "lucide-react";
import { PLANS, getTierLabel, getTierColor } from "@/lib/billing";
import { notify } from "@/lib/notify";
import { useAuth } from "@/lib/AuthContext";

// Account → Billing & Plan section. Extracted verbatim from Account.jsx
// as a pure decomposition — no behavior change. Owns its own subscription
// fetch + checkout/portal handlers; receives the current `user` as a prop.
export default function BillingSection({ user }) {
  const [sub, setSub] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(null);
  const { checkAppState } = useAuth();

  const SUPABASE_FUNC_URL = import.meta.env.VITE_SUPABASE_URL;

  useEffect(() => {
    async function load() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const { data } = await base44.functions.invoke("billing", {
          action: "getSubscription",
          accessToken: session?.access_token,
        });
        if (data) {
          setSub(data);
          // The backend self-heals a stuck-on-trial profile against live
          // Stripe state here. If it just promoted us to a paid plan but the
          // cached auth user still says "trial", refresh the user so the
          // global feature gate + "trial ended" banner clear without a manual
          // page reload.
          const healedToPaid = data.tier === "shop" || data.status === "active" || data.status === "trialing";
          const cachedSaysExpired = user?.subscription_tier !== "shop" && user?.subscription_status !== "active";
          if (healedToPaid && cachedSaysExpired) {
            checkAppState?.({ silent: true });
          }
        }
      } catch {}
      setLoading(false);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCheckout(billing) {
    // billing: "monthly" ($99/mo) | "annual" ($999/yr)
    setCheckoutLoading(billing);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error: invErr } = await base44.functions.invoke("billing", {
        action: "checkout",
        accessToken: session?.access_token,
        billing,
      });
      if (invErr) { notify.error("Couldn't start checkout", invErr); return; }
      if (data?.url) window.location.href = data.url;
      else notify.error("Couldn't start checkout", data?.error);
    } catch (err) {
      notify.error("Checkout failed", err);
    } finally {
      setCheckoutLoading(null);
    }
  }

  async function handlePortal() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error: invErr } = await base44.functions.invoke("billing", {
        action: "portal",
        accessToken: session?.access_token,
      });
      if (invErr) {
        // Supabase wraps non-2xx responses in FunctionsHttpError and
        // hides the real error message behind `.context.response`.
        // Without this unwrap, the operator sees "Edge Function
        // returned a non-2xx status code" with no signal about which
        // Stripe / config issue caused it.
        const ctxRes = invErr.context?.response ?? (typeof invErr.context?.text === "function" ? invErr.context : null);
        let detail = invErr.message;
        if (ctxRes?.text) {
          try {
            const body = await ctxRes.text();
            const parsed = JSON.parse(body);
            detail = parsed?.error || body || detail;
          } catch {}
        }
        notify.error("Couldn't open billing portal", detail);
        return;
      }
      if (data?.url) window.location.href = data.url;
      else notify.error("Couldn't open billing portal", data?.error);
    } catch (err) {
      notify.error("Couldn't open billing portal", err);
    }
  }

  if (loading) {
    return <div className="py-4"><InlineLinesSkeleton /></div>;
  }

  const tier = sub?.tier || "trial";
  // Only 'shop' has a Stripe subscription behind it — 'incomplete' (no card
  // yet) used to slip through the old !== trial/expired check and got a
  // "Manage Billing" button that opened an empty portal.
  const hasPaidPlan = tier === "shop";
  const neverSubscribed = tier === "incomplete";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between bg-slate-50 rounded-xl p-4">
        <div>
          <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Current Plan</div>
          <div className="flex items-center gap-2">
            <span className={`text-sm font-bold px-2.5 py-0.5 rounded-full ${getTierColor(tier)}`}>
              {getTierLabel(tier)}
            </span>
            {sub?.status && (
              <span className={`text-xs ${sub.status === "active" || sub.status === "trialing" ? "text-emerald-600" : "text-red-500"}`}>
                {sub.status === "trialing" ? `${sub.trialDaysLeft} days left` : sub.status}
              </span>
            )}
          </div>
        </div>
        {hasPaidPlan && (
          <button onClick={handlePortal}
            className="text-xs font-semibold text-teal-600 border border-teal-200 px-3 py-1.5 rounded-lg hover:bg-teal-50 transition">
            Manage Billing
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl">
        {PLANS.map(plan => (
          <div key={plan.billing} className="rounded-xl border-2 border-slate-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-sm font-bold text-slate-800">{plan.name}</div>
                <div className="text-xs text-slate-500">Everything included</div>
              </div>
              <div className="text-right">
                <span className="text-2xl font-bold text-slate-900">${plan.price}</span>
                <span className="text-xs text-slate-500">{plan.period}</span>
              </div>
            </div>
            {plan.foundingNote && (
              <div className="text-[11px] font-semibold text-emerald-600 mb-3">{plan.foundingNote}</div>
            )}
            {plan.savingsNote && (
              <div className="text-[11px] font-semibold text-emerald-600 mb-3">{plan.savingsNote}</div>
            )}
            <div className="grid grid-cols-2 gap-1.5 mb-4">
              {plan.features.map(f => (
                <div key={f} className="flex items-start gap-1.5 text-xs text-slate-600">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
                  {f}
                </div>
              ))}
            </div>
            <button onClick={() => handleCheckout(plan.billing)} disabled={!!checkoutLoading}
              className="w-full text-xs font-bold py-2.5 rounded-lg transition disabled:opacity-50 text-white bg-teal-600 hover:bg-teal-700">
              {checkoutLoading === plan.billing
                ? "Loading..."
                : neverSubscribed
                  ? "Start 14-day free trial"
                  : `Subscribe ${plan.name.toLowerCase()}`}
            </button>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-slate-500 mt-3 max-w-2xl">
        Have a beta promo code? Enter it on the Stripe checkout page after clicking Subscribe.
      </p>
    </div>
  );
}
