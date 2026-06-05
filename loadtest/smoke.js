// smoke.js — 1 virtual user, a handful of requests. Run this FIRST.
//
// Purpose: confirm the target is reachable and the basic routes respond
// before you turn up real load. No ramp, no concurrency — just a sanity check.
// Safe to run anywhere (it only does GETs against the frontend).
//
//   k6 run loadtest/smoke.js
//   BASE_URL=https://staging.example.com k6 run loadtest/smoke.js

import http from "k6/http";
import { check, sleep } from "k6";
import { BASE_URL } from "./config.js";

export const options = {
  vus: 1,
  iterations: 3,
  thresholds: {
    http_req_failed: ["rate==0"], // smoke test must be 100% clean
  },
};

export default function () {
  const routes = ["/", "/QuoteRequest", "/login"];
  for (const path of routes) {
    const res = http.get(`${BASE_URL}${path}`);
    check(res, {
      [`${path} -> 200`]: (r) => r.status === 200,
      [`${path} -> served HTML`]: (r) =>
        String(r.headers["Content-Type"] || "").includes("text/html"),
    });
    sleep(0.5);
  }
}
