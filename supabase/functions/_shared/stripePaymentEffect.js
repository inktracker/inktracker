// Pure payment-effect decisions for the Stripe checkout.session.completed
// handler, extracted from stripeWebhook/index.ts so the money-critical branches
// are unit-testable without a live Stripe event.

// What to write to the quote when a checkout session for it completes.
//   - Already converted to an order → only stamp deposit_paid (never rewind the
//     order pipeline by overwriting the quote status).
//   - Otherwise → a DEPOSIT lands it at "Approved" (balance still owed); a FULL
//     payment lands it at "Approved and Paid". deposit_paid is set either way.
// Returns the exact `.update()` payload the handler applies.
export function resolvePaidQuoteUpdate({ status, converted_order_id, isDeposit } = {}) {
  const alreadyConverted = status === "Converted to Order" || !!converted_order_id;
  if (alreadyConverted) {
    return { deposit_paid: true };
  }
  return { status: isDeposit ? "Approved" : "Approved and Paid", deposit_paid: true };
}

// Defense-in-depth for Stripe Connect: the webhook trusts an attacker-
// controllable session.metadata.quote_id, so before flipping a quote to paid we
// confirm the connected account that RECEIVED the money owns that quote's shop.
// Returns true only when the payment may be applied.
//   - No connected account on the event (non-Connect / platform) → nothing to
//     check here, allow (other guards apply).
//   - Connected account present → the shop must have a stripe_account_id that
//     exactly matches it; a missing or mismatched shop account is REJECTED.
export function isPaymentAccountAuthorized({ sessionAccount, shopAccount } = {}) {
  if (!sessionAccount) return true;
  return !!shopAccount && shopAccount === sessionAccount;
}
