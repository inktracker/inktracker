import { describe, it, expect } from "vitest";
import { planPayoutDeposit, PAYOUT_PLAN } from "../rainforestPayout.js";

const account = { qb_bank_account_id: "35", qb_fee_account_id: "88" };
const dep = (over = {}) => ({ deposit_id: "dep_1", status: "SUCCEEDED", deposit_type: "FUNDING", amount: 0, created_at: "2026-10-03T12:00:00Z", deposit_fee_amount: { amount: 0 }, ...over });
const payin = (id, gross, fee) => ({ id, type: "PAYIN", gross_amount: { amount: gross }, billing_fees_amount: { amount: -fee }, net_amount: { amount: gross - fee } });
const ledger = (entries) => new Map(entries.map(([id, qb, amt]) => [id, { qb_payment_id: qb, amount_cents: amt }]));

describe("planPayoutDeposit", () => {
  it("clean payout → QB deposit that equals the bank to the cent", () => {
    const acts = [payin("pyi_1", 164300, 4913), payin("pyi_2", 129700, 1297)];
    const r = planPayoutDeposit({
      deposit: dep({ amount: 164300 + 129700 - 4913 - 1297 }),
      activities: acts,
      ledgerByPayin: ledger([["pyi_1", "501", 164300], ["pyi_2", "502", 129700]]),
      account,
    });
    expect(r.plan).toBe(PAYOUT_PLAN.POST);
    expect(r.feeCents).toBe(6210);
    expect(r.body.DepositToAccountRef).toEqual({ value: "35" });
    expect(r.body.TxnDate).toBe("2026-10-03");
    expect(r.body.Line.reduce((s, l) => s + Math.round(l.Amount * 100), 0)).toBe(r.netCents);
    expect(r.payinIds).toEqual(["pyi_1", "pyi_2"]);
  });

  it("per-deposit fee and fee adjustments are folded into the fee line", () => {
    const r = planPayoutDeposit({
      deposit: dep({ amount: 100000 - 2990 - 25 - 10, deposit_fee_amount: { amount: 25 } }),
      activities: [payin("pyi_1", 100000, 2990), { id: "adj_1", type: "ADJUSTMENT", gross_amount: { amount: -10 }, billing_fees_amount: { amount: 0 } }],
      ledgerByPayin: ledger([["pyi_1", "501", 100000]]),
      account,
    });
    expect(r.plan).toBe(PAYOUT_PLAN.POST);
    expect(r.feeCents).toBe(3025);
  });

  it("a payment not in QuickBooks yet → wait (the sweep retries)", () => {
    const r = planPayoutDeposit({ deposit: dep({ amount: 97010 }), activities: [payin("pyi_1", 100000, 2990)], ledgerByPayin: ledger([["pyi_1", null, 100000]]), account });
    expect(r).toEqual({ plan: PAYOUT_PLAN.WAIT, reason: "payment_not_yet_in_quickbooks" });
  });

  it("refunds, returns, chargebacks and outside payments → manual with a plain breakdown", () => {
    const r = planPayoutDeposit({
      deposit: dep({ amount: 1000 }),
      activities: [payin("pyi_1", 100000, 2990), { id: "rfd_1", type: "REFUND", gross_amount: { amount: -5000 } }, payin("pyi_x", 2000, 60)],
      ledgerByPayin: ledger([["pyi_1", "501", 100000]]),
      account,
    });
    expect(r.plan).toBe(PAYOUT_PLAN.MANUAL);
    expect(r.problems).toEqual(["A refund of $50.00.", "A $20.00 payment wasn't taken through InkTracker."]);
    expect(r.notify.title).toBe("Payout of $10.00 needs recording in QuickBooks");
  });

  it("amounts that don't add up, or accounts not mapped → manual, never a wrong entry", () => {
    const acts = [payin("pyi_1", 100000, 2990)];
    const led = ledger([["pyi_1", "501", 100000]]);
    expect(planPayoutDeposit({ deposit: dep({ amount: 97009 }), activities: acts, ledgerByPayin: led, account }).plan).toBe(PAYOUT_PLAN.MANUAL);
    expect(planPayoutDeposit({ deposit: dep({ amount: 97010 }), activities: acts, ledgerByPayin: led, account: {} }).problems[0]).toMatch(/Setup needed/);
    expect(planPayoutDeposit({ deposit: dep({ amount: 97010 }), activities: [payin("pyi_1", 99999, 2990)], ledgerByPayin: led, account }).plan).toBe(PAYOUT_PLAN.MANUAL);
  });

  it("not succeeded yet / billing deposits", () => {
    expect(planPayoutDeposit({ deposit: dep({ status: "PROCESSING" }), activities: [], ledgerByPayin: new Map(), account }).plan).toBe(PAYOUT_PLAN.SKIP);
    expect(planPayoutDeposit({ deposit: dep({ deposit_type: "BILLING" }), activities: [], ledgerByPayin: new Map(), account }).plan).toBe(PAYOUT_PLAN.MANUAL);
  });
});
