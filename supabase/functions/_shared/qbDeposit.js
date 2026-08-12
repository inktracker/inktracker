// Deposit-path pure logic (docs/deposit-path-design.md).
//
// The deposit invoice is a TEMPORARY COLLECTION VEHICLE: a small, real QB
// invoice the customer pays through the normal Intuit share link. At
// final-invoice time its payment is MOVED onto the full invoice and the
// deposit invoice is VOIDED — the end state (one full invoice + linked
// Payment, Balance = remainder) is exactly what every existing scanner,
// paid-predicate, and pay-link flow already understands.
//
// Everything here is pure so the whole decision surface is unit-tested;
// qbSync/qbWebhook/qbReconcile do the I/O.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// QBO DocNumber is capped at 21 chars. quote ids are ~11 chars so the
// suffix always fits; the slice is defense for imported/odd ids.
export const DEPOSIT_DOC_SUFFIX = "-DEP";
export function depositDocNumber(quoteId) {
  const base = String(quoteId || "").slice(0, 21 - DEPOSIT_DOC_SUFFIX.length);
  return `${base}${DEPOSIT_DOC_SUFFIX}`;
}

// pullInvoices skip test: never import a deposit invoice (or its -rN
// DocNumber-collision revision) as a local invoice row.
export function isDepositDocNumber(docNumber) {
  return /-DEP(-r\d+)?$/.test(String(docNumber || ""));
}

/**
 * Deposit dollars for a doc — SNAPSHOT-first (deposit_amount is the
 * agreement; total × pct is only the pre-snapshot fallback). Edge-side
 * mirror of src/lib/deposits.js depositAmountFor — keep in lockstep.
 */
export function computeDepositAmount(doc) {
  const snap = Number(doc?.deposit_amount);
  if (Number.isFinite(snap) && snap > 0) return r2(snap);
  const pct = Number(doc?.deposit_pct) || 0;
  if (pct <= 0) return 0;
  const total = Number(doc?.total) || 0;
  return r2(total * (Math.min(100, Math.max(0, pct)) / 100));
}

/**
 * Whether sending this quote should mint a deposit invoice (instead of
 * the full invoice). Deposit already paid → no (full invoice with the
 * auto-post path handles it). No deposit → no.
 */
export function shouldMintDepositInvoice(quote) {
  if (!quote) return false;
  if (quote.deposit_paid) return false;
  return computeDepositAmount(quote) > 0.009;
}

/**
 * Build the QB deposit-invoice body. One NON-taxed line: the deposit is a
 * prepayment, not a sale — tax is assessed once, on the final invoice's
 * full lines. AllowOnline* flags mirror the main create path so the share
 * link can collect.
 */
export function buildDepositInvoiceBody({ qbCustomerId, docNumber, itemId, amount, quoteId, depositPct, billEmail, txnDate }) {
  const pctLabel = Number(depositPct) > 0 ? `${Number(depositPct)}% ` : "";
  const body = {
    CustomerRef: { value: String(qbCustomerId) },
    DocNumber: docNumber,
    TxnDate: txnDate,
    DueDate: txnDate, // due on receipt, same as the main create path
    AllowOnlineCreditCardPayment: true,
    AllowOnlineACHPayment: true,
    Line: [{
      DetailType: "SalesItemLineDetail",
      Amount: r2(amount),
      Description: `Deposit — ${pctLabel}for ${quoteId}. Applied to the final invoice.`,
      SalesItemLineDetail: {
        ItemRef: { value: String(itemId) },
        UnitPrice: r2(amount),
        Qty: 1,
        TaxCodeRef: { value: "NON" },
      },
    }],
    CustomerMemo: { value: `Deposit for ${quoteId}. The remaining balance is billed on the final invoice.` },
    PrivateNote: `InkTracker deposit invoice for ${quoteId}`,
  };
  if (billEmail) {
    body.BillEmail = { Address: billEmail };
  }
  return body;
}

// ── Settlement (runs inside createInvoice for the FINAL invoice) ────────────

export const DEPOSIT_SETTLE = Object.freeze({
  NONE: "none",                 // no deposit invoice on this doc
  MOVE_AND_VOID: "move_and_void", // paid → move payment(s), then void
  VOID_UNPAID: "void_unpaid",   // never paid → void, notify shop
  ALREADY_GONE: "already_gone", // voided/deleted previously (retry landed)
});

/**
 * Decide what settlement must do, from a live read of the deposit invoice.
 * `depositInvoice` is the QB Invoice entity or null (deleted/not found).
 */
