// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { isCacheFresh, readMetricsCache, writeMetricsCache, clearMetricsCache, QB_METRICS_TTL_MS } from "../qbMetricsCache";

const NOW = 1_700_000_000_000;
const SHOP = "joe@biotamfg.co";

beforeEach(() => {
  // jsdom provides localStorage; clear between tests.
  try { localStorage.clear(); } catch { /* ignore */ }
});

describe("isCacheFresh", () => {
  it("returns false for null / undefined / non-object", () => {
    expect(isCacheFresh(null, SHOP, NOW)).toBe(false);
    expect(isCacheFresh(undefined, SHOP, NOW)).toBe(false);
    expect(isCacheFresh("a string", SHOP, NOW)).toBe(false);
  });

  it("returns false when metrics field is missing", () => {
    expect(isCacheFresh({ shopOwner: SHOP, savedAt: NOW }, SHOP, NOW)).toBe(false);
  });

  it("returns false when shopOwner doesn't match (cross-shop guard)", () => {
    const entry = { shopOwner: "other@example.com", metrics: { x: 1 }, savedAt: NOW };
    expect(isCacheFresh(entry, SHOP, NOW)).toBe(false);
  });

  it("returns false when savedAt is missing or not a number", () => {
    expect(isCacheFresh({ shopOwner: SHOP, metrics: { x: 1 } }, SHOP, NOW)).toBe(false);
    expect(isCacheFresh({ shopOwner: SHOP, metrics: { x: 1 }, savedAt: "now" }, SHOP, NOW)).toBe(false);
  });

  it("returns true when entry is within the default TTL", () => {
    const entry = { shopOwner: SHOP, metrics: { x: 1 }, savedAt: NOW - 60_000 }; // 1 min ago
    expect(isCacheFresh(entry, SHOP, NOW)).toBe(true);
  });

  it("returns false when entry is older than TTL", () => {
    const entry = { shopOwner: SHOP, metrics: { x: 1 }, savedAt: NOW - QB_METRICS_TTL_MS - 1 };
    expect(isCacheFresh(entry, SHOP, NOW)).toBe(false);
  });

  it("respects a custom TTL (e.g. 60s for testing)", () => {
    const entry = { shopOwner: SHOP, metrics: { x: 1 }, savedAt: NOW - 30_000 };
    expect(isCacheFresh(entry, SHOP, NOW, 60_000)).toBe(true);
    expect(isCacheFresh(entry, SHOP, NOW, 10_000)).toBe(false);
  });
});

describe("read / write / clear (localStorage integration)", () => {
  it("write then read round-trips the metrics for the same shop", () => {
    const metrics = { revenueLast30Days: 1234.56, openInvoicesCount: 3 };
    writeMetricsCache(SHOP, metrics, NOW);
    expect(readMetricsCache(SHOP, NOW)).toEqual(metrics);
  });

  it("read returns null for a different shop than what was cached", () => {
    writeMetricsCache(SHOP, { x: 1 }, NOW);
    expect(readMetricsCache("someone-else@example.com", NOW)).toBeNull();
  });

  it("read returns null once TTL has elapsed", () => {
    writeMetricsCache(SHOP, { x: 1 }, NOW);
    expect(readMetricsCache(SHOP, NOW + QB_METRICS_TTL_MS + 1)).toBeNull();
  });

  it("clearMetricsCache wipes the entry — subsequent reads miss", () => {
    writeMetricsCache(SHOP, { x: 1 }, NOW);
    expect(readMetricsCache(SHOP, NOW)).toEqual({ x: 1 });
    clearMetricsCache();
    expect(readMetricsCache(SHOP, NOW)).toBeNull();
  });

  it("writeMetricsCache is a no-op without shopOwner or metrics (defensive)", () => {
    writeMetricsCache(null, { x: 1 }, NOW);
    writeMetricsCache(SHOP, null, NOW);
    expect(readMetricsCache(SHOP, NOW)).toBeNull();
  });
});
