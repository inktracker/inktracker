// A Rainforest payout (deposit) → one QuickBooks Deposit (pure, tested).
//
// Source: GET /v1/deposits/{id} + GET /v1/deposits/{id}/activity. Each
// activity carries gross_amount (+ payins, − refunds/returns/chargebacks),
// billing_fees_amount (negative), net_amount and the payin's metadata.
//
// Pilot rule: only CLEAN payouts are booked automatically — payins that
// InkTracker already recorded in QuickBooks, their fees, and fee-type
// adjustments. Anything else (a refund, bank return, chargeback, a payment
// taken outside InkTracker) means a person should decide how it hits the
// books, so the plan says "manual" with a plain breakdown for the shop.
// A payin that isn't in QuickBooks yet means "wait" (the sweep retries).

import { buildQbDepositBody } from "./rainforestQbBooks.js";

const cents = (x) => {
  const v = Number(x?.amount ?? x);
  return Number.isInteger(v) ? v : NaN;
};
const money = (c) => `$${(Math.abs(c) / 100).toFixed(2)}`;

export const PAYOUT_PLAN = Object.freeze({ POST: "post", WAIT: "wait", MANUAL: "manual", SKIP: "skip" });

/**
 * @param {object} a
 * @param {object} a.deposit      Rainforest deposit object
 * @param {Array}  a.activities   deposit activity rows
 * @param {Map<string, {qb_payment_id:string|null, amount_cents:number}>} a.ledgerByPayin
 * @param {{qb_bank_account_id:string|null, qb_fee_account_id:string|null}} a.account
 */
export function planPayoutDeposit({ deposit, activities, ledgerByPayin, account }) {
  if (!deposit?.deposit_id) return { plan: PAYOUT_PLAN.SKIP, reason: "no_deposit" };
  if (String(deposit.status ?? "").toUpperCase() !== "SUCCEEDED") return { plan: PAYOUT_PLAN.SKIP, reason: "not_succeeded" };
  if (String(deposit.deposit_type ?? "FUNDING").toUpperCase() !== "FUNDING") {
    return manual(deposit, ["This is a billing deposit, not customer payments."]);
  }
  const net = cents(deposit.amount);
  if (!Number.isInteger(net)) return manual(deposit, ["The payout amount couldn't be read."]);

  const list = Array.isArray(activities) ? activities : [];
  const payments = [];
  let feeCents = cents(deposit.deposit_fee_amount) || 0;
  const problems = [];
  let waiting = false;

  for (const a of list) {
    const type = String(a?.type ?? "").toUpperCase();
    const gross = cents(a?.gross_amount);
    const fee = cents(a?.billing_fees_amount) || 0;
    if (type === "PAYIN") {
      const led = ledgerByPayin?.get(String(a?.id ?? a?.payin_id ?? ""));
      if (!led) { problems.push(`A ${money(gross)} payment wasn't taken through InkTracker.`); continue; }
      if (!led.qb_payment_id) { waiting = true; continue; }
      if (gross !== led.amount_cents) { problems.push(`A payment shows ${money(gross)} here but ${money(led.amount_cents)} in QuickBooks.`); continue; }
      payments.push({ qbPaymentId: led.qb_payment_id, grossCents: gross });
      feeCents += -fee;
    } else if (type === "ADJUSTMENT" && gross <= 0) {
      // Platform/processing charges (e.g. card lookup fees) — part of fees.
      feeCents += -gross + -fee;
    } else if (type === "REFUND") {
      problems.push(`A refund of ${money(gross)}.`);
    } else if (type === "ACH_RETURN") {
      problems.push(`A returned bank payment of ${money(gross)}.`);
    } else if (type === "CHARGEBACK") {
      problems.push(`A chargeback of ${money(gross)}.`);
    } else {
      problems.push(`An item Rainforest labels ${type || "unknown"} (${money(gross)}).`);
    }
  }

  if (problems.length) return manual(deposit, problems);
  if (waiting) return { plan: PAYOUT_PLAN.WAIT, reason: "payment_not_yet_in_quickbooks" };
  if (payments.length === 0) return manual(deposit, ["No customer payments in this payout."]);

  const built = buildQbDepositBody({
    bankAccountId: account?.qb_bank_account_id,
    feeAccountId: account?.qb_fee_account_id,
    txnDate: String(deposit.created_at ?? "").slice(0, 10),
    payoutId: deposit.deposit_id,
    payments,
    feeCents,
    netCents: net,
  });
  if (!built.ok) {
    return built.reason === "does_not_match_bank"
      ? manual(deposit, [`Payments minus fees (${money(built.detail.grossTotal - built.detail.fee)}) don't equal what reached the bank (${money(net)}).`])
      : manual(deposit, [`Setup needed: ${built.reason.replace(/_/g, " ")}.`]);
  }
  return { plan: PAYOUT_PLAN.POST, body: built.body, feeCents, netCents: net, payinIds: list.filter((a) => String(a?.type).toUpperCase() === "PAYIN").map((a) => String(a.id ?? a.payin_id)) };
}

function manual(deposit, problems) {
  const net = cents(deposit?.amount);
  return {
    plan: PAYOUT_PLAN.MANUAL,
    reason: "needs_review",
    problems,
    notify: {
      severity: "warning",
      title: `Payout of ${Number.isInteger(net) ? money(net) : "an unknown amount"} needs recording in QuickBooks`,
      body: `InkTracker didn't record this payout in QuickBooks automatically because it includes: ${problems.join(" ")} Record the deposit in QuickBooks using your bank feed.`,
      metadata: { processor: "rainforest", deposit_id: deposit?.deposit_id ?? null },
    },
  };
}
