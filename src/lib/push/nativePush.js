// APNs registration for the native iOS shell (Capacitor). The web-push path
// (webPush.js) can't run inside WKWebView — Apple only allows web push for
// Home-Screen PWAs — so the native app registers through the
// PushNotifications plugin and stores an APNs device token instead of a
// web-push endpoint. sendPush routes on push_subscriptions.platform.
//
// Import is dynamic everywhere so the web bundle never pulls the plugin.

import { supabase } from "@/api/supabaseClient";
import { isNative } from "@/lib/mobile/native";
import { shopScope } from "@/lib/shopScope";

async function plugin() {
  const mod = await import("@capacitor/push-notifications");
  return mod.PushNotifications;
}

// One registration listener per app session — Capacitor listeners stack.
let listenersArmed = false;
let pendingResolve = null;

async function armListeners(user) {
  if (listenersArmed) return;
  listenersArmed = true;
  const Push = await plugin();

  await Push.addListener("registration", async ({ value: token }) => {
    try {
      const shop = shopScope(user);
      if (!shop || !user?.auth_id || !token) throw new Error("missing identity");
      const { error } = await supabase.from("push_subscriptions").upsert(
        {
          shop_owner: shop,
          auth_id: user.auth_id,
          platform: "ios",
          device_token: token,
          user_agent: "InkTracker iOS app",
          last_seen_at: new Date().toISOString(),
          disabled_at: null,
          failure_count: 0,
        },
        { onConflict: "device_token" },
      );
      if (error) throw error;
      pendingResolve?.({ ok: true });
    } catch (err) {
      console.error("[nativePush] token save failed:", err?.message ?? err);
      pendingResolve?.({ ok: false, reason: "save-failed" });
    } finally {
      pendingResolve = null;
    }
  });

  await Push.addListener("registrationError", (err) => {
    console.error("[nativePush] registration error:", JSON.stringify(err));
    pendingResolve?.({ ok: false, reason: "registration-error" });
    pendingResolve = null;
  });

  // Tapping a notification deep-links into the entity it's about (the same
  // url web push uses, carried in the data payload).
  await Push.addListener("pushNotificationActionPerformed", (action) => {
    const url = action?.notification?.data?.url;
    if (typeof url === "string" && url.startsWith("/")) {
      window.location.assign(url);
    }
  });
}

// A plugin call into a binary that doesn't CONTAIN the plugin (old App
// Store build viewing the new site) never gets a bridge reply — the
// promise just hangs. Race every native call so that case degrades to a
// clear error instead of an infinite spinner. The permission dialog
// itself doesn't hit this: iOS resolves requestPermissions only after
// the user answers, so the window is generous.
function withHangGuard(promise, ms = 30000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("plugin-unavailable")), ms)),
  ]);
}

/** Explicit enable from a button tap — prompts if needed. */
export async function enableNativePush(user) {
  if (!isNative()) return { ok: false, reason: "not-native" };
  const Push = await plugin();
  let perm;
  try {
    perm = await withHangGuard(Push.requestPermissions());
  } catch {
    return { ok: false, reason: "app-update-required" };
  }
  if (perm.receive !== "granted") return { ok: false, reason: "denied" };
  await armListeners(user);
  return new Promise((resolve) => {
    pendingResolve = resolve;
    Push.register();
    // APNs registration normally resolves in <2s; don't hang the button.
    setTimeout(() => {
      if (pendingResolve === resolve) {
        pendingResolve = null;
        resolve({ ok: false, reason: "timeout" });
      }
    }, 10000);
  });
}

/**
 * Silent keep-fresh on app open: if permission was ALREADY granted,
 * re-register so token rotations land in push_subscriptions. Never prompts.
 */
export async function refreshNativePushIfGranted(user) {
  if (!isNative() || !user?.auth_id) return;
  try {
    const Push = await plugin();
    const perm = await Push.checkPermissions();
    if (perm.receive !== "granted") return;
    await armListeners(user);
    await Push.register();
  } catch (err) {
    console.error("[nativePush] refresh failed:", err?.message ?? err);
  }
}
