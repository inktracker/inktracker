// Web Push subscription management (browser side).
//
// Pairs with supabase/functions/sendPush + the push_subscriptions table.
// This module only handles the browser end: asking permission, getting a
// PushSubscription from the push service, and storing it so the server can
// reach this device when InkTracker isn't open.
//
// PERMISSION POLICY — deliberately never prompt automatically. Browsers
// give you exactly one shot: a denial is sticky and can only be undone by
// the user digging into site settings, which nobody does. So the prompt
// fires from an explicit "Turn on notifications" click in Account settings
// and nowhere else. See enablePush().

import { supabase } from "@/api/supabaseClient";
import { shopScope } from "@/lib/shopScope";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

/**
 * Can this browser do Web Push at all?
 *
 * Notably false in: Safari on iOS unless the site is installed to the home
 * screen, private windows, and any Capacitor WKWebView (the native app
 * uses APNs instead — see the ios platform in push_subscriptions).
 */
export function isPushSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** 'granted' | 'denied' | 'default' | 'unsupported' */
export function getPermissionState() {
  if (!isPushSupported()) return "unsupported";
  return Notification.permission;
}

// The applicationServerKey must be a Uint8Array of the raw 65-byte P-256
// point; the VAPID public key travels as base64url.
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function subscriptionKeys(sub) {
  const json = sub.toJSON();
  return {
    endpoint: json.endpoint,
    p256dh: json.keys?.p256dh ?? null,
    auth_secret: json.keys?.auth ?? null,
  };
}

async function readyRegistration() {
  // index.html registers /sw.js on load; navigator.serviceWorker.ready
  // resolves once it's active. Don't re-register here — a second
  // registration for the same scope just churns the worker.
  return navigator.serviceWorker.ready;
}

/**
 * Turn on push for the current user + shop. MUST be called from a user
 * gesture (a click) — that's both a browser requirement for the permission
 * prompt and the reason we don't prompt on page load.
 *
 * @param {object} user  the profile from base44.auth.me()
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function enablePush(user) {
  if (!isPushSupported()) return { ok: false, reason: "unsupported" };
  if (!VAPID_PUBLIC_KEY) {
    // Misconfiguration, not user error — surface it distinctly so it
    // doesn't get reported as "notifications are broken".
    console.error("[push] VITE_VAPID_PUBLIC_KEY is not set");
    return { ok: false, reason: "not-configured" };
  }
  const shop = shopScope(user);
  if (!shop || !user?.auth_id) return { ok: false, reason: "no-user" };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: permission };

  const reg = await readyRegistration();

  // Reuse an existing subscription when there is one. Calling subscribe()
  // twice with the same key returns the same endpoint anyway, but asking
  // first avoids a needless round-trip to the push service.
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      // Required by every browser: push must be tied to a visible
      // notification, no silent background pings.
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const keys = subscriptionKeys(sub);
  if (!keys.p256dh || !keys.auth_secret) {
    return { ok: false, reason: "no-keys" };
  }

  // Upsert on endpoint: the browser hands back the same endpoint for the
  // same profile+origin, so re-enabling must update the row (and clear a
  // previous disabled_at) rather than collide on the unique index.
  const { error } = await supabase
    .from("push_subscriptions")
    .upsert({
      shop_owner: shop,
      auth_id: user.auth_id,
      platform: "web",
      ...keys,
      device_token: null,
      user_agent: navigator.userAgent?.slice(0, 300) ?? null,
      last_seen_at: new Date().toISOString(),
      disabled_at: null,
      failure_count: 0,
    }, { onConflict: "endpoint" });

  if (error) {
    console.error("[push] failed to save subscription:", error.message);
    return { ok: false, reason: "save-failed" };
  }
  return { ok: true };
}

/**
 * Turn push off for THIS device. Unsubscribes from the push service and
 * removes the row, so the send path stops targeting a dead endpoint.
 */
export async function disablePush() {
  if (!isPushSupported()) return { ok: true };
  const reg = await readyRegistration();
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return { ok: true };

  const { endpoint } = subscriptionKeys(sub);
  // Order matters: drop the row first. If unsubscribe() succeeds but the
  // delete fails, the server keeps pushing to a dead endpoint until it
  // 410s. The reverse — row gone, browser still subscribed — is harmless
  // and self-corrects on the next enable.
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) console.error("[push] failed to remove subscription:", error.message);

  await sub.unsubscribe().catch(() => {});
  return { ok: !error };
}

/**
 * Is THIS browser currently subscribed? Checks the push service rather
 * than the database — the browser is the authority on its own
 * subscription, and a row can outlive a cleared profile.
 */
export async function isSubscribed() {
  if (!isPushSupported() || Notification.permission !== "granted") return false;
  try {
    const reg = await readyRegistration();
    return !!(await reg.pushManager.getSubscription());
  } catch {
    return false;
  }
}
