// Sentry error monitoring — React client side.
//
// Gated on VITE_SENTRY_DSN: when the env var isn't set, every export
// here is a no-op so the bundle still loads (dev without a DSN,
// preview deploys before secrets are wired, etc.).
//
// PII policy: we only send opaque user IDs (auth_id) to Sentry, never
// email/name/shop_name. beforeSend scrubs email-looking strings from
// breadcrumbs + messages as a belt-and-braces guard against accidental
// leakage from a future error message.

import * as Sentry from "@sentry/react";

const DSN = import.meta.env.VITE_SENTRY_DSN;
const ENV = import.meta.env.MODE || "development";

let initialized = false;

export function initSentry() {
  if (initialized) return;
  if (!DSN) {
    // Quiet: this is intentional in local dev without a DSN. Logging
    // here would just noise up the console for every developer.
    return;
  }

  Sentry.init({
    dsn: DSN,
    environment: ENV,
    // Release tag matches the source-map upload done by sentryVitePlugin
    // (vite.config.js). Without this, Sentry can't pair events with the
    // uploaded maps and stack traces stay minified.
    release: import.meta.env.VITE_SENTRY_RELEASE,
    // Sample 100% of errors for now (we're at ~10 shops; volume is
    // tiny). Lower to 0.25 once we cross 100K events/mo.
    sampleRate: 1.0,
    // Performance traces — leave OFF by default. They eat free-tier
    // quota fast and we don't need them for "did something break?"
    // Flip to 0.1 if we want to investigate slow pages.
    tracesSampleRate: 0,
    // Session replay — paid feature. Skip.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,

    // Filter out browser noise that isn't actionable.
    ignoreErrors: [
      // Resize observer noise — fires on Chrome layout thrash, harmless.
      "ResizeObserver loop limit exceeded",
      "ResizeObserver loop completed with undelivered notifications",
      // User navigated away mid-fetch — not our bug.
      "AbortError",
      "Non-Error promise rejection captured",
      // Common browser extension noise.
      /chrome-extension:/,
      /moz-extension:/,
      // Stale-chunk errors after a fresh deploy. UpdateAvailableBanner
      // already catches these via chunkErrorHandler and prompts the
      // user to refresh — they're not real bugs. The patterns mirror
      // CHUNK_ERROR_PATTERNS in src/lib/chunkErrorHandler.js.
      /Failed to fetch dynamically imported module/i,
      /Importing a module script failed/i,
      /error loading dynamically imported module/i,
      /ChunkLoadError/i,
      /Loading chunk \d+ failed/i,
      // Instagram/Facebook in-app browser noise: their injected tracking
      // script (sendDataToNative / sendPageHideMessage) calls
      // window.webkit.messageHandlers after the bridge is torn down on
      // page-hide. Their code, not ours — fires on every link-in-bio visit.
      /window\.webkit\.messageHandlers/,
    ],

    beforeSend: scrubSentryEvent,
  });

  initialized = true;
}

/**
 * Set the current user for Sentry context. Call after login.
 *
 * Sends opaque auth_id + (optionally) shop_name. We do NOT send
 * email, person name, IP, etc. shop_name is included because it's
 * the most useful identifier for triage — Sentry's dashboard is
 * internal-only (only Joe sees it), so the privacy concern that
 * applies to shop-facing copy doesn't apply here.
 *
 * Also sets a "shop" tag so issues are filterable by shop in the
 * Sentry UI (Issues → search "shop:Biota Mfg").
 *
 * @param {string|null|undefined} authId
 * @param {{ shopName?: string|null }} [opts]
 */
export function setSentryUser(authId, opts = {}) {
  if (!initialized) return;
  if (!authId) {
    Sentry.setUser(null);
    Sentry.setTag("shop", undefined);
    return;
  }
  const shopName = opts.shopName && opts.shopName.trim() ? opts.shopName.trim() : null;
  const user = { id: authId };
  if (shopName) user.username = shopName; // shows in Sentry's user panel
  Sentry.setUser(user);
  Sentry.setTag("shop", shopName || undefined);
}

