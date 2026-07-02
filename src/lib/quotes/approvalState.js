// Quote lifecycle predicates for the public payment page and shop-side
// list filtering. Pure — extracted from QuotePayment.jsx (which previously
// derived "already approved" twice, with drifting status lists) so the
// contract is unit-testable and single-sourced.
//
// Must stay in lockstep with the server's approve gate
// (supabase/functions/_shared/approveQuoteEffect.js): every status the
// server refuses to overwrite must read as "already approved" here, so the
// page never offers an Approve action the server will treat as a no-op.
// The parity test in src/lib/quotes/__tests__/approvalState.test.js
// enforces this.

// A quote is converted when EITHER signal says so. The two are written
// together (buildQuoteConvertedPatch / convertQuoteToOrder), but the
// approve-replay bug proved status alone can desync — converted_order_id
// is the durable signal, so always check both.
export function isConvertedToOrder(quote) {
  return (
    quote?.status === "Converted to Order" ||
    Boolean(quote?.converted_order_id)
  );
}

// Approval already happened (or the quote moved past it) — the payment
// page must not offer/auto-fire another approveQuote call.
// client_status covers broker quotes whose top-level status has moved on
// (end client approved, broker already submitted to shop).
export function quoteAlreadyApproved(quote) {
  return (
    quote?.status === "Approved" ||
    quote?.status === "Approved and Paid" ||
    quote?.status === "Paid" ||
    quote?.status === "Client Approved" ||
    quote?.client_status === "Approved" ||
    isConvertedToOrder(quote)
  );
}

// Fully settled — the page shows "Paid — Thank You!" instead of any CTA.
// Unchanged from the inline QuotePayment.jsx logic (deliberately does NOT
// treat "Converted to Order" as paid: a quote converted before payment may
// still owe its balance through the QB link).
export function quoteAlreadyPaid(quote) {
  return (
    quote?.status === "Approved and Paid" ||
    quote?.status === "Paid" ||
    (quote?.status === "Approved" && Boolean(quote?.deposit_paid))
  );
}
