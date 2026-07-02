// Pure approve-transition decisions for createCheckoutSession's approveQuote
// action, extracted so the status machine is unit-testable without a live
// request. Same pattern as stripePaymentEffect.resolvePaidQuoteUpdate.
//
// The bug this defends against: the public approve link lives in the
// customer's inbox forever. Re-clicking it after the shop converted the quote
// to an order used to write status back to "Approved" — the quote reappeared
// on the Quotes page as a zombie (converted_order_id set, status not
// "Converted to Order") that couldn't be re-converted. Approval must be a
// one-way, idempotent transition: it fires once from a pre-approval state and
// never overwrites a later lifecycle state.

// Statuses at or past approval — an approve replay must not rewrite any of
// them:
//   - "Approved" / "Client Approved": already approved; rewriting would
//     restamp client_approved_at (broker path) and re-fire notifications.
//   - "Converted to Order" / "Approved and Paid" / "Paid": SACRED statuses
//     (see src/lib/quotes/editPolicy.js) — the order / payment record is now
//     the source of truth.
export const APPROVE_LOCKED_STATUSES = Object.freeze([
  "Approved",
  "Client Approved",
  "Converted to Order",
  "Approved and Paid",
  "Paid",
]);

// PostgREST filter that makes the UPDATE itself refuse locked rows, closing
// the race where a conversion lands between approveQuote's pre-read and its
// write (the same window convertQuoteToOrder closes with its IS NULL claim).
// NULL statuses must stay updatable — a bare `status.not.in.(...)` drops them
// because NOT(NULL IN (...)) is NULL, which PostgREST treats as no-match.
export const APPROVE_GUARD_OR =
  "status.is.null," +
  `status.not.in.(${APPROVE_LOCKED_STATUSES.map((s) => `"${s}"`).join(",")})`;

// Decide what (if anything) to write for an approve action, given the quote's
// current state. Returns:
//   update    — the exact `.update()` payload, or null when the quote is
//               already at/past approval (caller returns current state
//               without writing or notifying — idempotent success).
//   isBroker  — broker quotes route to "Client Approved" (client-first
//               workflow: the clicker is the broker's END CLIENT, and the
//               broker still has to "Submit to Shop"); direct shop quotes go
//               straight to "Approved".
export function resolveApproveQuoteUpdate(
  { status, client_status, broker_id, broker_email, converted_order_id } = {},
  { nowISO } = {},
) {
  const isBroker = Boolean(broker_id || broker_email);

  // converted_order_id is checked independently of status so a row whose
  // status already desynced (the zombie above) can never be re-approved, and
  // client_status covers broker quotes whose top-level status has moved on
  // (e.g. broker already submitted to shop) — re-approval would yank them
  // back into the broker's queue.
  const locked =
    APPROVE_LOCKED_STATUSES.includes(status) ||
    Boolean(converted_order_id) ||
    client_status === "Approved";

  if (locked) return { update: null, isBroker };

  return {
    update: isBroker
      ? {
          status: "Client Approved",
          client_status: "Approved",
          client_approved_at: nowISO,
        }
      : { status: "Approved" },
    isBroker,
  };
}