/** Clear user context on logout. */
export function clearSentryUser() {
  if (!initialized) return;
  Sentry.setUser(null);
  Sentry.setTag("shop", undefined);
}

/** Manually capture an exception (use in catch blocks where you want to keep going). */
export function captureException(err, context) {
  if (!initialized) return;
  Sentry.captureException(err, context ? { extra: context } : undefined);
}

/** Re-export ErrorBoundary so callers don't have to import Sentry directly. */
export const SentryErrorBoundary = Sentry.ErrorBoundary;

// Matches email-shaped strings. Replaces user@domain.com with
// [email]. Intentionally narrow — only the local-part + @ + domain
// pattern. Won't catch JWTs or other opaque secrets (those should
// never appear in user-facing error strings anyway).
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
function scrubEmails(str) {
  if (typeof str !== "string") return str;
  return str.replace(EMAIL_RE, "[email]");
}

/**
 * Sentry `beforeSend` handler. Exported (and called by name from
 * Sentry.init above) so the logic can be unit-tested without standing
 * up the SDK. Three responsibilities:
 *
 *   1. Normalize Supabase-shaped error objects into a real message +
 *      `source:supabase` tag, so they don't all group under the
 *      useless "Object captured as promise rejection" bucket.
 *   2. Scrub email-shaped strings from message, breadcrumbs, and
 *      exception values.
 *   3. Strip Authorization headers from captured request data.
 *
 * Always returns the event — even on internal failure — because
 * dropping events because of a scrubber bug is worse than the leak.
 *
 * @param {object} event  Sentry event payload
 * @param {{ originalException?: unknown }} [hint]
 * @returns {object} the (possibly mutated) event
 */
export function scrubSentryEvent(event, hint) {
  try {
    // ── Supabase error normalizer ──────────────────────────────
    // Supabase RPC + REST errors are plain objects shaped like
    // { code, details, hint, message } — NOT Error instances.
    // When code does `if (error) throw error`, the thrown thing
    // has no stack trace, so Sentry captures it as the generic
    // "Object captured as promise rejection with keys: code,
    // details, hint, message" group. Useless for debugging.
    const original = hint?.originalException;
    if (
      original &&
      typeof original === "object" &&
      !(original instanceof Error) &&
      "message" in original &&
      ("code" in original || "details" in original || "hint" in original)
    ) {
      const codeStr = original.code ? ` (code=${original.code})` : "";
      const wrapped = `Supabase: ${original.message}${codeStr}`;
      event.message = wrapped;
      if (event.exception?.values?.length) {
        event.exception.values = event.exception.values.map((ex) => ({
          ...ex,
          type: "SupabaseError",
          value: wrapped,
        }));
      }
      event.tags = { ...(event.tags || {}), source: "supabase" };
    }

    // Strip email-looking strings from the top-level message.
    if (event.message) event.message = scrubEmails(event.message);

    // Strip from breadcrumbs (these can leak user input).
    if (Array.isArray(event.breadcrumbs)) {
      event.breadcrumbs = event.breadcrumbs.map((b) => {
        if (b?.message) b.message = scrubEmails(b.message);
        if (b?.data?.url) b.data.url = scrubEmails(b.data.url);
        return b;
      });
    }

    // Strip from exception messages too.
    if (event.exception?.values) {
      event.exception.values = event.exception.values.map((ex) => {
        if (ex?.value) ex.value = scrubEmails(ex.value);
        return ex;
      });
    }

    // Strip Authorization headers from request data — Sentry's
    // request integration sometimes captures these on fetch errors.
    if (event.request?.headers) {
      delete event.request.headers.authorization;
      delete event.request.headers.Authorization;
    }
  } catch {
    // Never let a scrubber error block the report.
  }
  return event;
}
