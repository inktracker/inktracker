// A Stripe payout → one QuickBooks Deposit (pure, tested).
//
// Input is neutral (stripeWebhookAdapter.payoutItemsFromBalanceTransactions
// builds it from the payout's balance transactions): each item carries its
// gross amount, the fees Stripe took for it (Stripe's own fee + InkTracker's
// application fee, both come off the shop's balance) and whether InkTracker
// created it.
//
// Pilot rule: only CLEAN payouts are booked automatically — payments that
// InkTracker already recorded in QuickBooks, their fees, and fee-type
// charges. Anything else (a refund, bank return, dispute, or a sale the shop
// took in Stripe outside InkTracker — its own Stripe account can have those)
// means a person should decide how it hits the books, so the plan says
// "manual" with a plain breakdown for the shop. An InkTracker payment that
// isn't in QuickBooks yet means "wait" (the sweep retries).

import { buildQbDepositBody } from "./paymentsQbBooks.js";

const money = (c) => `$${(Math.abs(c) / 100).toFixed(2)}`;

export const PAYOUT_PLAN = Object.freeze({ POST: "post", WAIT: "wait", MANUAL: "manual", SKIP: "skip" });

// A payout still waiting on its payments after this long needs a person.
export const PAYOUT_WAIT_LIMIT_DAYS = 5;

/** Neutral payout item types. */
export const PAYOUT_ITEM = Object.freeze({
  PAYMENT: "payment",
  REFUND: "refund",
  ACH_RETURN: "ach_return",
  DISPUTE: "dispute",
  FEE: "fee",
  OTHER: "other",
});

/**
 * @param {object} a
 * @param {{id:string, status:string, amountCents:number, createdAt?:string}} a.payout
 * @param {Array<{type:string, payinId?:string|null, grossCents:number, feeCents:number, ours?:boolean, label?:string}>} a.items
 * @param {Map<string, {qb_payment_id:string|null, qb_invoice_id:string|null, amount_cents:number}>} a.ledgerByPayin
 * @param {{qb_bank_account_id:string|null, qb_fee_account_id:string|null}} a.account
 * @param {string|null} [a.txnDate] payout date in the shop's timezone (YYYY-MM-DD)
 * @param {Date} [a.now]
 */
export function planPayoutDeposit({ payout, items, ledgerByPayin, account, txnDate = null, now = new Date() }) {
  if (!payout?.id) return { plan: PAYOUT_PLAN.SKIP, reason: "no_payout" };
  if (String(payout.status ?? "").toLowerCase() !== "paid") return { plan: PAYOUT_PLAN.SKIP, reason: "not_paid" };
  const net = Number(payout.amountCents);
  if (!Number.isInteger(net)) return manual(payout, ["The payout amount couldn't be read."]);

  const list = Array.isArray(items) ? items : [];
  const payments = [];
  let feeCents = 0;
  const problems = [];
  const waitingFor = []; // reasons we're waiting, for the shop if it drags on
  const ageDays = (now.getTime() - new Date(payout.createdAt ?? now).getTime()) / (24 * 60 * 60 * 1000);

  for (const it of list) {
    const gross = Number(it?.grossCents);
    const fee = Number(it?.feeCents) || 0;
    if (!Number.isInteger(gross)) { problems.push("An item whose amount couldn't be read."); continue; }
    if (it.type === PAYOUT_ITEM.PAYMENT) {
      if (it.ours === false) { problems.push(`A ${money(gross)} sale taken in Stripe outside InkTracker.`); continue; }
      const led = ledgerByPayin?.get(String(it.payinId ?? ""));
      // Ours but not in the ledger yet: usually a lost event the nightly
      // backstop is about to recover — wait.
      if (!led) { waitingFor.push(`A ${money(gross)} payment InkTracker hasn't recorded.`); continue; }
      if (!led.qb_payment_id) {
        // Recorded but not booked. An unmatched payment is never booked
        // automatically, so waiting would be forever.
        if (led.qb_invoice_id === null) { problems.push(`A ${money(gross)} payment that didn't match an invoice.`); continue; }
        waitingFor.push(`A ${money(gross)} payment not yet recorded in QuickBooks.`);
        continue;
      }
      if (gross !== led.amount_cents) { problems.push(`A payment shows ${money(gross)} here but ${money(led.amount_cents)} in QuickBooks.`); continue; }
      payments.push({ qbPaymentId: led.qb_payment_id, grossCents: gross });
      feeCents += fee;
    } else if (it.type === PAYOUT_ITEM.FEE && gross <= 0) {
      // Stripe charges with no sale behind them (e.g. bank verification).
      feeCents += -gross + fee;
    } else if (it.type === PAYOUT_ITEM.REFUND) {
      problems.push(`A refund of ${money(gross)}.`);
    } else if (it.type === PAYOUT_ITEM.ACH_RETURN) {
      problems.push(`A returned bank payment of ${money(gross)}.`);
    } else if (it.type === PAYOUT_ITEM.DISPUTE) {
      problems.push(gross > 0 ? `A dispute reversed in your favour (${money(gross)} back).` : `A dispute of ${money(gross)}.`);
    } else {
      problems.push(`An item Stripe labels ${it.label || "other"} (${money(gross)}).`);
    }
  }

  if (problems.length) return manual(payout, [...problems, ...waitingFor]);
  if (waitingFor.length) {
    return ageDays > PAYOUT_WAIT_LIMIT_DAYS
      ? manual(payout, waitingFor)
      : { plan: PAYOUT_PLAN.WAIT, reason: "payment_not_yet_in_quickbooks" };
  }
  if (payments.length === 0) return manual(payout, ["No customer payments in this payout."]);

  const built = buildQbDepositBody({
    bankAccountId: account?.qb_bank_account_id,
    feeAccountId: account?.qb_fee_account_id,
    // The shop-local payout date from the caller; UTC date only as a fallback.
    txnDate: txnDate ?? String(payout.createdAt ?? "").slice(0, 10),
    payoutId: payout.id,
    payments,
    feeCents,
    netCents: net,
  });
  if (!built.ok) {
    return built.reason === "does_not_match_bank"
      ? manual(payout, [`Payments minus fees (${money(built.detail.grossTotal - built.detail.fee)}) don't equal what reached the bank (${money(net)}).`])
      : manual(payout, [`Setup needed: ${built.reason.replace(/_/g, " ")}.`]);
  }
  return {
    plan: PAYOUT_PLAN.POST,
    body: built.body,
    feeCents,
    netCents: net,
    payinIds: list.filter((i) => i.type === PAYOUT_ITEM.PAYMENT && i.payinId).map((i) => String(i.payinId)),
  };
}

function manual(payout, problems) {
  const net = Number(payout?.amountCents);
  return {
    plan: PAYOUT_PLAN.MANUAL,
    reason: "needs_review",
    problems,
    notify: {
      severity: "warning",
      title: `Payout of ${Number.isInteger(net) ? money(net) : "an unknown amount"} needs recording in QuickBooks`,
      body: `InkTracker didn't record this payout in QuickBooks automatically because it includes: ${problems.join(" ")} Record the deposit in QuickBooks using your bank feed.`,
      metadata: { processor: "stripe", payout_id: payout?.id ?? null },
    },
  };
}
