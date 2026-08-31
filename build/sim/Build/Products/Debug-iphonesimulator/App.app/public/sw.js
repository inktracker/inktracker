// InkTracker service worker.
//
// Was a no-op stub that existed only to make the app installable. Now also
// receives Web Push. Kept deliberately tiny and dependency-free: this file
// is served as-is (not bundled), and a syntax error here silently breaks
// both installability and every push for every shop.
//
// The fetch handler stays a no-op on purpose — we do NOT want offline
// caching of an app whose whole job is showing live money numbers. A shop
// owner seeing a cached quote total from yesterday is worse than an error.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});

// ── Web Push ────────────────────────────────────────────────────────────
// Payload is the JSON built by the sendPush edge function:
//   { title, body, url, tag, severity, notificationId }

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Malformed or empty payload. Still show something — a silent push
    // that Chrome then flags as an "unused notification" costs us the
    // permission entirely on repeat.
    data = {};
  }

  const title = data.title || "InkTracker";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    // Collapses repeats of the same event on the same entity instead of
    // stacking identical banners.
    tag: data.tag || "inktracker",
    renotify: true,
    // Money moments shouldn't auto-dismiss before they're seen.
    requireInteraction: data.severity === "alert",
    data: { url: data.url || "/", notificationId: data.notificationId },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";

  // Prefer focusing a tab that's already open over spawning a new one —
  // shop owners typically have InkTracker open all day, and a second tab
  // with a half-loaded app is a bad landing.
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of all) {
      if ("focus" in client) {
        try {
          if ("navigate" in client) await client.navigate(target);
        } catch {
          // Cross-origin or navigation blocked — focusing is still better
          // than nothing.
        }
        return client.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});
