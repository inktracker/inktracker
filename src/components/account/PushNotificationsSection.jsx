import { useState, useEffect, useCallback } from "react";
import { Loader2, BellRing, BellOff } from "lucide-react";
import {
  isPushSupported,
  getPermissionState,
  isSubscribed,
  enablePush,
  disablePush,
} from "@/lib/push/webPush";
import { notify } from "@/lib/notify";
import { isNative } from "@/lib/mobile/native";
import { enableNativePush } from "@/lib/push/nativePush";

// Browser push for the events already collected in the notifications table.
//
// This is the ONLY place the permission prompt fires. Browsers give you one
// shot — a denial is sticky and effectively permanent for non-technical
// users — so it must come from a deliberate click here, never on page load
// or after some clever "engagement" heuristic.
//
// Per-DEVICE, not per-account: a subscription belongs to one browser on one
// machine. The copy says so, because "I turned it on at the shop, why isn't
// my phone buzzing" is otherwise the obvious confusion.
export default function PushNotificationsSection({ user }) {
  // The native shell has no web-push APIs but DOES support APNs — treat it
  // as supported and route enablement through the plugin below.
  const [supported] = useState(() => isNative() || isPushSupported());
  const [permission, setPermission] = useState(() => getPermissionState());
  const [on, setOn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setOn(await isSubscribed());
    setPermission(getPermissionState());
    setLoading(false);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const subscribed = await isSubscribed();
      if (!alive) return;
      setOn(subscribed);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  async function toggle() {
    setBusy(true);
    try {
      if (on) {
        const res = await disablePush();
        if (!res.ok) notify.error("Couldn't turn notifications off");
      } else {
        const res = isNative() ? await enableNativePush(user) : await enablePush(user);
        if (!res.ok) {
          const msg = {
            denied: "Your browser is blocking notifications for InkTracker. You'll need to allow them in your browser's site settings for this page.",
            unsupported: "This browser can't do notifications. Chrome, Edge or Firefox on a computer will work.",
            "not-configured": "Notifications aren't set up on this install yet.",
            "no-keys": "Your browser didn't return the keys we need. Try again, or use a different browser.",
            "save-failed": "We couldn't save this device. Check your connection and try again.",
            "app-update-required": "This version of the app doesn't support notifications yet — update InkTracker to 1.1 (via TestFlight or the App Store), then try again.",
            timeout: "Apple didn't confirm the registration in time. Check your connection and try again.",
          }[res.reason] || "Couldn't turn notifications on.";
          notify.error(msg);
        }
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="text-xs text-slate-500">Checking this device…</div>;
  }

  if (!supported) {
    return (
      <p className="text-xs text-slate-500 leading-relaxed">
        This browser can't show notifications. They work in Chrome, Edge and Firefox on a computer,
        and in Safari once InkTracker is added to your Home Screen.
      </p>
    );
  }

  const blocked = permission === "denied";

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500 leading-relaxed">
        Get a notification when something needs you — a new quote request comes in, a customer
        approves or pays, or artwork gets a decision. These are the same items in your{" "}
        <span className="font-semibold">notification bell</span>, pushed to you when InkTracker
        isn't open. <span className="font-semibold">This setting applies to this device only</span>,
        so turn it on anywhere you want to be reached.
      </p>

      {blocked ? (
        <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            <BellOff className="w-4 h-4" /> Blocked by your browser
          </div>
          <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
            You (or this browser) previously blocked notifications for InkTracker. We can't ask
            again — click the padlock or the icon in your address bar, allow Notifications for this
            site, then reload.
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={toggle}
            disabled={busy}
            className={`flex items-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-xl transition disabled:bg-slate-300 ${
              on
                ? "bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-100"
                : "bg-teal-600 hover:bg-teal-700 text-white"
            }`}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <BellRing className="w-4 h-4" />}
            {busy ? "Working…" : on ? "Turn off on this device" : "Turn on notifications"}
          </button>
          {on && (
            <span className="text-xs text-emerald-600 font-semibold">On for this device</span>
          )}
        </div>
      )}
    </div>
  );
}
