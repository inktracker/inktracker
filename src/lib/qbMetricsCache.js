// Tiny client-side cache for the QB dashboard metrics call. Without
// this, every load of Dashboard or Performance fires a fresh
// qbSync.getDashboardMetrics — which paginates through every invoice
// in QB. Most users don't need real-time AR/Revenue numbers; a
// 5-minute window strikes a reasonable balance between freshness and
// API politeness. The Refresh button on each page bypasses the cache
// when the user genuinely wants fresh numbers.
//
// Keyed by shopOwner email so two shops on the same browser don't
// cross-pollinate (e.g. an admin who's also a broker for another
// shop). On miss / expired / different shop, callers re-fetch.

const STORAGE_KEY = "inktracker:qb-metrics-cache";
const DEFAULT_TTL_MS = 5 * 60 * 1000;

function safeReadJson(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function safeWriteJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or disabled (private window) — silently no-op.
  }
}

// Pure helper so tests can pin the freshness logic without mocking
// localStorage.
export function isCacheFresh(entry, shopOwner, now = Date.now(), ttlMs = DEFAULT_TTL_MS) {
  if (!entry || typeof entry !== "object") return false;
  if (!entry.metrics) return false;
  if (entry.shopOwner !== shopOwner) return false;
  if (typeof entry.savedAt !== "number") return false;
  return now - entry.savedAt < ttlMs;
}

export function readMetricsCache(shopOwner, now = Date.now(), ttlMs = DEFAULT_TTL_MS) {
  const entry = safeReadJson(STORAGE_KEY);
  if (!isCacheFresh(entry, shopOwner, now, ttlMs)) return null;
  return entry.metrics;
}

export function writeMetricsCache(shopOwner, metrics, now = Date.now()) {
  if (!shopOwner || !metrics) return;
  safeWriteJson(STORAGE_KEY, { shopOwner, metrics, savedAt: now });
}

export function clearMetricsCache() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

export const QB_METRICS_TTL_MS = DEFAULT_TTL_MS;
