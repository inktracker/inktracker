import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { getEffectiveTier } from "@/lib/billing";

// Banner that surfaces the user's billing state at the top of every
// page so they can't be surprised by a silent trial expiry.
//
// Four states:
//   • incomplete      → teal "add a payment method to start your trial"
//   • trial > 3 days  → slate info strip with day count + "View plans"
//   • trial ≤ 3 days  → amber warning ("ends in X days — pick a plan")
//   • expired         → red "trial ended — subscribe" CTA
//
// Renders nothing for paid subscribers (tier "shop") or non-shop roles
// (broker / employee don't see this layout anyway, but defense in depth).
//
// `daysLeft` is computed off `user.trial_ends_at` so a stale
// `subscription_tier` field doesn't lie to us — see getEffectiveTier
// for the same logic on the gate side.

function daysLeft(user, now = Date.now()) {
  if (!user?.trial_ends_at) return null;
  const endsAt = new Date(user.trial_ends_at).getTime();
  if (!Number.isFinite(endsAt)) return null;
  const ms = endsAt - now;
  if (ms <= 0) return 0;
  return Math.ceil(ms / 86400000);
}

export default function TrialStatusBanner({ user }) {
  if (!user) return null;
  if (user.role !== "shop" && user.role !== "admin") return null;
  const tier = getEffectiveTier(user);
  if (tier === "shop") return null;

  const plansUrl = createPageUrl("Account") + "?billing=1";

  // 'incomplete' = card-required signup with no payment method yet.
  // getEffectiveTier collapses it to "expired", but "your trial has ended"
  // is wrong for someone whose trial never started — give them the
  // start-your-trial message instead of the scary red one.
  if (user.subscription_tier === "incomplete") {
    return (
      <div className="bg-teal-50 border-b border-teal-200 px-4 sm:px-6 py-2.5">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
          <p className="flex-1 text-sm text-teal-900 font-semibold">
            Add a payment method to start your 14-day free trial.
          </p>
          <Link
            to={plansUrl}
            className="shrink-0 inline-flex items-center justify-center text-xs sm:text-sm font-semibold bg-teal-600 hover:bg-teal-500 text-white px-4 py-2 rounded-xl transition whitespace-nowrap"
          >
            Start free trial →
          </Link>
        </div>
      </div>
    );
  }

  if (tier === "expired") {
    return (
      <div className="bg-red-50 border-b border-red-200 px-4 sm:px-6 py-2.5">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
          <p className="flex-1 text-sm text-red-800 font-semibold">
            Your free trial has ended. Subscribe to keep using InkTracker.
          </p>
          <Link
            to={plansUrl}
            className="shrink-0 inline-flex items-center justify-center text-xs sm:text-sm font-semibold bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-xl transition whitespace-nowrap"
          >
            Subscribe →
          </Link>
        </div>
      </div>
    );
  }

  // tier === "trial" — figure out urgency
  const left = daysLeft(user);
  const isUrgent = left !== null && left <= 3;

  if (isUrgent) {
    return (
      <div className="bg-amber-50 border-b border-amber-200 px-4 sm:px-6 py-2.5">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
          <p className="flex-1 text-sm text-amber-900 font-semibold">
            {left === 0
              ? "Your free trial ends today."
              : left === 1
                ? "Your free trial ends tomorrow."
                : `Your free trial ends in ${left} days.`}
            {" "}
            <span className="font-normal text-amber-800">
              Pick a plan to keep your shop active.
            </span>
          </p>
          <Link
            to={plansUrl}
            className="shrink-0 inline-flex items-center justify-center text-xs sm:text-sm font-semibold bg-amber-600 hover:bg-amber-500 text-white px-4 py-2 rounded-xl transition whitespace-nowrap"
          >
            View plans →
          </Link>
        </div>
      </div>
    );
  }

  // Trial active, plenty of time left — small informational strip.
  return (
    <div className="bg-slate-50 border-b border-slate-200 px-4 sm:px-6 py-2">
      <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
        <p className="text-xs text-slate-600">
          Free trial —{" "}
          <span className="font-semibold text-slate-800">
            {left !== null
              ? `${left} day${left === 1 ? "" : "s"} left`
              : "active"}
          </span>
        </p>
        <Link
          to={plansUrl}
          className="text-xs font-semibold text-teal-600 hover:text-teal-700"
        >
          View plans →
        </Link>
      </div>
    </div>
  );
}
