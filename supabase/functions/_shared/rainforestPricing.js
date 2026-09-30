// What a shop pays InkTracker to process a payment through Rainforest (pure).
//
// Joe, 2026-09-30: "match QB pricing". Shops pay exactly what QuickBooks
// Payments charges them today, so switching costs them nothing; the gap
// between this price and Rainforest's real cost (card-network cost + 0.30% +
// 30¢ for cards, 20¢ for bank) is InkTracker's margin.
//
//   card: 2.99%, no fixed fee, no cap   (QuickBooks' invoice card rate)
//   ach:  1.00%, no fixed fee, no cap   (QuickBooks' bank rate for most accounts)
//
// These are PLATFORM prices, set once for every shop. Rainforest takes the fee
// off each payment and pays InkTracker its total monthly; the shop sees it on
// the payment. Change them here and nowhere else — the payment page, the
// Account copy and the bookkeeping all read this module.

/** @typedef {"card" | "ach"} PayMethod */

export const PLATFORM_PRICING = Object.freeze({
  card: Object.freeze({ ratePct: 2.99, fixedCents: 0, capCents: null }),
  ach: Object.freeze({ ratePct: 1.0, fixedCents: 0, capCents: null }),
});

/** Normalise whatever a processor calls a method into "card" | "ach" | null. */
export function normalizePayMethod(raw) {
  const m = String(raw ?? "").trim().toLowerCase();
  if (["card", "credit_card", "debit_card", "credit", "debit"].includes(m)) return "card";
  if (["ach", "bank", "bank_account", "echeck", "e-check"].includes(m)) return "ach";
  return null;
}

/**
 * The fee on one payment, in whole cents. Integer maths only: the rate is
 * applied to integer cents and rounded half-up once, so a $1,040.00 card
 * payment is exactly 3110 (not 3109.6 drifting through floats).
 * Returns 0 for a non-positive or non-finite amount, never NaN.
 * @param {PayMethod} method
 * @param {number} amountCents
 * @param {typeof PLATFORM_PRICING} [pricing]
 */
export function platformFeeCents(method, amountCents, pricing = PLATFORM_PRICING) {
  const m = normalizePayMethod(method);
  const amt = Number(amountCents);
  if (!m || !Number.isFinite(amt) || amt <= 0 || !Number.isInteger(amt)) return 0;
  const p = pricing[m];
  // rate in hundredths of a percent → exact integer numerator
  const bp100 = Math.round(Number(p.ratePct) * 100); // 2.99% → 299
  let fee = Math.floor((amt * bp100 + 5000) / 10000) + (Number(p.fixedCents) || 0);
  if (p.capCents != null && Number.isFinite(Number(p.capCents))) fee = Math.min(fee, Number(p.capCents));
  return Math.max(0, fee);
}

/** What the shop nets from a payment after InkTracker's fee, in cents. */
export function shopNetCents(method, amountCents, pricing = PLATFORM_PRICING) {
  const amt = Number(amountCents);
  if (!Number.isFinite(amt) || amt <= 0) return 0;
  return amt - platformFeeCents(method, amt, pricing);
}

/** "2.99%" / "1%" — for customer- and shop-facing copy. */
export function formatRatePct(method, pricing = PLATFORM_PRICING) {
  const m = normalizePayMethod(method);
  if (!m) return "";
  return `${Math.round(pricing[m].ratePct * 100) / 100}%`;
}
