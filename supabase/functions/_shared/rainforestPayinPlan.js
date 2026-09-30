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
 * UNSPSC commodity family for the shop's goods (first 4 digits). 8212 =
 * printing services. CONFIRM with Rainforest (docs/rainforest-payments.md).
 */
export const COMMODITY_CODE = "8212";

// Split `total` cents across `weights` so the parts sum EXACTLY to total
// (largest remainder). Used to put invoice tax on the lines.
function allocate(total, weights) {
  const sum = weights.reduce((a, w) => a + w, 0);
  if (sum <= 0 || total === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((a, v) => a + v, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k][1]] += 1;
  return out;
}

/**
 * Card-network invoice data ("Level 2 / Level 3", Visa CEDP) in Rainforest's
 * `level_2_3` shape, built from the LIVE QuickBooks invoice.
 *
 * Level 2 (always): tax_amount, shipping_amount, order_number.
 * Level 3 (line_items) only when the charge is the WHOLE invoice ("full"),
 * there are no discount lines, and everything reconciles to the cent:
 *   Σ (quantity × unit_amount) + tax_amount + shipping_amount = charge.
 * A line whose total doesn't divide evenly by its quantity is sent as
 * quantity 1 at the line total, so the arithmetic always holds. Lines that
 * don't add up are never sent (they'd disqualify the payment, not help it).
 *
 * order_number must be unique per payment: the document number, plus the
 * pay kind for a deposit or remaining balance on the same document.
 *
 * @returns {object} level_2_3 payload
 */
export function buildLevel23({ docNumber, target, liveInvoice, shopPostalCode = null }) {
  const kind = target?.kind;
  const base = String(docNumber || liveInvoice?.DocNumber || "").slice(0, 20);
  const order_number = kind === "full" || !kind ? base : `${base}-${kind === "deposit" ? "DEP" : "BAL"}`;
  const invTax = toCents(liveInvoice?.TxnTaxDetail?.TotalTax ?? 0);
  const shipTo = String(liveInvoice?.ShipAddr?.PostalCode ?? liveInvoice?.BillAddr?.PostalCode ?? "").trim();

  const l23 = {
    // Tax only belongs to the payment that pays the invoice's lines. A
    // deposit invoice is untaxed; a partial balance reports 0 rather than
    // tax it didn't carry.
    tax_amount: kind === "full" && Number.isFinite(invTax) ? invTax : 0,
    shipping_amount: 0,
    order_number,
    commodity_code: COMMODITY_CODE,
    ...(shipTo ? { shipping_postal_code: shipTo.slice(0, 10), shipping_country: "US" } : {}),
    ...(shopPostalCode ? { shipping_from_postal_code: String(shopPostalCode).slice(0, 10) } : {}),
  };
  if (!liveInvoice || kind !== "full" || !Number.isFinite(invTax)) return l23;

  const all = Array.isArray(liveInvoice.Line) ? liveInvoice.Line : [];
  if (all.some((l) => l?.DetailType === "DiscountLineDetail")) return l23;
  const sales = all.filter((l) => l?.DetailType === "SalesItemLineDetail");
  if (sales.length === 0) return l23;

  const totals = sales.map((l) => toCents(l.Amount));
  if (totals.some((t) => !Number.isFinite(t) || t < 0)) return l23;
  const taxable = sales.map((l) => String(l.SalesItemLineDetail?.TaxCodeRef?.value ?? "").toUpperCase() !== "NON");
  const weights = totals.map((t, i) => (taxable[i] ? t : 0));
  const taxes = allocate(invTax, weights.some((w) => w > 0) ? weights : totals);
  const taxableBase = totals.reduce((a, t, i) => a + (taxes[i] > 0 ? t : 0), 0);
  const rate = taxableBase > 0 ? Math.round((invTax / taxableBase) * 100000) : 0;

  const line_items = sales.map((l, i) => {
    const qtyRaw = Number(l.SalesItemLineDetail?.Qty);
    const qty = Number.isInteger(qtyRaw) && qtyRaw > 0 && totals[i] % qtyRaw === 0 ? qtyRaw : 1;
    const desc = String(l.Description ?? l.SalesItemLineDetail?.ItemRef?.name ?? "Item").replace(/\s+/g, " ").trim();
    return {
      product_code: String(l.SalesItemLineDetail?.ItemRef?.value ?? l.Id ?? i + 1).slice(0, 12),
      commodity_code: COMMODITY_CODE,
      description: (qty === 1 && Number.isInteger(qtyRaw) && qtyRaw > 1 ? `${qtyRaw} x ${desc}` : desc).slice(0, 35),
      quantity: qty,
      unit_amount: totals[i] / qty,
      unit_of_measure: "EACH",
      total_amount: totals[i],
      tax_amount: taxes[i],
      tax_rate: taxes[i] > 0 ? rate : 0,
    };
  });
  const sum = line_items.reduce((a, li) => a + li.quantity * li.unit_amount, 0) + invTax;
  if (sum !== target.amountCents) return l23;
  return { ...l23, line_items };
}

/** The fee this payment will carry, for the shop-facing breakdown. */
export function previewFee({ method, amountCents }) {
  const m = normalizePayMethod(method);
  return m ? { method: m, feeCents: platformFeeCents(m, amountCents), netCents: amountCents - platformFeeCents(m, amountCents) } : null;
}
