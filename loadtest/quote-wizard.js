// quote-wizard.js — load test the MONEY PATH: the public quote wizard's
// supplier style-lookup calls (ssLookupStyle + acLookupStyle).
//
// This is the test that finds your real bottleneck — concurrent shoppers
// configuring quotes all hit these two edge functions, which in turn call the
// S&S Activewear and AS Colour APIs and your Postgres.
//
// ⚠️  HAS SIDE EFFECTS / EXTERNAL CALLS. assertSafeTarget() blocks it against
//     production. Run it against a LOCAL stack (supabase start) with the
//     supplier APIs stubbed, or a STAGING project with supplier test creds.
//     See loadtest/README.md for the stubbing recipe.
//
//   ANON_KEY=eyJ... k6 run loadtest/quote-wizard.js
//
// Payloads below mirror exactly what scripts/smoke-public-wizard-functions.mjs
// sends, which is exactly what the real anonymous wizard sends.

import http from "k6/http";
import { check, sleep } from "k6";
import {
  fnUrl,
  fnHeaders,
  SHOP_OWNER,
  THRESHOLDS,
  assertSafeTarget,
  requireAnonKey,
} from "./config.js";

// Aborts the whole run (once, before VUs start) if the target looks unsafe.
export function setup() {
  assertSafeTarget();
  requireAnonKey();
}

export const options = {
  stages: [
    { duration: "30s", target: 20 }, // ramp to 20 concurrent shoppers
    { duration: "1m", target: 20 },  // hold
    { duration: "20s", target: 0 },
  ],
  thresholds: {
    ...THRESHOLDS,
    // Supplier lookups are slower than static pages; relax p95 a bit.
    http_req_duration: ["p(95)<1500", "p(99)<4000"],
  },
};

// A few real style numbers the wizard would look up. Add more to widen the
// cache-miss surface (hitting the same style repeatedly is unrealistically easy
// on any caching layer).
const SS_STYLES = ["1717", "3001", "5000", "G500"];
const AC_STYLES = ["5001", "5050", "4001"];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export default function () {
  // S&S Activewear style lookup
  const ss = http.post(
    fnUrl("ssLookupStyle"),
    JSON.stringify({ styleNumber: pick(SS_STYLES), shopOwner: SHOP_OWNER }),
    { headers: fnHeaders() },
  );
  check(ss, {
    "ssLookupStyle responded": (r) => r.status === 200,
    "ssLookupStyle not auth-blocked": (r) => !String(r.body).includes("Unauthorized"),
  });

  sleep(Math.random() * 2 + 0.5); // shopper thinks between picks

  // AS Colour style lookup
  const ac = http.post(
    fnUrl("acLookupStyle"),
    JSON.stringify({ styleCode: pick(AC_STYLES), shopOwner: SHOP_OWNER }),
    { headers: fnHeaders() },
  );
  check(ac, {
    "acLookupStyle responded": (r) => r.status === 200,
    "acLookupStyle not auth-blocked": (r) => !String(r.body).includes("Unauthorized"),
  });

  sleep(Math.random() * 2 + 0.5);
}
