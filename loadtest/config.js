// Shared config + safety guards for InkTracker k6 load tests.
//
// Everything is parameterized by environment variables so the same scripts
// run against a LOCAL stack, a STAGING project, or (read-only) prod — without
// editing code. Defaults point at a local Supabase + Vite dev server.
//
// Env vars:
//   BASE_URL        frontend origin           (default http://localhost:5173)
//   SUPABASE_URL    Supabase functions origin (default http://localhost:54321)
//   ANON_KEY        Supabase anon key         (required for function calls)
//   SHOP_OWNER      shop owner email          (default joe@biotamfg.co)
//   ALLOW_NONLOCAL  set to "1" to permit destructive tests off localhost
//
// Run examples are in loadtest/README.md.

export const BASE_URL = __ENV.BASE_URL || "http://localhost:5173";
export const SUPABASE_URL = __ENV.SUPABASE_URL || "http://localhost:54321";
export const ANON_KEY = __ENV.ANON_KEY || "";
export const SHOP_OWNER = __ENV.SHOP_OWNER || "joe@biotamfg.co";

// ── Safety guard ───────────────────────────────────────────────────────────
// The quote-wizard test creates rows and calls supplier APIs. Running it
// against production would pollute the live DB, burn email/API credits, and
// hammer S&S / AS Colour. We hard-block anything that looks like prod unless
// the operator explicitly sets ALLOW_NONLOCAL=1 (you almost never should).
const PROD_MARKERS = ["inktracker.app", "vercel.app"];

function looksLocal(url) {
  return /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(url);
}

function looksProd(url) {
  return PROD_MARKERS.some((m) => url.includes(m));
}

// Call at the top of any script that has SIDE EFFECTS (writes, supplier calls,
// emails). Aborts the run unless the target is local or the override is set.
export function assertSafeTarget() {
  const allow = __ENV.ALLOW_NONLOCAL === "1";
  const targets = [BASE_URL, SUPABASE_URL];

  for (const t of targets) {
    if (looksProd(t)) {
      throw new Error(
        `REFUSING TO RUN: "${t}" looks like PRODUCTION. This test has side ` +
          `effects (creates quotes, calls S&S/AS Colour, can send emails). ` +
          `Point BASE_URL/SUPABASE_URL at a local or staging stack instead.`,
      );
    }
  }

  const allLocal = targets.every(looksLocal);
  if (!allLocal && !allow) {
    throw new Error(
      `REFUSING TO RUN: target is not localhost and ALLOW_NONLOCAL is not set. ` +
        `If you really mean to test a staging project, re-run with ` +
        `ALLOW_NONLOCAL=1 — and make sure Stripe/QB/email are in test mode.`,
    );
  }
}

export function requireAnonKey() {
  if (!ANON_KEY) {
    throw new Error(
      `ANON_KEY is required to call edge functions. For local: copy the anon ` +
        `key printed by "supabase start" into ANON_KEY. Example: ` +
        `ANON_KEY=eyJ... k6 run loadtest/quote-wizard.js`,
    );
  }
}

export function fnUrl(name) {
  return `${SUPABASE_URL}/functions/v1/${name}`;
}

export function fnHeaders() {
  return { "Content-Type": "application/json", apikey: ANON_KEY };
}

// Default pass/fail thresholds. A test "fails" (non-zero exit) if these are
// breached — so CI or you can trust a green run. Tune to your SLOs.
export const THRESHOLDS = {
  http_req_failed: ["rate<0.01"], // <1% of requests error
  http_req_duration: ["p(95)<800", "p(99)<2000"], // 95% under 800ms
};
