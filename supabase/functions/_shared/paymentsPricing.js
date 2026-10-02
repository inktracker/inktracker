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

// ── Fees the customer pays (per shop, off by default) ───────────────────
// Joe, 2026-10-01: the quote shows the plain total with a note; the pay page
// adds the fee for the way the customer pays.
//   card: 2.99% on CREDIT cards only. US card rules: no surcharge on debit or
//         prepaid cards, never more than 3%, disclosed before the customer
//         pays, shown as its own line on the receipt (Stripe's receipt does).
//   bank: the shop's percentage, 0–1% (its all-in bank cost is 1%).
export const CARD_SURCHARGE_PCT = 2.99;
export const MAX_CARD_SURCHARGE_PCT = 3;
export const MAX_BANK_FEE_PCT = 1;
export const DEFAULT_BANK_FEE_PCT = 1;

/** Valid bank fee percent (0–1, two decimals) or null. */
export function normalizeBankFeePct(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > MAX_BANK_FEE_PCT) return null;
  return Math.round(n * 100) / 100;
}

/** The shop's fee settings from its processor_accounts row. */
export function customerFeeSettings(account) {
  const on = account?.customer_fees_enabled === true;
  return {
    enabled: on,
    cardPct: on ? CARD_SURCHARGE_PCT : 0,
    bankPct: on ? (normalizeBankFeePct(account?.bank_fee_pct) ?? 0) : 0,
  };
}

/**
 * Can the card surcharge run? It needs InkTracker's own card form (Stripe
 * Checkout can't tell credit from debit before charging), which needs the
 * platform's publishable key for the Stripe mode in use.
 */
export function cardFormKeyOk(publishableKey, live) {
  const pk = String(publishableKey ?? "");
  return live ? pk.startsWith("pk_live_") : pk.startsWith("pk_test_");
}

/** customerFeeSettings, with no card fee when the card form can't run. */
export function effectiveCustomerFees(account, { cardFormReady }) {
  const s = customerFeeSettings(account);
  return { ...s, cardPct: cardFormReady ? s.cardPct : 0 };
}

/**
 * The fee on one payment of `balanceCents`, in cents (half-up, integer
 * maths). Card: only a card Stripe reports as "credit" — debit, prepaid and
 * unknown cards pay no fee. Bank: the shop's percentage.
 * @param {{balanceCents:number, method:string, funding?:string|null, settings:{cardPct:number, bankPct:number}}} a
 */
export function customerFeeCents({ balanceCents, method, funding = null, settings }) {
  const amt = Number(balanceCents);
  const m = normalizePayMethod(method);
  if (!validAmount(amt) || !m || !settings) return 0;
  if (m === "card") {
    if (String(funding ?? "").toLowerCase() !== "credit") return 0;
    const pct = Math.min(Number(settings.cardPct) || 0, MAX_CARD_SURCHARGE_PCT);
    return pct > 0 ? pctCents(amt, pct) : 0;
  }
  const pct = Math.min(Number(settings.bankPct) || 0, MAX_BANK_FEE_PCT);
  return pct > 0 ? pctCents(amt, pct) : 0;
}

/** Largest fee a payment of `invoiceCents` can carry (bounds metadata we read back). */
export function maxCustomerFeeCents(invoiceCents) {
  const amt = Number(invoiceCents);
  return validAmount(amt) ? pctCents(amt, MAX_CARD_SURCHARGE_PCT) : 0;
}

const pctLabel = (p) => `${Math.round(Number(p) * 100) / 100}%`;

/**
 * The note on quotes, invoices and emails, or "" when the shop charges no
 * fees. Visa's wording: a SURCHARGE, assessed by the merchant, on credit
 * cards only, with its percentage. The pay page shows the exact amount.
 * @param {{enabled:boolean, cardPct:number, bankPct:number}} settings
 * @param {{shopName?:string|null}} [opts]
 */
export function customerFeeNote(settings, { shopName = null } = {}) {
  if (!settings?.enabled) return "";
  const who = String(shopName ?? "").trim() || "We";
  const card = settings.cardPct > 0
    ? `${who} ${who === "We" ? "add" : "adds"} a ${pctLabel(settings.cardPct)} surcharge to credit card payments. Debit cards have no surcharge.`
    : "";
  const bank = settings.bankPct > 0 ? `Bank transfer payments include a ${pctLabel(settings.bankPct)} fee.` : "Bank transfer has no fee.";
  return `${card} ${bank} The exact amount is shown before you pay.`.trim();
}

// States where card surcharges are banned (Visa's U.S. surcharge Q&A,
// version 02152024). Others (CO, MN, NJ, NY) have extra rules the owner
// confirms when turning fees on.
export const SURCHARGE_BANNED_STATES = Object.freeze({ CT: "Connecticut", ME: "Maine", MA: "Massachusetts", OK: "Oklahoma", PR: "Puerto Rico" });
export const SURCHARGE_RULES_STATES = Object.freeze({ CO: "Colorado", MN: "Minnesota", NJ: "New Jersey", NY: "New York" });

/** "CT" / "Connecticut" / "conn." → the banned state's name, else null. */
export function surchargeBannedState(state) {
  const raw = String(state ?? "").trim();
  if (!raw) return null;
  const up = raw.toUpperCase().replace(/\./g, "");
  if (SURCHARGE_BANNED_STATES[up]) return SURCHARGE_BANNED_STATES[up];
  const hit = Object.values(SURCHARGE_BANNED_STATES).find((n) => n.toUpperCase() === up);
  return hit ?? null;
}

/**
 * "$823.90 + $24.63 credit card surcharge = $848.53 charged." for shop
 * notices, so a total that's higher than the quote explains itself. "" when
 * the customer paid no fee.
 */
export function paidBreakdown(amountCents, feeCents, method) {
  const amt = Number(amountCents);
  const fee = Number(feeCents);
  if (!Number.isInteger(amt) || !Number.isInteger(fee) || fee <= 0 || fee >= amt) return "";
  const m = (c) => `$${(c / 100).toFixed(2)}`;
  const what = normalizePayMethod(method) === "ach" ? "bank fee" : "credit card surcharge";
  return `${m(amt - fee)} invoice + ${m(fee)} ${what} = ${m(amt)} charged.`;
}
