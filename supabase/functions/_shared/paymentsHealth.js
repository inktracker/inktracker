// InkTracker payments (Stripe) in the daily health check (pure, tested).
// The query side lives in systemHealthCheck; this decides what's wrong.
//
// What can go quietly wrong, and how it shows up in our own rows:
//   - Secrets missing while payments are switched on → nothing works.
//   - A live payment that brought money in but isn't in QuickBooks after a
//     day → the webhook or the nightly backstop is failing, and the customer
//     looks unpaid.
//   - A payment that didn't match an invoice → the shop was alerted, but if
//     it sits it's money nobody has recorded.
//   - A paid payout without its QuickBooks deposit after 6 days → the books
//     won't match the bank (the shop is told after 5).
// Test-mode rows never count: test money is never booked.

/** Ledger statuses that mean money came in (bank "processing" doesn't). */
export const MONEY_IN_STATUSES = Object.freeze(["succeeded", "disputed", "partially_refunded", "refunded", "charged_back"]);
export const STUCK_PAYMENT_HOURS = 24;
export const STUCK_PAYOUT_DAYS = 6;

/**
 * @param {object} a
 * @param {boolean} a.enabled          STRIPE_PAYMENTS_ENABLED
 * @param {boolean} a.hasSecretKey     STRIPE_CONNECT_SECRET_KEY set
 * @param {boolean} a.hasWebhookSecret STRIPE_CONNECT_WEBHOOK_SECRET set
 * @param {boolean} a.liveKey          the secret key is a live key
 * @param {number} [a.stuckPayments]    live, money in, not in QuickBooks after STUCK_PAYMENT_HOURS
 * @param {number} [a.unmatched]        live, money in, matched to no invoice
 * @param {number} [a.stuckPayouts]     live, paid, no QuickBooks deposit after STUCK_PAYOUT_DAYS
 * @returns {{ ok: boolean, detail: string }}
 */
export function stripePaymentsHealth({ enabled, hasSecretKey, hasWebhookSecret, liveKey, stuckPayments = 0, unmatched = 0, stuckPayouts = 0 }) {
  if (!enabled) return { ok: true, detail: "switched off" };
  const problems = [];
  if (!hasSecretKey) problems.push("STRIPE_CONNECT_SECRET_KEY missing");
  if (!hasWebhookSecret) problems.push("STRIPE_CONNECT_WEBHOOK_SECRET missing");
  if (stuckPayments > 0) problems.push(`${stuckPayments} payment${stuckPayments === 1 ? "" : "s"} not in QuickBooks after ${STUCK_PAYMENT_HOURS}h`);
  if (unmatched > 0) problems.push(`${unmatched} payment${unmatched === 1 ? "" : "s"} matched to no invoice`);
  if (stuckPayouts > 0) problems.push(`${stuckPayouts} payout${stuckPayouts === 1 ? "" : "s"} without a QuickBooks deposit after ${STUCK_PAYOUT_DAYS} days`);
  if (problems.length) return { ok: false, detail: problems.join("; ") };
  return { ok: true, detail: liveKey ? "live: all payments and payouts booked" : "test mode (nothing is booked)" };
}
