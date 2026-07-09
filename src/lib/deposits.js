// Deposits are display/tracking only right now — they are NOT collectible
// online, so all deposit UI is hidden behind this flag.
//
// Why: the deposit-charging path was Stripe Checkout (createCheckoutSession
// charges full × deposit_pct/100). Stripe customer payments were removed at
// launch — QuickBooks is the only live payment path (QuotePayment.jsx). The
// QB pay link bills the FULL invoice; QB can't collect a partial "50% now".
// So a "Approve & Pay Deposit $X" button that redirects to a full-amount QB
// invoice is a broken promise to the customer.
//
// Flip to true when deposits have a real collection path (QB progress
// invoicing, or a re-enabled Stripe deposit flow). The underlying
// deposit_pct/deposit_paid fields and math are left intact so re-enabling is
// a one-line change here — existing quotes' saved deposit values are inert
// while this is false, not lost.
export const DEPOSITS_ENABLED = false;
