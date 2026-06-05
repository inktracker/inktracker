// Shared name resolver for calendar chips and active-jobs lists on
// the shop-facing surfaces (Calendar.jsx, Production.jsx).
//
// The "label" is whoever the SHOP thinks of as the customer for this
// job. For direct shop work that's the customer. For broker work
// that's the BROKER — they're who the shop bills, who the shop talks
// to, and who shows up on the order chip. The broker's end client
// only appears in the broker portal; on shop surfaces, surfacing the
// end-client name produced "TEST CLIENT · Quote Sent" sitting next
// to "Jane Doe · Order Goods" for the SAME job, which made the
// calendar look like two different customers when it was always one
// (the broker).
//
// Broker check is gated on broker_id || broker_email rather than on
// the existence of broker_name alone because the latter can be a
// stale leftover after a quote was unlinked from a broker — using
// the id/email pair matches the same predicate used elsewhere
// (isBrokerQuote in QuoteDetailModal.jsx).
//
// Resolution order:
//   1. Broker (if broker_id/email): broker_company → broker_name
//   2. Direct customer: linked customer.company → record.company
//   3. Person fallback: linked customer.name → record.customer_name
//   4. Em-dash if nothing matched

export function resolveJobLabel(rec, customers = {}) {
  if (!rec) return "—";

  // Step 1: broker takes precedence on shop-facing surfaces.
  const isBroker = Boolean(rec.broker_id || rec.broker_email);
  if (isBroker) {
    const brokerCompany = trimOr(rec.broker_company);
    if (brokerCompany) return brokerCompany;
    const brokerName = trimOr(rec.broker_name);
    if (brokerName) return brokerName;
    // Fall through if both are blank — defensive only; the broker
    // gate above relied on id/email and the name fields should
    // already be populated when those are set.
  }

  // Step 2 + 3: direct-customer resolution.
  const cust = customers?.[rec.customer_id];
  const company =
    trimOr(cust?.company) ||
    trimOr(rec.company) ||
    "";
  if (company) return company;
  if (cust?.name) return cust.name;
  if (rec.customer_name) return rec.customer_name;
  return "—";
}

function trimOr(v) {
  return typeof v === "string" && v.trim() ? v.trim() : "";
}
