// Shop timezone — a module-level variable set on auth from shops.timezone.
// Mirrors the loadShopPricingConfig pattern in src/components/shared/pricing.jsx.
//
// Why a module-level variable instead of context: time-sensitive helpers
// (todayStr, nowLocal, fmtDate eventually) are called outside of React
// render — from event builders, useMemo deps, etc. — and threading the
// timezone through every prop chain would be churn for no benefit.
//
// Falls back to the user's browser timezone when nothing is set, so an
// unconfigured shop keeps working exactly as it did before.

let _shopTz = null;

const BROWSER_TZ = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
})();

/**
 * Called from AuthContext after the shop row is loaded.
 * Pass null/undefined to clear (sign-out, no shop record, etc.).
 */
export function loadShopTimezone(tz) {
  _shopTz = (typeof tz === "string" && tz.trim()) ? tz.trim() : null;
}

/**
 * The timezone to use for "what day is it for this shop" decisions.
 * Returns the configured shop timezone, falling back to the browser's.
 */
export function getShopTimezone() {
  return _shopTz || BROWSER_TZ;
}

/**
 * Today's date in the shop's timezone as a YYYY-MM-DD string.
 * Used by calendar grids to highlight "today" correctly regardless of
 * where the user's browser thinks they are.
 */
export function todayInShopTz(now = new Date()) {
  return now.toLocaleDateString("en-CA", { timeZone: getShopTimezone() });
}

/**
 * Returns { year, month } in the shop's timezone (month is 0-indexed
 * to match JS Date conventions).
 */
export function nowInShopTz(now = new Date()) {
  const s = todayInShopTz(now);
  const [y, m] = s.split("-").map(Number);
  return { year: y, month: m - 1 };
}

// ─── Picker options ─────────────────────────────────────────────────────────
// Curated list — covers ~95% of US shops + a handful of international anchors.
// "Other" lets the user paste any IANA tz. Keep alphabetized within groups.
export const SHOP_TIMEZONE_OPTIONS = [
  { value: "",                    label: "Use browser default" },
  // US / Canada
  { value: "America/New_York",    label: "Eastern (New York, Toronto)" },
  { value: "America/Chicago",     label: "Central (Chicago, Dallas)" },
  { value: "America/Denver",      label: "Mountain (Denver, Salt Lake City)" },
  { value: "America/Phoenix",     label: "Mountain — no DST (Phoenix, AZ)" },
  { value: "America/Los_Angeles", label: "Pacific (Los Angeles, Seattle)" },
  { value: "America/Anchorage",   label: "Alaska" },
  { value: "Pacific/Honolulu",    label: "Hawaii" },
  // International anchors
  { value: "Europe/London",       label: "United Kingdom (London)" },
  { value: "Europe/Berlin",       label: "Central Europe (Berlin, Paris)" },
  { value: "Australia/Sydney",    label: "Australia (Sydney)" },
  { value: "Asia/Tokyo",          label: "Japan (Tokyo)" },
];

// Exposed for tests so they can reset module state between cases.
export function _resetForTests() {
  _shopTz = null;
}
