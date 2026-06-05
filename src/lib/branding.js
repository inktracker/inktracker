// Per-shop brand-color resolver. One input color (hex) drives the
// primary CTA, step indicators, active states across every
// customer-facing surface (wizard now; email + /QuotePayment +
// /ArtApproval + PDFs in Phase 2).
//
// The "today's scheme" the app uses is a dark band over a brighter
// button. With one input color we derive a darker band via darken(...)
// so the visual rhythm carries no matter which color a shop picks.
//
// Stored in shops.brand_color as #rrggbb. NULL → DEFAULT_BRAND.

export const DEFAULT_BRAND = "#0d9488"; // teal-600 — the app-wide accent today

// Preset palette for the color picker UI. Chosen to span the common
// shop brand-vibe categories without offering bad-contrast options.
// Each is dark enough to keep white CTA text readable.
export const BRAND_PRESETS = Object.freeze([
  { label: "Teal",     hex: "#0d9488" }, // current default
  { label: "Forest",   hex: "#166534" },
  { label: "Navy",     hex: "#1e3a8a" },
  { label: "Slate",    hex: "#1f2937" },
  { label: "Burgundy", hex: "#991b1b" },
  { label: "Orange",   hex: "#c2410c" },
]);

const HEX_RE = /^#[0-9a-f]{6}$/i;

/**
 * Return the shop's brand color as a normalized #rrggbb string.
 * Falls back to DEFAULT_BRAND when the shop has no color set, or has
 * a value that doesn't match the hex contract (defense in depth — the
 * migration's CHECK constraint already enforces this on writes).
 */
export function brand(shop) {
  const c = shop?.brand_color;
  if (typeof c === "string" && HEX_RE.test(c.trim())) {
    return c.trim().toLowerCase();
  }
  return DEFAULT_BRAND;
}

/**
 * Multiply RGB channels by (1 - pct/100). pct=25 → 25% darker.
 * Used to derive header-band colors from the picked button color.
 * Returns the original hex if the input doesn't parse.
 */
export function darken(hex, pct = 25) {
  if (typeof hex !== "string") return hex;
  const m = HEX_RE.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[0].slice(1), 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const f = Math.max(0, 1 - pct / 100);
  const h = (v) => Math.round(v * f).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/**
 * Convenience for "valid brand color from raw input". Used by the
 * Account picker to validate before save. Returns the normalized
 * lowercase hex on success, null on invalid input.
 */
export function normalizeBrandColor(input) {
  if (typeof input !== "string") return null;
  const v = input.trim();
  return HEX_RE.test(v) ? v.toLowerCase() : null;
}

/**
 * Translucent version of a hex color — used for hover/tint backgrounds
 * that previously hardcoded `bg-teal-50` (~8% opacity teal). Returns an
 * rgba() string. Falls back to the input if it's not a valid hex.
 */
export function tint(hex, alpha = 0.08) {
  if (typeof hex !== "string") return hex;
  const m = HEX_RE.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[0].slice(1), 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
