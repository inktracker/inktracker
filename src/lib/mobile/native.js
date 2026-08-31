// Native (Capacitor iOS) glue. Every export is a NO-OP on web — the app runs
// identically in a browser, and only behaves differently inside the native
// shell. Capacitor plugins are dynamically imported so they never weigh down
// the web bundle. See docs/mobile-app.md (Phase 3).

import { Capacitor } from "@capacitor/core";

/** True only inside the Capacitor native shell (iOS/Android), false on web. */
export function isNative() {
  try {
    return Capacitor?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

/**
 * Open a URL the RIGHT way for the platform:
 *   - native: the system browser (SFSafariViewController) — Apple rejects apps
 *     that take payment / OAuth inside the app's own webview, and Stripe/QB/
 *     supplier carts need a real browser.
 *   - web: exactly the previous behavior (new tab), so nothing changes.
 * Use this for EXTERNAL links (payments, OAuth, vendor carts, file downloads),
 * never for in-app routes.
 */
export async function openExternal(url) {
  if (!url) return;
  if (isNative()) {
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url });
      return;
    } catch {
      // Fall through to a plain navigation if the plugin is unavailable.
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * Send the user into an external OAuth / payment flow the platform-correct way:
 *   - native: the system browser (SFSafariViewController). Apple rejects apps
 *     that run third-party OAuth / payment inside their own webview. The flow
 *     still completes end-to-end because the redirect_uri callback writes its
 *     result server-side (keyed by `state`); a universal-link return (Phase 3b,
 *     QuickBooks leg) will later bring the user back automatically.
 *   - web: a normal full-page redirect — byte-identical to the previous
 *     `window.location.href = url`, so web is unchanged.
 * Use for QB Connect, Stripe billing portal, and any hosted auth/payment page.
 */
export async function openAuthRedirect(url) {
  if (!url) return;
  if (isNative()) {
    await openExternal(url);
    return;
  }
  window.location.href = url;
}

/**
 * Redirect URL for Supabase email/OAuth flows (magic link, sign-up confirm,
 * password reset).
 *   - web: the current origin (localhost in dev, prod in prod) — IDENTICAL to
 *     the previous `${window.location.origin}${path}`, so web is unchanged.
 *   - native: the production https URL, so iOS can route the email link back
 *     INTO the app via a universal link (Associated Domains — wired in Phase 3b).
 *     Until that's configured the link opens in Safari, which still completes
 *     login — a graceful fallback, never a dead end.
 */
// The single custom-scheme URL every native auth flow returns to. Must be in
// Supabase's Auth → URL Configuration → Redirect URLs allow-list (added
// 2026-07-24). Supabase email links 302 through supabase.co, and iOS hands a
// 302 whose target is a custom scheme straight to the app (universal links
// don't fire on a 302 chain) — so the custom scheme is the reliable primitive.
export const NATIVE_AUTH_REDIRECT = "app.inktracker.mobile://mobile-auth";

export function authRedirectUrl(path = "/") {
  const p = path.startsWith("/") ? path : `/${path}`;
  // Native: every flow (magic link, signup confirm, password reset) returns to
  // the SAME allow-listed URL — no per-path variants to allow-list. The intended
  // in-app destination is recovered by routeDeepLink from the token fragment
  // (e.g. type=recovery -> /ResetPassword). Web is byte-identical to before.
  if (isNative()) return NATIVE_AUTH_REDIRECT;
  return `${window.location.origin}${p}`;
}

// The custom URL scheme / universal-link host the native app is reached at.
// Auth (Supabase magic-link / OAuth) and QB OAuth must redirect back to a URL
// the app owns; appUrlOpen then delivers it here. The Supabase `redirectTo` and
// Intuit redirect URI must be configured to this — see docs/mobile-app.md.
// (Scaffold: real values are wired + tested on-device in Phase 3b.)
function routeDeepLink(url) {
  try {
    const u = new URL(url);
    const hash = u.hash || "";
    const search = u.search || "";
    const carriesAuth = hash.includes("access_token") || search.includes("code=");
    if (carriesAuth) {
      // Send the auth return to the right screen, preserving the token fragment
      // so supabase-js's detectSessionInUrl processes it EXACTLY as on web
      // (same code path — magic link / signup -> "/", recovery -> reset form).
      const base = hash.includes("type=recovery") ? "/ResetPassword" : "/";
      if (window.location.pathname === base && !search) {
        // Same path, only the fragment differs — assigning location won't reload
        // and detectSessionInUrl runs on load, so force a fresh document load.
        window.location.hash = hash.replace(/^#/, "");
        window.location.reload();
      } else {
        // Path change triggers a fresh SPA load, which runs detectSessionInUrl.
        window.location.href = `${base}${search}${hash}`;
      }
      return;
    }
    // Non-auth deep link: navigate to an in-app route if one is present.
    // Query string rides along (e.g. ?id= focus params, debug flags).
    if (u.pathname && u.pathname !== "/") window.location.assign(u.pathname + (u.search || ""));
  } catch {
    /* malformed deep link — ignore */
  }
}

/**
 * One-time native setup, called from main.jsx. No-op on web. Sets the status
 * bar style, marks the root element (`cap-native` — CSS safe-area hooks), and
 * registers the deep-link listener that brings OAuth / magic-link redirects
 * back into the app.
 */
export async function initNativeApp() {
  if (!isNative()) return;
  document.documentElement.classList.add("cap-native");
  // "Designed for iPad" running ON A MAC (TestFlight/App Store on Apple
  // silicon): the OS draws an iPhone-style status area inside the window but
  // the webview under-reports env(safe-area-inset-top), so the top bar's
  // content collides with the drawn clock (Joe, 2026-08-08). Distinguish the
  // Mac host from a real iPad (which also reports MacIntel in desktop-content
  // mode) by touch support: real iPads report maxTouchPoints > 0, Macs 0.
  // CSS hook: html.cap-macwin overrides the env()-based top clearances with a
  // fixed one sized to the drawn status area.
  if (navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) === 0) {
    document.documentElement.classList.add("cap-macwin");
  }
  // TEMP diagnostics (2026-08-08, remove after Mac-window debugging): beacon
  // layout facts to a localhost listener when one is running on the host.
  // 127.0.0.1 is a trustworthy origin (mixed-content exempt) and this fails
  // silently everywhere a listener isn't running.
  setTimeout(() => {
    try {
      const probe = document.createElement("div");
      probe.style.cssText = "position:absolute;height:env(safe-area-inset-top);width:1px;visibility:hidden";
      document.body.appendChild(probe);
      const envTop = probe.getBoundingClientRect().height;
      probe.remove();
      const bar = document.querySelector(".app-topbar");
      const d = {
        env: envTop,
        barTop: bar ? Math.round(bar.getBoundingClientRect().top) : null,
        barPT: bar ? getComputedStyle(bar).paddingTop : null,
        cls: document.documentElement.className,
        ua: navigator.userAgent,
        platform: navigator.platform,
        touch: navigator.maxTouchPoints,
        w: window.innerWidth, h: window.innerHeight,
        sw: screen.width, sh: screen.height,
      };
      fetch("http://127.0.0.1:8642/diag?" + encodeURIComponent(JSON.stringify(d))).catch(() => {});
    } catch { /* diagnostics only */ }
  }, 4000);

  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    // App chrome is light, so status-bar content should be dark (Style.Light in
    // Capacitor's naming = dark text on a light background).
    await StatusBar.setStyle({ style: Style.Light });
    // Overlay the web view (edge-to-edge) rather than reserving a separate
    // native status-bar strip. That strip was opaque white and sat ABOVE the
    // web view, so a modal's dimmed backdrop (which lives inside the web view)
    // couldn't cover it — leaving a bright white bar across the top on every
    // modal. Overlaying lets `position: fixed; inset: 0` backdrops dim the whole
    // screen; the `html.cap-native body` safe-area padding keeps content clear
    // of the notch / status bar (those insets are only non-zero when overlaying).
    await StatusBar.setOverlaysWebView({ overlay: true });
  } catch {
    /* status-bar plugin unavailable — non-fatal */
  }

  try {
    const { App } = await import("@capacitor/app");
    App.addListener("appUrlOpen", ({ url }) => {
      if (url) routeDeepLink(url);
    });
  } catch {
    /* app plugin unavailable — non-fatal */
  }
}
