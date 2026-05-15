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

// Group quotes into buckets that match how the Dashboard / BrokerDashboard
// display them. Built on top of normalizeQuoteStatus so the shop and
// broker views always agree — previously Dashboard.jsx filtered on the
// raw status === "Pending", which missed every "Sent" quote (the
// far more common case) and reported 0 even when the shop had a
// dozen quotes out with customers waiting on a response.
//
// Returns arrays so callers can derive counts (.length) and sums.
//
// Buckets:
//   pending     — quote is out with the customer (Sent or Pending)
//   approved    — customer has approved (Approved or Approved and Paid)
//   draft       — internal, not yet sent
//   declined    — customer said no
//   converted   — already became an order
//
// Unknown statuses fall into the bucket their normalized name maps to;
// if they don't map anywhere they're simply omitted from all buckets
// rather than silently inflating a count.
export function bucketQuotes(quotes) {
  const buckets = {
    pending: [],
    approved: [],
    draft: [],
    declined: [],
    converted: [],
  };
  for (const q of quotes || []) {
    const norm = normalizeQuoteStatus(q?.status);
    if (norm === "Pending") buckets.pending.push(q);
    else if (norm === "Shop Approved") buckets.approved.push(q);
    else if (norm === "Draft") buckets.draft.push(q);
    else if (norm === "Declined") buckets.declined.push(q);
    else if (norm === "Converted to Order") buckets.converted.push(q);
  }
  return buckets;
}
