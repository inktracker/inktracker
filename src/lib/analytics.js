// Product/marketing analytics — landing-page funnel, click tracking, and
// geo/referrer breakdowns. Powered by PostHog, viewed in its own dashboard
// (this is InkTracker's marketing data, deliberately NOT a screen inside the
// shop app).
//
// Gated on TWO conditions, both required before a single event fires:
//   1. VITE_POSTHOG_KEY is set. No key → every export is a no-op, so local
//      dev and preview deploys (before the key is wired) load clean. Mirrors
//      the sentry.js pattern.
//   2. The visitor accepted cookies. We reuse the existing consent gate
//      (hasNonEssentialConsent) so Decline / pending truly means no tracking
//      cookies, matching the promise on the CookieConsent banner.
//
// posthog-js is loaded via dynamic import so its ~50 KB stays off the critical
// path — the landing page paints first, analytics boots on idle afterwards.
// Events captured before the import resolves are buffered and flushed on load
// (only while analytics is eligible, so the queue can't grow unbounded when
// there's no key or no consent).

import { hasNonEssentialConsent } from "@/components/CookieConsent";

const KEY = import.meta.env.VITE_POSTHOG_KEY;
const HOST = import.meta.env.VITE_POSTHOG_HOST || "https://us.i.posthog.com";

let ph = null; // resolved posthog instance once loaded
let loading = false;
const queue = []; // [event, props] captured before load resolves

function eligible() {
  return Boolean(KEY) && hasNonEssentialConsent();
}

function flush() {
  if (!ph) return;
  while (queue.length) {
    const [event, props] = queue.shift();
    try {
      ph.capture(event, props);
    } catch {
      /* never let a capture failure bubble into product code */
    }
  }
}

/**
 * Boot PostHog. Safe to call repeatedly and early — it no-ops when already
 * up, when there's no key, or before consent. Call it on idle from main.jsx
 * AND from the CookieConsent Accept handler, so tracking starts the moment a
 * visitor accepts without needing a page reload.
 */
export function initAnalytics() {
  if (ph || loading) return;
  if (!eligible()) return;
  loading = true;
  import("posthog-js")
    .then(({ default: posthog }) => {
      posthog.init(KEY, {
        api_host: HOST,
        // Autocapture = the "where are people clicking" answer, no manual
        // instrumentation of every button.
        autocapture: true,
        // SPA route changes emit $pageview (this is a Vite SPA — a plain
        // capture_pageview:true would only fire once on hard load).
        capture_pageview: "history_change",
        // $pageleave powers bounce rate + time-on-page in the dashboard.
        capture_pageleave: true,
        // Only build person profiles for identified users (trial signups),
        // keeping anonymous landing traffic cheap against the free tier.
        person_profiles: "identified_only",
        // Honor browser Do Not Track as an extra courtesy on top of consent.
        respect_dnt: true,
      });
      ph = posthog;
      flush();
    })
    .catch(() => {
      // Network/adblock failure — leave analytics off, never surface to users.
      loading = false;
    });
}

/**
 * Record a funnel/interaction event. Buffers until PostHog is ready, drops
 * silently when analytics isn't eligible. Never throws.
 */
export function track(event, props) {
  if (ph) {
    try {
      ph.capture(event, props);
    } catch {
      /* swallow */
    }
    return;
  }
  if (eligible()) queue.push([event, props]);
}

/**
 * Tie subsequent events to a known user (called at trial activation) so the
 * signup→trial conversion can be attributed and de-anonymized in PostHog.
 * `id` should be the opaque auth id — never email/name (PII policy, see
 * sentry.js).
 */
export function identify(id, props) {
  if (ph && id) {
    try {
      ph.identify(id, props);
    } catch {
      /* swallow */
    }
  }
}
