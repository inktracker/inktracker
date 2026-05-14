// Collapses shop-side quote statuses into the broker-facing bucket.
//
// Shop uses ~10 status values across the quote lifecycle (Draft,
// Sent, Approved, Approved and Paid, Declined, Converted to Order,
// etc). The broker portal shows fewer buckets — this maps one to
// the other. Lives outside the BrokerDashboard component so the
// shape is testable and changes here ripple through one place.

export function normalizeQuoteStatus(status) {
  if (status === "Approved and Paid") return "Shop Approved";
  if (status === "Approved") return "Shop Approved";
  if (status === "Sent") return "Pending";
  return status || "Draft";
}
