// QuickBooks bookkeeping for payments collected through Stripe (pure).
//
// Goal: each shop's QuickBooks matches its bank account without anyone
// reconciling by hand. Two entries, the standard way QuickBooks models a
// processor that pays out in batches net of fees:
//
//   1. PAYMENT, one per customer payment: the GROSS amount, linked to the
//      invoice (so the invoice shows paid), deposited to Undeposited Funds.
//      That's exactly what QuickBooks Payments does today, so reports,
//      A/R and "paid" all behave the same.
//
//   2. DEPOSIT, one per Stripe payout to the shop's bank: pulls those
//      payments out of Undeposited Funds, plus one negative line for the
//      processing fees booked to an expense account. Its total equals the
//      money that actually hit the bank, so the bank feed matches 1:1.
//
// Every builder REFUSES (returns { ok:false }) rather than posting something
// that doesn't add up. A wrong entry in a shop's books is worse than a missing
// one — a missing one gets flagged and fixed; a wrong one gets filed.

const dollars = (cents) => Number((Number(cents) / 100).toFixed(2));

/** Pick the shop's QB PaymentMethod for card/bank, by name. Null if none. */
export function pickQbPaymentMethod(methods, method) {
  const list = Array.isArray(methods) ? methods : [];
  const want = method === "ach"
    ? ["ach", "bank transfer", "bank", "e-check", "echeck"]
    : ["credit card", "card", "visa"];
  const byName = (n) => list.find((m) => String(m?.Name ?? "").trim().toLowerCase() === n);
  for (const n of want) {
    const hit = byName(n);
    if (hit?.Id) return { value: String(hit.Id), name: hit.Name };
  }
  if (method !== "ach") {
    const cc = list.find((m) => m?.Type === "CREDIT_CARD" && !/quickbooks payments/i.test(m?.Name ?? ""));
    if (cc?.Id) return { value: String(cc.Id), name: cc.Name };
  }
  return null;
}

// QuickBooks caps Payment.PaymentRefNum at 21 characters.
const refNum = (id) => String(id ?? "").slice(-21);

/**
 * QB Payment body for one successful Stripe payment.
 * @param {object} a
 * @param {string} a.qbInvoiceId      invoice being paid
 * @param {string} a.customerRefValue the invoice's CustomerRef.value
 * @param {number} a.amountCents      GROSS amount the customer paid
 * @param {string} a.payinId          Stripe PaymentIntent id (dedupe + audit)
 * @param {string} a.txnDate          YYYY-MM-DD the payment succeeded
 * @param {{value:string}|null} [a.paymentMethodRef]
 * @param {number} [a.platformFeeCents] shown in the memo only
 * @param {number} [a.applyCents] portion applied to the invoice (default: all).
 *        Less than amountCents only when the customer overpaid (two payments
 *        raced); QuickBooks keeps the rest as a customer credit.
 */
export function buildQbPaymentBody(a) {
  const amt = Number(a?.amountCents);
  if (!a?.qbInvoiceId || !a?.customerRefValue) return { ok: false, reason: "missing_invoice_or_customer" };
  if (!Number.isInteger(amt) || amt <= 0) return { ok: false, reason: "invalid_amount" };
  if (!a?.payinId) return { ok: false, reason: "missing_payin_id" };
  const apply = a?.applyCents === undefined ? amt : Number(a.applyCents);
  if (!Number.isInteger(apply) || apply < 0 || apply > amt) return { ok: false, reason: "invalid_apply_amount" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(a?.txnDate ?? ""))) return { ok: false, reason: "invalid_date" };

  // Fees (Stripe's + InkTracker's) come off the payout, so they're booked
  // on its Deposit, not here.
  const feeNote = " · processing fees are on the payout deposit";
  const body = {
    CustomerRef: { value: String(a.customerRefValue) },
    TotalAmt: dollars(amt),
    TxnDate: a.txnDate,
    PaymentRefNum: refNum(a.payinId),
    PrivateNote: `Paid online via InkTracker (Stripe payment ${a.payinId})${feeNote}` +
      (apply < amt ? ` · OVERPAID $${dollars(amt - apply).toFixed(2)} left as customer credit — refund it` : ""),
    Line: apply > 0 ? [{
      Amount: dollars(apply),
      LinkedTxn: [{ TxnId: String(a.qbInvoiceId), TxnType: "Invoice" }],
    }] : [],
    // No DepositToAccountRef → QuickBooks files it in Undeposited Funds,
    // which is where the payout Deposit below collects it from.
  };
  if (a?.paymentMethodRef?.value) body.PaymentMethodRef = { value: String(a.paymentMethodRef.value) };
  return { ok: true, body };
}

/**
 * Find the QB Payment we already posted for a payin, among the customer's
 * recent payments. Matched by PaymentRefNum (last 21 chars of the payin id)
 * or the full payin id in the memo. The payments come from a CustomerRef
 * query — a filter qbSync already relies on in production — rather than
 * filtering on PaymentRefNum, which QuickBooks may not support.
 * @returns {object|null}
 */
export function findBookedPayment(payments, payinId) {
  const id = String(payinId ?? "");
  if (!id) return null;
  const ref = refNum(id);
  return (Array.isArray(payments) ? payments : []).find((p) =>
    String(p?.PaymentRefNum ?? "") === ref || String(p?.PrivateNote ?? "").includes(id)) ?? null;
}

