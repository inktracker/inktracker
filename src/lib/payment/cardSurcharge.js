// Credit-card surcharge DISCLOSURE (pure).
//
// Joe, 2026-09-29: "can we add a processing fee for cc transactions?
// something smooth that allows the client to choose if they want to pay the
// fee and use a card?"
//
// InkTracker does NOT charge the fee. QuickBooks Payments does — Intuit
// added native surcharging, the shop turns it on in QBO (Settings → Account
// and Settings → Sales → Invoice payments), and Intuit's own payment screen
// shows the fee as its own line and lets the customer pick their method.
// Intuit owns that because the compliance is theirs: card-network rules
// forbid surcharging debit/prepaid cards entirely (QBO auto-blocks debit,
// prepaid, Apple Pay, Amex and Discover when surcharging is on), cap the
// rate at the cost of acceptance, and require network registration; four
// jurisdictions (CT, ME, MA, PR) ban it outright. A hand-rolled fee line on
// a QB invoice would surcharge debit cards and breach Intuit's merchant
// agreement, so we never build one.
//
// What InkTracker owes the customer is DISCLOSURE. Without it they read a
// total here, click through, and meet a bigger number at QuickBooks — a
// surprise the shop then has to field, and the point-of-sale disclosure the
// card rules require. These helpers render that line on the payment page,
// the quote PDF and the quote email footer.
//
// Storage: shops.pricing_config.cardSurcharge = { enabled: bool, ratePct: number }

/** Intuit's published rate at the time of writing; the shop can correct it. */
export const DEFAULT_CARD_SURCHARGE_PCT = 2.9;
/** Visa/Mastercard hard ceiling — a rate above this is never compliant. */
export const MAX_CARD_SURCHARGE_PCT = 4;

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Read the shop's surcharge setting off its pricing_config.
 * Off unless explicitly enabled; a missing/junk rate falls back to the
 * default, and any rate is clamped to the network ceiling so a typo can't
 * publish a non-compliant number to a customer.
 * @returns {{ enabled: boolean, ratePct: number }}
 */
export function getCardSurcharge(pricingConfig) {
  const raw = pricingConfig?.cardSurcharge;
  if (!raw || raw.enabled !== true) return { enabled: false, ratePct: 0 };
  const n = Number(raw.ratePct);
  const ratePct = Number.isFinite(n) && n > 0
    ? Math.min(n, MAX_CARD_SURCHARGE_PCT)
    : DEFAULT_CARD_SURCHARGE_PCT;
  return { enabled: true, ratePct };
}

/** The fee a card payment of `total` would add, to the cent. 0 when off/invalid. */
export function cardFeeOn(total, ratePct) {
  const t = Number(total);
  const r = Number(ratePct);
  if (!Number.isFinite(t) || t <= 0 || !Number.isFinite(r) || r <= 0) return 0;
  return round2(t * (r / 100));
}

/** What the customer pays if they choose a card. */
export function cardTotalWith(total, ratePct) {
  const t = Number(total);
  if (!Number.isFinite(t) || t <= 0) return 0;
  return round2(t + cardFeeOn(t, ratePct));
}

const money = (n) => `$${Number(n).toFixed(2)}`;

/**
 * The customer-facing sentence. Deliberately does NOT promise a specific
 * fee-free method: Intuit's docs say the surcharge applies to ACH bank
 * transfers as well as credit cards, and which alternatives (PayPal, Venmo)
 * a given shop has enabled is not knowable from here. It states the fee,
 * the amount, and that QuickBooks shows the options and the final figure
 * before anything is charged — all true, and enough to remove the surprise.
 *
 * @returns {string} "" when surcharging is off or the total isn't payable.
 */
export function cardSurchargeNote({ total, ratePct, enabled = true }) {
  if (!enabled) return "";
  const fee = cardFeeOn(total, ratePct);
  if (fee <= 0) return "";
  return `Paying by credit card adds a ${formatRate(ratePct)}% processing fee ` +
    `(about ${money(fee)}, for ${money(cardTotalWith(total, ratePct))} total). ` +
    `QuickBooks shows every payment option and the final amount before you're charged.`;
}

/** 2.9 → "2.9", 3 → "3" — no trailing ".0" in customer copy. */
export function formatRate(ratePct) {
  const r = Number(ratePct);
  if (!Number.isFinite(r)) return "0";
  return String(Math.round(r * 100) / 100);
}
