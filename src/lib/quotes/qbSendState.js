// State derivation for SendQuoteModal's QB Create/Send gate.
//
// Why this exists: the modal used to branch on `qbPaymentLink` alone,
// which is null whenever the shop's QuickBooks Online account doesn't
// have QB Payments enabled. In that case the "Create QB Invoice"
// click DID create a real QB invoice (server returned an id) but the
// modal kept showing the green "Create QB Invoice" button — so the
// shop owner clicked again, creating a second QB invoice, and again,
// and so on. Duplicate QB invoices = the exact "numbers match" RLS
// invariant we promised never to break (see CLAUDE.md memory file
// project_qb_integration_critical.md).
//
// The correct gate is `qbInvoiceId` — has an invoice been created in
// QB yet? — not `qbPaymentLink` (which is a separate question: did
// QB give us a customer-facing payment URL?).

/**
 * Decide what the QB section of SendQuoteModal should render and
 * whether Send should be enabled.
 *
 * @param {object} args
 * @param {string|null} args.qbInvoiceId  — present when QB has accepted the invoice
 * @param {string|null} args.qbPaymentLink — present when QB Payments is enabled and gave us a URL
 *
 * @returns {{
 *   status: "needs_create" | "created_no_link" | "ready",
 *   sendDisabledByQb: boolean,
 *   warning: string | null,
 * }}
 *   status:
 *     "needs_create"    — show the green Create button
 *     "created_no_link" — show a warning bar; invoice exists but no
 *                         online QB payment URL. /quotepayment falls
 *                         back to Stripe or Approve-only on the
 *                         customer side. Send is still allowed.
 *     "ready"           — show the green success bar; full QB flow ready
 *   sendDisabledByQb:
 *     true when Send should be blocked by QB state. Caller still
 *     enforces other gates (recipients, subject, etc).
 *   warning:
 *     human-readable string to display, or null when none.
 */
export function deriveQbSendState({ qbInvoiceId, qbPaymentLink } = {}) {
  // The QB invoice id is the lock. If it's missing, the shop hasn't
  // pushed to QB yet — Create is the only meaningful action.
  if (!qbInvoiceId) {
    return {
      status: "needs_create",
      sendDisabledByQb: true,
      warning: null,
    };
  }

  // Invoice in QB but no online payment URL — QB Payments wasn't
  // enabled on the shop's QBO account. We deliberately don't fall
  // back to the connect.intuit.com portal URL because that requires
  // the customer to have an Intuit login. The customer-facing
  // /quotepayment page handles this by routing to Stripe instead
  // (or showing Approve-only if neither is set up).
  if (!qbPaymentLink) {
    return {
      status: "created_no_link",
      sendDisabledByQb: false,
      warning:
        "QB Payments isn't enabled in your QuickBooks account — no online " +
        "payment URL was returned. The customer's payment page will fall " +
        "back to Stripe (if connected) or an Approve-only flow.",
    };
  }

  return {
    status: "ready",
    sendDisabledByQb: false,
    warning: null,
  };
}
