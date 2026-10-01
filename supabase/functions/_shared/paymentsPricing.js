// What a payment costs a shop on InkTracker payments (Stripe), and how much
// of that is InkTracker's (pure, unit-tested).
//
// Joe, 2026-09-30: "match QB pricing". The shop's ALL-IN cost per payment is
// what QuickBooks Payments charges today:
//
//   card: 2.99%, no fixed fee, no cap   (QuickBooks' invoice card rate)
//   ach:  1.00%, no fixed fee, no cap   (QuickBooks' bank rate for most accounts)
//
// Each shop has its own Stripe account (Connect Standard), so Stripe takes
// its own processing fee from the shop directly. InkTracker's cut is the
// APPLICATION FEE on top: the QuickBooks price minus Stripe's fee, never
// below zero. On a small card payment Stripe's 30¢ makes its fee higher than
// 2.99%, so InkTracker takes nothing and the shop pays Stripe's price — a
// few cents over QuickBooks (e.g. $1.75 vs $1.50 on $50).
//
// Stripe's standard US pricing (stripe.com/pricing, checked 2026-10-01):
//   card: 2.9% + 30¢ (international cards +1.5%, currency conversion +1% —
//         paid by the shop on top, like any Stripe merchant)
//   ach:  0.8%, capped at $5, plus $1.50 per instant bank verification
//         (Financial Connections; Checkout verifies every new bank login)
// CONFIRM in test mode that the verification fee lands on the shop's account
// (docs/stripe-payments.md). It's subtracted here so the shop never pays
// more than QuickBooks would for a bank payment.

/** @typedef {"card" | "ach"} PayMethod */

/** What the shop pays all-in (QuickBooks-matched). */
export const PLATFORM_PRICING = Object.freeze({
  card: Object.freeze({ ratePct: 2.99, fixedCents: 0, capCents: null }),
  ach: Object.freeze({ ratePct: 1.0, fixedCents: 0, capCents: null }),
});

/** Stripe's own fee to the shop's account. */
export const STRIPE_COST = Object.freeze({
  card: Object.freeze({ ratePct: 2.9, fixedCents: 30, capCents: null }),
  ach: Object.freeze({ ratePct: 0.8, fixedCents: 0, capCents: 500, verifyCents: 150 }),
});

/** Normalise whatever a processor calls a method into "card" | "ach" | null. */
export function normalizePayMethod(raw) {
  const m = String(raw ?? "").trim().toLowerCase();
  if (["card", "credit_card", "debit_card", "credit", "debit", "link"].includes(m)) return "card";
  if (["ach", "bank", "bank_account", "us_bank_account", "echeck", "e-check"].includes(m)) return "ach";
  return null;
}

const validAmount = (a) => Number.isFinite(a) && Number.isInteger(a) && a > 0;

// rate% of integer cents, rounded half-up once (integer maths: 2.99% of
// $1,040.00 is exactly 3110, not 3109.6 drifting through floats).
function pctCents(amt, ratePct) {
  const bp100 = Math.round(Number(ratePct) * 100); // 2.99% → 299
  return Math.floor((amt * bp100 + 5000) / 10000);
}

function priceCents(p, amt) {
  let fee = pctCents(amt, p.ratePct) + (Number(p.fixedCents) || 0);
  if (p.capCents != null && Number.isFinite(Number(p.capCents))) fee = Math.min(fee, Number(p.capCents));
  return fee + (Number(p.verifyCents) || 0);
}

/** What QuickBooks would charge the shop for this payment (cents). */
export function quickbooksPriceCents(method, amountCents, pricing = PLATFORM_PRICING) {
  const m = normalizePayMethod(method);
  const amt = Number(amountCents);
  if (!m || !validAmount(amt)) return 0;
  return priceCents(pricing[m], amt);
}

/** Stripe's own fee for this payment (cents). */
export function stripeCostCents(method, amountCents, cost = STRIPE_COST) {
  const m = normalizePayMethod(method);
  const amt = Number(amountCents);
  if (!m || !validAmount(amt)) return 0;
  return priceCents(cost[m], amt);
}

/**
 * InkTracker's application fee on one payment, in whole cents: the
 * QuickBooks price minus Stripe's fee, never negative. 0 for a bad amount.
 */
export function platformFeeCents(method, amountCents, pricing = PLATFORM_PRICING, cost = STRIPE_COST) {
  return Math.max(0, quickbooksPriceCents(method, amountCents, pricing) - stripeCostCents(method, amountCents, cost));
}

/** The shop's all-in cost (Stripe + InkTracker), cents. */
export function shopTotalFeeCents(method, amountCents) {
  return stripeCostCents(method, amountCents) + platformFeeCents(method, amountCents);
}

/** What the shop nets from a payment after all fees, in cents. */
export function shopNetCents(method, amountCents) {
  const amt = Number(amountCents);
  if (!validAmount(amt)) return 0;
  return amt - shopTotalFeeCents(method, amt);
}

/** "2.99%" / "1%" — for shop-facing copy. */
export function formatRatePct(method, pricing = PLATFORM_PRICING) {
  const m = normalizePayMethod(method);
  if (!m) return "";
  return `${Math.round(pricing[m].ratePct * 100) / 100}%`;
}
