// Decide WHAT a customer is charged when they pay a quote through Rainforest,
// and build the data that rides with the charge (pure, unit-tested).
//
// The rule that makes this safe: the customer pays what the LIVE QuickBooks
// invoice says is still owed — never InkTracker's saved total. QuickBooks is
// the billing authority (its tax, its edits, any deposit already applied to
// it), so charging its Balance means a deposit, a remaining balance, and a
// QB-side discount are all correct without re-deriving them here, and a
// second click after a payment cannot double-charge (the balance is 0).
//
// Routing mirrors the QuickBooks pay-link routing on QuotePayment exactly:
//   - broker quotes are never payable here (the shop's invoice is the broker's
//     wholesale bill, not the end client's price)
//   - an unpaid requested deposit, while only the deposit invoice exists,
//     pays the DEPOSIT invoice
//   - otherwise the FINAL invoice, whose balance is the remainder after any
//     settled deposit
//   - a quote whose charges changed after its QB invoice was made is blocked
//     (the invoice would under-charge) — same rule as isQbStale, but checked
//     against the live invoice rather than the stored mirror.

import { platformFeeCents, normalizePayMethod } from "./rainforestPricing.js";

export const NOT_PAYABLE = Object.freeze({
  BROKER: "broker_quote",
  NO_INVOICE: "no_qb_invoice",
  STALE: "invoice_out_of_date",
  PAID: "already_paid",
  DEPOSIT_PAID_AWAITING_FINAL: "deposit_paid_awaiting_final_invoice",
  BAD_AMOUNT: "invalid_amount",
});

const toCents = (dollars) => {
  const n = Number(dollars);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};

const isBrokerQuote = (q) => Boolean(q?.broker_id || q?.broker_email);

/** Unpaid requested deposit, mirroring src/lib/deposits.js depositRequested. */
function depositRequested(q) {
  if (q?.deposit_paid) return false;
  const snap = Number(q?.deposit_amount);
  if (Number.isFinite(snap) && snap > 0) return true;
  return (Number(q?.deposit_pct) || 0) > 0;
}

/**
 * Pre-tax mismatch between the saved quote and the LIVE QB invoice. Same test
 * as src/lib/quotes/qbStale.js (tax is excluded because QuickBooks computes it
 * from the address and may legitimately differ).
 */
export function liveInvoiceIsStale(quote, liveInvoice) {
  if (!quote || !liveInvoice) return false;
  const savedTotal = Number(quote.total);
  const qbTotal = Number(liveInvoice.TotalAmt);
  if (!Number.isFinite(savedTotal) || !Number.isFinite(qbTotal)) return false;
  const savedPreTax = savedTotal - (Number(quote.tax) || 0);
  const qbPreTax = qbTotal - (Number(liveInvoice?.TxnTaxDetail?.TotalTax) || 0);
  return Math.abs(savedPreTax - qbPreTax) > 0.01;
}

/**
 * @param {object} args
 * @param {object} args.quote            saved quote row
 * @param {boolean} args.depositsEnabled the DEPOSITS_ENABLED kill switch
 * @param {object|null} args.liveFinal   live QB Invoice for quote.qb_invoice_id
 * @param {object|null} args.liveDeposit live QB Invoice for quote.qb_deposit_invoice_id
 * @returns {{ ok: true, kind: "deposit"|"balance"|"full", qbInvoiceId: string, amountCents: number }
 *         | { ok: false, reason: string }}
 */
export function choosePayTarget({ quote, depositsEnabled, liveFinal = null, liveDeposit = null }) {
  if (isBrokerQuote(quote)) return { ok: false, reason: NOT_PAYABLE.BROKER };

  const depositDue = Boolean(depositsEnabled) &&
    depositRequested(quote) &&
    Boolean(quote?.qb_deposit_invoice_id) &&
    !quote?.qb_invoice_id;

  if (depositDue) {
    if (!liveDeposit) return { ok: false, reason: NOT_PAYABLE.NO_INVOICE };
    const cents = toCents(liveDeposit.Balance);
    if (!Number.isFinite(cents)) return { ok: false, reason: NOT_PAYABLE.BAD_AMOUNT };
    if (cents <= 0) return { ok: false, reason: NOT_PAYABLE.DEPOSIT_PAID_AWAITING_FINAL };
    return { ok: true, kind: "deposit", qbInvoiceId: String(liveDeposit.Id ?? quote.qb_deposit_invoice_id), amountCents: cents };
  }

  if (!quote?.qb_invoice_id || !liveFinal) return { ok: false, reason: NOT_PAYABLE.NO_INVOICE };
  if (liveInvoiceIsStale(quote, liveFinal)) return { ok: false, reason: NOT_PAYABLE.STALE };

  const balance = toCents(liveFinal.Balance);
  const total = toCents(liveFinal.TotalAmt);
  if (!Number.isFinite(balance) || !Number.isFinite(total)) return { ok: false, reason: NOT_PAYABLE.BAD_AMOUNT };
  if (balance <= 0) return { ok: false, reason: NOT_PAYABLE.PAID };
  return {
    ok: true,
    kind: balance === total ? "full" : "balance",
    qbInvoiceId: String(liveFinal.Id ?? quote.qb_invoice_id),
    amountCents: balance,
  };
}

