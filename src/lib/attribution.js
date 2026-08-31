// Signup attribution — answers "how did this shop find us?"
//
// Two layers, stored together in profiles.signup_source (jsonb):
//   1. Silent first-touch: referrer + utm_* + landing path, captured in
//      localStorage on the visitor's FIRST page load and passed through
//      supabase.auth.signUp metadata → handle_new_user writes it into the
//      profile row at INSERT (so the signup-notify email sees it too).
//   2. Self-reported: the optional "How did you hear about us?" answer from
//      onboarding, merged in under `self_reported`.
//
// First-touch means first: a visitor who lands from a Facebook post today
// and signs up from a bookmark next week still attributes to Facebook.

const STORAGE_KEY = "it_first_touch";

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];

/**
 * Capture first-touch attribution into localStorage. Call once at app boot,
 * before auth. No-ops if a capture already exists (first touch wins) or if
 * storage is unavailable (private mode) — attribution is never worth an error.
 */
export function captureAttribution({
  storage = typeof localStorage === "undefined" ? null : localStorage,
  href = typeof window === "undefined" ? "" : window.location.href,
  referrer = typeof document === "undefined" ? "" : document.referrer,
  now = () => new Date().toISOString(),
} = {}) {
  try {
    if (!storage || storage.getItem(STORAGE_KEY)) return;
    const url = new URL(href);
    const capture = { landing: url.pathname, captured_at: now() };
    for (const k of UTM_KEYS) {
      const v = url.searchParams.get(k);
      if (v) capture[k] = v.slice(0, 200);
    }
    // Same-origin referrers are internal navigation, not a source.
    if (referrer) {
      try {
        if (new URL(referrer).origin !== url.origin) {
          capture.referrer = referrer.slice(0, 500);
        }
      } catch {
        /* unparseable referrer — drop it */
      }
    }
    storage.setItem(STORAGE_KEY, JSON.stringify(capture));
  } catch {
    /* storage blocked — fine */
  }
}

/**
 * The stored first-touch capture, or null. Passed as signUp metadata.
 */
export function getStoredAttribution({
  storage = typeof localStorage === "undefined" ? null : localStorage,
} = {}) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * One human-readable line for admin surfaces. Priority: what the shop SAID
 * beats what the browser saw; utm beats raw referrer; "direct" is honest
 * about an empty capture. Returns "" when nothing was recorded at all.
 */
export function describeSignupSource(src) {
  if (!src || typeof src !== "object") return "";
  const parts = [];
  if (src.self_reported) parts.push(`"${src.self_reported}"`);
  if (src.utm_source) {
    parts.push(`utm: ${[src.utm_source, src.utm_medium, src.utm_campaign].filter(Boolean).join(" / ")}`);
  } else if (src.referrer) {
    try {
      parts.push(`via ${new URL(src.referrer).hostname}`);
    } catch {
      parts.push(`via ${String(src.referrer).slice(0, 80)}`);
    }
  }
  if (parts.length === 0) return src.landing || src.captured_at ? "direct" : "";
  return parts.join(" · ");
}
