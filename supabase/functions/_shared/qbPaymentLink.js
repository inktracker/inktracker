// Orchestrates minting a QuickBooks invoice pay link while avoiding QBO's
// duplicate email. Dependency-injected (no network/Deno) so the ordering +
// fallback are unit-testable.
//
// Order of preference:
//   1. The create response already carries the link.
//   2. GET ?include=invoiceLink — returns the SAME CommerceNetwork share link
//      WITHOUT sending QBO's email (the path that kills the duplicate email).
//   3. Fallback ONLY: POST /send — mints the link AND emails the customer.
//      Used solely when the no-email path yields nothing, so payment never
//      breaks (worst case = the prior two-email behavior).
//
// deps:
//   initialInvoice  — the create response (may already carry the link)
//   billEmail       — customer email; required for the /send fallback
//   extractLink(inv)        => string|null
//   fetchLink()             => Promise<invoice|null>  (include=invoiceLink; no email)
//   sendInvoice(billEmail)  => Promise<invoice|null>  (/send; emails)
//   sleep(ms)               => Promise  (injected; no-op in tests)
//   noEmailWaits            — retry waits for QBO's async provisioning
//   sendRefetchWait         — wait before the post-/send refetch
//
// Returns { link, finalInvoice, reason, emailed }.
//   emailed=false means the customer got NO QB email (the goal).
export async function mintPaymentLink({
  initialInvoice,
  billEmail,
  extractLink,
  fetchLink,
  sendInvoice,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  noEmailWaits = [0, 1500],
  sendRefetchWait = 3000,
}) {
  let invoice = initialInvoice;

  // 1. Link already on the create response.
  let link = extractLink(invoice);
  if (link) return { link, finalInvoice: invoice, reason: null, emailed: false };

  // 2. No-email fetch (with retries for async provisioning).
  for (const wait of noEmailWaits) {
    if (wait) await sleep(wait);
    const fetched = await fetchLink();
    if (fetched) {
      invoice = fetched;
      link = extractLink(invoice);
      if (link) return { link, finalInvoice: invoice, reason: null, emailed: false };
    }
  }

  // 3. Fallback: /send (emails). Needs a billEmail.
  if (!billEmail) {
    return { link: null, finalInvoice: invoice, reason: "no_bill_email", emailed: false };
  }
  try {
    const sent = await sendInvoice(billEmail);
    if (sent) invoice = sent;
  } catch {
    // /send blipped — still try a refetch; the portal record may be provisioned.
  }
  link = extractLink(invoice);
  if (link) return { link, finalInvoice: invoice, reason: null, emailed: true };

  await sleep(sendRefetchWait);
  const refetched = await fetchLink();
  if (refetched) {
    invoice = refetched;
    link = extractLink(invoice);
    if (link) return { link, finalInvoice: invoice, reason: null, emailed: true };
  }

  return { link: null, finalInvoice: invoice, reason: "no_link_after_retry", emailed: true };
}