/**
 * Idempotency key for creating the payment session. Same quote + same QB
 * invoice + same amount → same key, so a double-click or a refresh reuses one
 * session; once a payment lands the balance changes and a new key is minted.
 */
export function payinIdempotencyKey({ quoteId, qbInvoiceId, amountCents }) {
  return `it-payin:${quoteId}:${qbInvoiceId}:${amountCents}`;
}

/**
 * Metadata that rides with the payment and comes back on every webhook.
 * `inktracker_quote_id` is the id of the paid DOCUMENT — a quote, or an
 * invoice row when `inktracker_doc_type` is "invoice" (the order-then-invoice
 * flow). The
 * webhook must NOT trust it on its own (it is round-tripped through the
 * processor) — it re-reads the quote and checks the shop owns the merchant
 * that received the money before applying anything.
 */
export function buildPayinMetadata({ quote, target, docType = "quote" }) {
  const isInvoice = docType === "invoice";
  return {
    inktracker_doc_type: isInvoice ? "invoice" : "quote",
    inktracker_quote_id: String(quote?.id ?? ""),
    quote_number: String((isInvoice ? quote?.invoice_id : quote?.quote_id) ?? ""),
    shop_owner: String(quote?.shop_owner ?? ""),
    qb_invoice_id: String(target?.qbInvoiceId ?? ""),
    pay_kind: String(target?.kind ?? ""),
  };
}

/**
 * Invoice detail for business cards (card-network "Level 2 / Level 3" data,
 * Visa's CEDP). Built from the LIVE QuickBooks invoice so the lines always add
 * up to what QuickBooks bills. Line items are only included when the charge is
 * the WHOLE invoice ("full"); a deposit or remaining balance carries summary
 * data only, because line items that don't add up to the charged amount
 * disqualify the transaction rather than help it.
 *
 * Processor-neutral shape; the edge function maps it to Rainforest's field
 * names.
 * @returns {{ customerCode: string, poNumber: string, taxCents: number|null,
 *             lineItems: Array<{description:string, quantity:number, unitCents:number, totalCents:number}> }}
 */
export function buildInvoiceDetail({ quote, target, liveInvoice }) {
  const customerCode = String(liveInvoice?.CustomerRef?.value ?? quote?.customer_id ?? "").slice(0, 25);
  const poNumber = String(quote?.quote_id ?? liveInvoice?.DocNumber ?? "").slice(0, 25);
  if (!liveInvoice || target?.kind !== "full") {
    return { customerCode, poNumber, taxCents: null, lineItems: [] };
  }
  const taxCents = toCents(liveInvoice?.TxnTaxDetail?.TotalTax ?? 0);
  const lines = (Array.isArray(liveInvoice.Line) ? liveInvoice.Line : [])
    .filter((l) => l?.DetailType === "SalesItemLineDetail")
    .map((l) => {
      const totalCents = toCents(l.Amount);
      const qty = Number(l.SalesItemLineDetail?.Qty) || 1;
      return {
        description: String(l.Description ?? l.SalesItemLineDetail?.ItemRef?.name ?? "Item").replace(/\s+/g, " ").trim().slice(0, 35),
        quantity: qty,
        unitCents: Math.round(totalCents / qty),
        totalCents,
      };
    });
  // Discount lines and rounding can make lines + tax ≠ charged amount. Send
  // lines only when they reconcile to the cent; otherwise summary only.
  const discountCents = (Array.isArray(liveInvoice.Line) ? liveInvoice.Line : [])
    .filter((l) => l?.DetailType === "DiscountLineDetail")
    .reduce((s, l) => s + toCents(l.Amount), 0);
  const sum = lines.reduce((s, l) => s + l.totalCents, 0) - discountCents + (Number.isFinite(taxCents) ? taxCents : 0);
  const reconciles = discountCents === 0 && Number.isFinite(taxCents) && sum === target.amountCents &&
    lines.every((l) => Number.isFinite(l.totalCents));
  return {
    customerCode,
    poNumber,
    taxCents: Number.isFinite(taxCents) ? taxCents : null,
    lineItems: reconciles ? lines : [],
  };
}

/** The fee this payment will carry, for the shop-facing breakdown. */
export function previewFee({ method, amountCents }) {
  const m = normalizePayMethod(method);
  return m ? { method: m, feeCents: platformFeeCents(m, amountCents), netCents: amountCents - platformFeeCents(m, amountCents) } : null;
}
