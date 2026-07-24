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
 * Redirect URL for Supabase email/OAuth flows (magic link, sign-up confirm,
 * password reset).
 *   - web: the current origin (localhost in dev, prod in prod) — IDENTICAL to
 *     the previous `${window.location.origin}${path}`, so web is unchanged.
 *   - native: the production https URL, so iOS can route the email link back
 *     INTO the app via a universal link (Associated Domains — wired in Phase 3b).
 *     Until that's configured the link opens in Safari, which still completes
 *     login — a graceful fallback, never a dead end.
 */
export function authRedirectUrl(path = "/") {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (isNative()) return `https://www.inktracker.app${p}`;
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
    const carriesAuth =
      (u.hash && u.hash.includes("access_token")) ||
      (u.search && u.search.includes("code="));
    // Preserve the path + query + hash so AuthContext's existing
    // window.location token-detection logic runs unchanged.
    const target = `${u.pathname || "/"}${u.search || ""}${u.hash || ""}`;
    if (carriesAuth) {
      window.location.replace(target.startsWith("/") ? target : `/${target}`);
    } else if (u.pathname) {
      window.location.assign(u.pathname);
    }
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

  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    // App chrome is light, so status-bar content should be dark.
    await StatusBar.setStyle({ style: Style.Light });
    await StatusBar.setOverlaysWebView({ overlay: false });
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
