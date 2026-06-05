// frontend.js — load test the SPA shell + static asset delivery.
//
// This is the SAFE-ANYWHERE test: it only GETs pages and assets, no writes,
// no supplier calls, no emails. It measures how the frontend (Vercel CDN +
// the SPA bootstrap) holds up under concurrent visitors — e.g. the traffic
// spike when you post a launch link.
//
// Note: InkTracker is a client-rendered SPA, so every route returns the same
// index.html shell quickly; the real work happens in the browser. This test
// therefore mostly stresses CDN + edge, which is exactly what a launch-day
// traffic burst hits first.
//
//   k6 run loadtest/frontend.js
//   BASE_URL=https://inktracker.app k6 run loadtest/frontend.js   # read-only, OK on prod
//
// Load shape: ramp 0->50 VUs over 30s, hold 50 for 1m, ramp down. Adjust the
// stages to model the spike you actually expect.

import http from "k6/http";
import { check, group, sleep } from "k6";
import { BASE_URL, THRESHOLDS } from "./config.js";

export const options = {
  stages: [
    { duration: "30s", target: 50 }, // ramp up
    { duration: "1m", target: 50 },  // hold
    { duration: "20s", target: 0 },  // ramp down
  ],
  thresholds: THRESHOLDS,
};

export default function () {
  group("landing", () => {
    const res = http.get(`${BASE_URL}/`);
    check(res, { "landing 200": (r) => r.status === 200 });
  });

  group("public quote wizard page", () => {
    const res = http.get(`${BASE_URL}/QuoteRequest`);
    check(res, { "wizard 200": (r) => r.status === 200 });
  });

  // Simulate a visitor reading the page before acting.
  sleep(Math.random() * 3 + 1);
}
