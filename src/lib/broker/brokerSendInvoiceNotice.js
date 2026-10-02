// Turn a createBrokerClientInvoice failure into a broker-facing notice.
//
// The broker send is fail-open (the email/approval is already committed), but
// a failure to mint the client invoice must NOT be silent: it means the client
// has no Pay button and the broker was told nothing — the "it doesn't work
// every time Ethan tries" class (Joe, 2026-10-02). Benign skips
// (already_invoiced, not_a_broker_quote) carry no `error` and produce no notice.
//
// Returns { level: "info" | "error", title, description } or null for "nothing
// to show". level maps to notify.info / notify.error.
export function brokerInvoiceSendNotice(error) {
  const e = String(error || "").trim();
  if (!e) return null;

  // Broker simply hasn't connected their QuickBooks — expected, not a failure.
  // A gentle nudge, not a red error: the client can still approve.
  if (/not connected|connect .*quickbooks|no .*quickbooks/i.test(e)) {
    return {
      level: "info",
      title: "Quote sent — connect QuickBooks to add a pay link",
      description:
        "Your client can approve now, but they won't see a Pay button until you connect your QuickBooks under Settings.",
    };
  }

  // Everything else is a real failure the broker needs to see and act on.
  const hitLimit = /limit|maximum|too many|quota|exceeded/i.test(e);
  return {
    level: "error",
    title: "Quote sent, but the client's pay link wasn't created",
    description:
      e +
      (hitLimit
        ? " Your QuickBooks plan may have hit its monthly invoice limit — upgrade in QuickBooks, then re-send to create the pay link."
        : " Re-send the quote to try again, or create the invoice in your QuickBooks."),
  };
}
