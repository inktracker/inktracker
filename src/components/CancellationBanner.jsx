import { useState } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import { notify } from "@/lib/notify";
import { isNative } from "@/lib/mobile/native";

// Surfaces a SCHEDULED (pending) cancellation so a canceling shop isn't
// surprised when access ends. Shows only while the subscription is set to cancel
// at period end AND that date is still in the future — the shop keeps full
// access until then.
//
// Display only. It does NOT touch getEffectiveTier / canAccess / isReadOnly —
// a pending cancel is still "active" until it isn't (the webhook flips the
// tier to "expired" on customer.subscription.deleted, at which point the trial/
// expired banners take over and this one stops showing).
//
// Owners (billing-owner roles) get a "Resume subscription" button that opens the
// Stripe billing portal via the existing `portal` action. Team members inherit
// the owner's pending-cancel state (resolveTeamSubscription) and see the same
// notice, minus the billing action they can't perform.

function endsAtDate(user) {
  if (!user?.subscription_ends_at) return null;
  const t = new Date(user.subscription_ends_at).getTime();
  return Number.isFinite(t) ? new Date(t) : null;
}

export default function CancellationBanner({ user }) {
  const [resuming, setResuming] = useState(false);

  if (!user) return null;
  if (user.cancel_at_period_end !== true) return null;
  const ends = endsAtDate(user);
  if (!ends || ends.getTime() <= Date.now()) return null; // only while the end date is still ahead

  const endsOn = ends.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  // App Store guideline 3.1.1 (tightened after the 1.0 rejection,
  // 2026-08-05): a scheduled-cancellation notice is inherently
  // subscription messaging, and any pointer to manage it is steering.
  // On native this banner renders nothing; the shop still sees it on web,
  // where the subscription actually lives.
  const native = isNative();
  if (native) return null;
  const canManageBilling = (user.role === "shop" || user.role === "admin") && !native;

  async function handleResume() {
    setResuming(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error } = await base44.functions.invoke("billing", {
        action: "portal",
        accessToken: session?.access_token,
      });
      if (error) {
        const detail = error?.context?.response?.text
          ? await error.context.response.text().catch(() => error.message)
          : error.message;
        notify.error("Couldn't open billing portal", detail);
        return;
      }
      if (data?.url) window.location.href = data.url;
      else notify.error("Couldn't open billing portal", data?.error);
    } catch (err) {
      notify.error("Couldn't open billing portal", err);
    } finally {
      setResuming(false);
    }
  }

  return (
    <div className="bg-blue-50 border-b border-blue-200 px-4 sm:px-6 py-2.5">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
        <p className="flex-1 text-sm text-blue-900">
          <span className="font-semibold">Your InkTracker plan ends on {endsOn}.</span>{" "}
          <span className="text-blue-800">You'll keep full access until then.</span>
        </p>
        {canManageBilling ? (
          <button
            type="button"
            onClick={handleResume}
            disabled={resuming}
            className="shrink-0 inline-flex items-center justify-center text-xs sm:text-sm font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white px-4 py-2 rounded-xl transition whitespace-nowrap"
          >
            {resuming ? "Opening…" : "Resume subscription"}
          </button>
        ) : (
          <span className="shrink-0 text-xs text-blue-700">
            {native
              ? "Manage your plan at inktracker.app."
              : "Your shop owner can resume anytime."}
          </span>
        )}
      </div>
    </div>
  );
}
