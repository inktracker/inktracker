import { localDateStr } from "@/lib/dateRangeUtils";

// Tax-exemption helpers (Phase 2 of multi-state tax —
// docs/qb-multistate-tax-scope.md). A `tax_exempt` flag alone isn't
// audit-defensible: you need the type, certificate, coverage, and expiry.
//
// Mirrors the edge-side isExemptionActive in _shared/qbInvoice.js (different
// runtime, same rule) so the UI and the QB write agree on who's exempt.

export const EXEMPTION_TYPES = [
  { value: "resale",     label: "Resale" },
  { value: "government", label: "Government" },
  { value: "nonprofit",  label: "Nonprofit" },
  { value: "other",      label: "Other" },
];

export function exemptionTypeLabel(value) {
  return EXEMPTION_TYPES.find((t) => t.value === value)?.label || "";
}

/** Parse a free-text state list ("CA, nv tx") into normalized 2-letter codes. */
export function parseStateList(text) {
  return String(text ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z]{2}$/.test(s));
}

// Local calendar date, not UTC — toISOString() rolls to tomorrow after
// ~5pm Pacific, which flagged a cert expiring today as "expired" hours
// early on its last valid day (display-only badge).
const todayIso = () => localDateStr(new Date());

/** True when the cert has an expiry strictly before today. */
export function isExemptionExpired(customer, asOf = todayIso()) {
  const exp = String(customer?.exemption_expires_at ?? "").slice(0, 10);
  if (!exp) return false;
  return String(asOf).slice(0, 10) > exp;
}

/** True when the cert expires within `days` (and isn't already expired). */
export function isExemptionExpiringSoon(customer, days = 30, asOf = todayIso()) {
  const exp = String(customer?.exemption_expires_at ?? "").slice(0, 10);
  if (!exp) return false;
  if (isExemptionExpired(customer, asOf)) return false;
  const expMs = Date.parse(`${exp}T00:00:00Z`);
  const asOfMs = Date.parse(`${String(asOf).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(expMs) || Number.isNaN(asOfMs)) return false;
  return expMs - asOfMs <= days * 24 * 60 * 60 * 1000;
}

/**
 * Whether the exemption is active for a sale (optionally into a destination
 * state). Mirrors the edge rule: requires tax_exempt, not expired, and — for
 * scoped certs — covering the destination state when known.
 */
export function isExemptionActive(customer, { asOf = todayIso(), destinationState } = {}) {
  if (!customer?.tax_exempt) return false;
  if (isExemptionExpired(customer, asOf)) return false;
  const states = Array.isArray(customer?.exemption_states)
    ? customer.exemption_states.map((s) => String(s).trim().toUpperCase()).filter(Boolean)
    : [];
  if (states.length) {
    const dest = String(destinationState ?? "").trim().toUpperCase();
    if (dest) return states.includes(dest);
  }
  return true;
}

/** Short status for badges: 'none' | 'active' | 'expiring' | 'expired'. */
export function exemptionStatus(customer, asOf = todayIso()) {
  if (!customer?.tax_exempt) return "none";
  if (isExemptionExpired(customer, asOf)) return "expired";
  if (isExemptionExpiringSoon(customer, 30, asOf)) return "expiring";
  return "active";
}