/**
 * QB Deposit body for one Stripe payout to the shop's bank.
 *
 * @param {object} a
 * @param {string} a.bankAccountId      shop's QB bank account the payout lands in
 * @param {string} a.feeAccountId       shop's QB expense account for processing fees
 * @param {string} a.txnDate            YYYY-MM-DD of the payout
 * @param {string} a.payoutId           Stripe payout id (audit)
 * @param {Array<{qbPaymentId:string, grossCents:number}>} a.payments
 *        payments in this payout, each already posted to QB
 * @param {number} a.feeCents           total fees withheld from this payout
 * @param {number} a.netCents           what Stripe says hit the bank
 * @param {Array<{amountCents:number, accountId:string, memo:string}>} [a.adjustments]
 *        other signed movements in the payout (refunds, returns, disputes)
 */
export function buildQbDepositBody(a) {
  if (!a?.bankAccountId) return { ok: false, reason: "no_bank_account_mapped" };
  if (!a?.feeAccountId) return { ok: false, reason: "no_fee_account_mapped" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(a?.txnDate ?? ""))) return { ok: false, reason: "invalid_date" };
  const payments = Array.isArray(a?.payments) ? a.payments : [];
  if (payments.length === 0) return { ok: false, reason: "no_payments" };
  if (payments.some((p) => !p?.qbPaymentId)) return { ok: false, reason: "payment_not_yet_in_quickbooks" };
  if (payments.some((p) => !Number.isInteger(Number(p?.grossCents)) || Number(p.grossCents) <= 0)) {
    return { ok: false, reason: "invalid_payment_amount" };
  }
  const fee = Number(a?.feeCents);
  const net = Number(a?.netCents);
  if (!Number.isInteger(fee) || fee < 0 || !Number.isInteger(net)) return { ok: false, reason: "invalid_fee_or_net" };
  const adjustments = Array.isArray(a?.adjustments) ? a.adjustments : [];
  if (adjustments.some((x) => !x?.accountId || !Number.isInteger(Number(x?.amountCents)))) {
    return { ok: false, reason: "invalid_adjustment" };
  }

  const grossTotal = payments.reduce((s, p) => s + Number(p.grossCents), 0);
  const adjTotal = adjustments.reduce((s, x) => s + Number(x.amountCents), 0);
  // The deposit MUST equal what hit the bank, to the cent.
  if (grossTotal - fee + adjTotal !== net) {
    return { ok: false, reason: "does_not_match_bank", detail: { grossTotal, fee, adjTotal, net } };
  }

  const Line = payments.map((p) => ({
    Amount: dollars(p.grossCents),
    LinkedTxn: [{ TxnId: String(p.qbPaymentId), TxnType: "Payment", TxnLineId: "0" }],
  }));
  if (fee > 0) {
    Line.push({
      Amount: -dollars(fee),
      DetailType: "DepositLineDetail",
      Description: `Processing fees — payout ${a.payoutId ?? ""}`.trim(),
      DepositLineDetail: { AccountRef: { value: String(a.feeAccountId) } },
    });
  }
  for (const x of adjustments) {
    Line.push({
      Amount: dollars(x.amountCents),
      DetailType: "DepositLineDetail",
      Description: String(x.memo ?? "Adjustment").slice(0, 4000),
      DepositLineDetail: { AccountRef: { value: String(x.accountId) } },
    });
  }
  return {
    ok: true,
    body: {
      DepositToAccountRef: { value: String(a.bankAccountId) },
      TxnDate: a.txnDate,
      PrivateNote: `Stripe payout ${a.payoutId ?? ""} via InkTracker`.trim(),
      Line,
    },
  };
}

/**
 * What to do in the books when money comes BACK after a payment was posted
 * (refund, ACH return, lost chargeback). Deliberately conservative for the
 * pilot: InkTracker never silently un-pays an invoice or edits the shop's
 * books on its own here — it records the event, flags the shop, and the
 * money movement shows up as a signed line on the next payout's Deposit so
 * the bank still matches. Returns the ledger + notification plan.
 */
export function planReversal({ kind, amountCents, payinId, quoteNumber, booked = true }) {
  const amt = Number(amountCents);
  const label = {
    refund: "Refund issued",
    ach_return: "Bank payment returned",
    chargeback_lost: "Chargeback lost",
  }[kind];
  if (!label || !Number.isInteger(amt) || amt <= 0) return { ok: false, reason: "invalid_reversal" };
  return {
    ok: true,
    ledgerStatus: kind === "refund" ? "refunded" : kind === "ach_return" ? "returned" : "charged_back",
    // The invoice stays "paid" in QB until the shop decides (re-invoice,
    // write off, or record a refund receipt) — flag it loudly instead.
    notify: {
      severity: kind === "refund" ? "info" : "alert",
      title: `${label}: $${dollars(amt).toFixed(2)} on ${quoteNumber || "a payment"}`,
      body: kind === "refund"
        ? `The refund is on its way back to your customer. In QuickBooks, record a refund receipt against this invoice so your books match — it will come out of your next payout.`
        : !booked
          ? `Your customer's bank returned the payment before it cleared, so it was never recorded in QuickBooks and the invoice is still open. Ask the customer to pay another way. The bank's return fee comes out of your next payout.`
          : `Your customer's payment was reversed, so this invoice is effectively unpaid. It will come out of your next payout. Follow up with the customer and re-open the invoice in QuickBooks.`,
      metadata: { processor: "stripe", payin_id: payinId, kind, amount_cents: amt },
    },
  };
}
