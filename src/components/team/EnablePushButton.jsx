import { useState, useEffect } from "react";
import { isPushSupported, getPermissionState, isSubscribed, enablePush } from "@/lib/push/webPush";
import { notify } from "@/lib/notify";
import { BellRing, Loader2 } from "lucide-react";

// One-tap push enablement for the ShopFloor header. Employees can't reach
// Account → Push Notifications (owner surface), so this is their door to
// lock-screen notifications for @mentions. Renders nothing once enabled,
// unsupported (e.g. iOS Safari NOT added to the Home Screen), or denied.
export default function EnablePushButton({ user }) {
  const [state, setState] = useState("checking"); // checking | offer | busy | hidden

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (!isPushSupported() || getPermissionState() === "denied") {
          if (active) setState("hidden");
          return;
        }
        const on = await isSubscribed();
        if (active) setState(on ? "hidden" : "offer");
      } catch {
        if (active) setState("hidden");
      }
    })();
    return () => { active = false; };
  }, []);

  if (state === "checking" || state === "hidden") return null;

  async function turnOn() {
    setState("busy");
    try {
      const result = await enablePush(user);
      if (result?.ok) {
        notify.success("Notifications on — @mentions will reach this device");
        setState("hidden");
        return;
      }
      if (result?.reason === "denied") {
        notify.error("Notifications are blocked for this site — allow them in your browser settings, then try again.");
        setState("hidden");
        return;
      }
      notify.error("Couldn't enable notifications on this device.");
      setState("offer");
    } catch (err) {
      notify.error(err?.message || "Couldn't enable notifications");
      setState("offer");
    }
  }

  return (
    <button
      onClick={turnOn}
      disabled={state === "busy"}
      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-teal-500/60 hover:bg-teal-500 transition text-sm font-semibold text-white"
      title="Get notified on this device when a teammate @mentions you"
    >
      {state === "busy" ? <Loader2 className="w-4 h-4 animate-spin" /> : <BellRing className="w-4 h-4" />}
      <span className="hidden sm:inline">Enable notifications</span>
    </button>
  );
}
