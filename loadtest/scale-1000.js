// scale-1000.js — models PEAK concurrency for a 1000-shop tenant base, to find
// the real capacity bottleneck before it finds you in production.
//
// ⚠️  HAS SIDE EFFECTS / EXTERNAL CALLS (supplier lookups + reads). assertSafeTarget()
//     blocks it against production. Run it against a STAGING Supabase branch with
//     supplier APIs in test/stub mode. This is the Phase-1 measurement in
//     docs/road-to-1000.md — it needs a safe target (Supabase branching on Pro).
//
//   ANON_KEY=eyJ... SUPABASE_URL=https://<branch>.supabase.co ALLOW_NONLOCAL=1 \
//     k6 run loadtest/scale-1000.js
//
// ── Traffic model (documented assumptions — tune to your real numbers) ────────
//   1000 shops, but not all active at once. Assume ~10% concurrently active at
//   peak (~100 shops), each generating a small stream of requests from the owner
//   plus a few customers on public quote/payment pages. That lands around a few
//   hundred requests/sec at peak. We drive by ARRIVAL RATE (req/s), not VU count,
//   so latency degradation shows up as the ceiling — the point of a capacity test.
//
//   Mix (weighted): 55% public shop-config reads (getPublicShopConfig), 35% the
//   money path (supplier style lookups), 10% heavier bursts. Adjust WEIGHTS and
//   PEAK_RPS from what Phase-1 telemetry shows your real distribution to be.

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

// Peak request rate to drive toward. Override with SCALE_PEAK_RPS to push for the
// ceiling (e.g. 600) once the lower rungs pass cleanly.
const PEAK_RPS = Number(__ENV.SCALE_PEAK_RPS || 300);

export function setup() {
  assertSafeTarget(); // refuses prod
  requireAnonKey();
}

export const options = {
  scenarios: {
    peak: {
      executor: "ramping-arrival-rate",
      startRate: 10,
      timeUnit: "1s",
      preAllocatedVUs: 100,
      maxVUs: 800, // headroom so VU starvation doesn't masquerade as backend latency
      stages: [
        { duration: "1m", target: Math.round(PEAK_RPS * 0.25) }, // warm the caches/pool
        { duration: "2m", target: Math.round(PEAK_RPS * 0.6) },  // sustained load
        { duration: "2m", target: PEAK_RPS },                     // push to peak
        { duration: "2m", target: PEAK_RPS },                     // hold at peak — watch p95/p99
        { duration: "1m", target: 0 },
      ],
    },
  },
  thresholds: {
    ...THRESHOLDS,
    // Capacity test: a rising p99 or error rate under sustained peak IS the
    // finding. Keep the bar realistic for edge-fn + Postgres round-trips.
    http_req_duration: ["p(95)<1500", "p(99)<4000"],
    http_req_failed: ["rate<0.02"],
  },
};

const SS_STYLES = ["1717", "3001", "5000", "G500"];
const AC_STYLES = ["5001", "5050", "4001"];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// Weighted request mix — sums to 100.
const WEIGHTS = { config: 55, supplier: 35, burst: 10 };

export default function () {
  const roll = Math.random() * 100;

  if (roll < WEIGHTS.config) {
    // Public shop-config read — the highest-volume anonymous surface (every
    // quote/payment page load hits it). Read-only.
    const r = http.post(
      fnUrl("getPublicShopConfig"),
      JSON.stringify({ shopOwner: SHOP_OWNER }),
      { headers: fnHeaders() },
    );
    check(r, { "getPublicShopConfig ok": (x) => x.status === 200 });
  } else if (roll < WEIGHTS.config + WEIGHTS.supplier) {
    // Money path — supplier style lookup (edge fn -> supplier API + Postgres).
    const r = http.post(
      fnUrl("ssLookupStyle"),
      JSON.stringify({ styleNumber: pick(SS_STYLES), shopOwner: SHOP_OWNER }),
      { headers: fnHeaders() },
    );
    check(r, { "ssLookupStyle ok": (x) => x.status === 200 });
  } else {
    // Heavier burst — a shopper flipping between two suppliers quickly.
    const a = http.post(
      fnUrl("ssLookupStyle"),
      JSON.stringify({ styleNumber: pick(SS_STYLES), shopOwner: SHOP_OWNER }),
      { headers: fnHeaders() },
    );
    const b = http.post(
      fnUrl("acLookupStyle"),
      JSON.stringify({ styleCode: pick(AC_STYLES), shopOwner: SHOP_OWNER }),
      { headers: fnHeaders() },
    );
    check(a, { "ss burst ok": (x) => x.status === 200 });
    check(b, { "ac burst ok": (x) => x.status === 200 });
  }

  sleep(Math.random() * 0.5); // small think time between a VU's iterations
}