export function decideDepositSettlement(depositInvoice) {
  if (!depositInvoice) return { action: DEPOSIT_SETTLE.ALREADY_GONE };
  const total = Number(depositInvoice.TotalAmt ?? 0);
  const balance = Number(depositInvoice.Balance ?? 0);
  // Voided invoices read TotalAmt 0 in QBO.
  if (total <= 0) return { action: DEPOSIT_SETTLE.ALREADY_GONE };
  if (balance < total - 0.009) {
    // Money applied (fully or partially paid) — every applied payment moves.
    return { action: DEPOSIT_SETTLE.MOVE_AND_VOID, collected: r2(total - balance) };
  }
  return { action: DEPOSIT_SETTLE.VOID_UNPAID };
}

/**
 * Payments linked to the deposit invoice, from a customer-scoped Payment
 * query (QBO SQL can't filter on LinkedTxn — filter client-side).
 */
export function paymentsLinkedToInvoice(payments, invoiceId) {
  const target = String(invoiceId);
  return (Array.isArray(payments) ? payments : []).filter((p) =>
    (p?.Line ?? []).some((l) =>
      (l?.LinkedTxn ?? []).some((t) => t?.TxnType === "Invoice" && String(t?.TxnId) === target),
    ),
  );
}

/**
 * Rewrite a Payment's application from the deposit invoice to the final
 * invoice. FULL-update body (txn Line changes can't ride sparse). Only
 * lines pointing at the deposit invoice are re-pointed; applications to
 * other invoices (shouldn't exist, but customers are creative in QBO)
 * stay untouched.
 *
 * `maxApply` (optional): the final invoice's open Balance. Re-pointed
 * applications are clamped so the total moved never exceeds it — QBO
 * rejects over-application outright, which would wedge settlement
 * forever (order edited below the deposit). A clamped remainder simply
 * becomes an unapplied customer credit on the Payment, matching the
 * order-edit warning copy ("QuickBooks will show a credit").
 */
export function buildPaymentRelinkBody(payment, depositInvoiceId, finalInvoiceId, maxApply) {
  const from = String(depositInvoiceId);
  const to = String(finalInvoiceId);
  let allowance = Number.isFinite(Number(maxApply)) ? Math.max(0, r2(maxApply)) : Infinity;
  let changed = false;
  const lines = [];
  for (const l of (payment?.Line ?? [])) {
    const pointsAtDeposit = (l?.LinkedTxn ?? []).some(
      (t) => t?.TxnType === "Invoice" && String(t?.TxnId) === from,
    );
    if (!pointsAtDeposit) { lines.push(l); continue; }
    changed = true;
    const amt = r2(l?.Amount ?? 0);
    const applied = allowance === Infinity ? amt : Math.min(amt, allowance);
    if (applied <= 0) {
      // No room left on the final invoice — leave this portion unapplied
      // (drop the application line entirely; the Payment's TotalAmt keeps
      // the money as customer credit).
      continue;
    }
    if (allowance !== Infinity) allowance = r2(allowance - applied);
    lines.push({
      ...l,
      Amount: applied,
      LinkedTxn: (l.LinkedTxn ?? []).map((t) =>
        (t?.TxnType === "Invoice" && String(t?.TxnId) === from) ? { ...t, TxnId: to } : t,
      ),
    });
  }
  if (!changed) return null;
  return {
    ...payment,
    Line: lines,
    sparse: false,
  };
}

/**
 * Settlement must never move/void a document it can't PROVE is an
 * InkTracker deposit invoice — the pointer column is data, and data can
 * be wrong (buggy carry-forward, hostile write). Trust requires the
 * -DEP DocNumber family OR our own PrivateNote stamp.
 */
export function isTrustedDepositInvoice(invoice) {
  if (!invoice) return false;
  if (isDepositDocNumber(invoice.DocNumber)) return true;
  return String(invoice.PrivateNote || "").startsWith("InkTracker deposit invoice");
}

// ── Webhook / reconcile: deposit-invoice paid detection ─────────────────────

/**
 * The patch that lands on the quote when its deposit invoice is paid.
 * `collected` is what QB actually shows collected — it becomes the
 * snapshot when none exists yet (or corrects a drifted one, e.g. the shop
 * edited the deposit invoice amount inside QBO before the customer paid).
 */
export function buildDepositPaidPatch({ collected, nowIso }) {
  const patch = {
    deposit_paid: true,
    deposit_paid_at: nowIso,
    payment_status: "Deposit Paid",
  };
  const amt = r2(collected);
  if (amt > 0) patch.deposit_amount = amt;
  return patch;
}

/** Deposit invoice fully paid? Same balance-zero contract as elsewhere. */
export function isDepositInvoicePaid(invoice) {
  if (!invoice) return false;
  const total = Number(invoice.TotalAmt ?? NaN);
  const balance = Number(invoice.Balance ?? NaN);
  return Number.isFinite(total) && Number.isFinite(balance) && total > 0 && balance === 0;
}
