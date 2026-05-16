// Policy: what kinds of edits are allowed on a quote, given its
// current status?
//
// The bug this defends against: shop owner edits a quote AFTER the
// customer has been sent it / approved it / PAID it. The InkTracker
// row mutates silently, but the customer's email link, Stripe
// charge, QB invoice, and the customer's memory of what they
// agreed to do not. Result: InkTracker says the deal is X; the
// customer paid Y; reconciliation is hell.
//
// Worst case is Approved-and-Paid: cash is in, contract is set,
// editing pricing on InkTracker creates a number that contradicts
// every record outside InkTracker. Sacred. Block.
//
// Second worst: Converted to Order. The order is now the source of
// truth; editing the quote breaks the audit chain.
//
// Sent / Pending / Approved / Declined: not catastrophic but the
// customer's email link will show the new pricing on the next
// visit. Warn so the operator is making a conscious decision.

// Status → policy bucket. Hard constants so behavior is auditable
// without grep through if-chains.

const SACRED_STATUSES = new Set([
  "Approved and Paid",
  "Converted to Order",
  "Paid",                 // legacy alias from older rows
]);

const POST_SEND_STATUSES = new Set([
  "Sent", "Pending", "Approved", "Declined",
  "Approved and Paid", "Converted to Order", "Paid",
]);

// Fields whose change affects what the customer is paying. Editing
// any of these on a post-send quote diverges InkTracker from
// what's on the customer's side (Stripe / QB / email).
//
// Whitelist style — adding a new pricing field requires opting it
// into this list explicitly. Safer than a blacklist where new
// fields silently slip through.
const MONEY_AFFECTING_FIELDS = [
  "line_items",
  "rush_rate",
  "extras",
  "discount",
  "discount_type",
  "tax_rate",
  "deposit_pct",
  "subtotal",
  "tax",
  "total",
];

/**
 * Cheap structural-equality for the small JSON shapes we care about
 * (line_items, extras). Not a general deep-equal — just enough to
 * detect "this field is actually changing." Symmetric with the
 * Quote.update payload semantics: undefined === undefined.
 */
function shallowJsonEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Inspect an attempted edit against the quote's current state and
 * report any post-send risk.
 *
 * @param {object} currentQuote  the existing row (with .status, .line_items, etc.)
 * @param {object} edit          the proposed patch (same shape, partial allowed)
 *
 * @returns {null | {
 *   severity: "warn" | "block",
 *   status: string,
 *   changedFields: string[],
 *   message: string,
 * }}
 *   null when no risk (draft edit, or non-money fields only on a sent quote).
 *   "warn" — operator should confirm; UI surfaces a yes/no.
 *   "block" — refuse the edit; UI explains and suggests a revision flow.
 */
export function detectPostSendEditRisk(currentQuote, edit) {
  if (!currentQuote || !edit) return null;
  const status = (currentQuote.status || "Draft").toString();

  if (!POST_SEND_STATUSES.has(status)) return null;

  const changedFields = MONEY_AFFECTING_FIELDS.filter((field) => {
    if (!Object.prototype.hasOwnProperty.call(edit, field)) return false;
    return !shallowJsonEqual(currentQuote[field], edit[field]);
  });

  if (changedFields.length === 0) return null;

  if (SACRED_STATUSES.has(status)) {
    return {
      severity: "block",
      status,
      changedFields,
      message:
        `Can't edit pricing on a "${status}" quote — the customer ` +
        `already paid / it's been converted to an order. ` +
        `Create a new quote (or a revision) instead.`,
    };
  }

  return {
    severity: "warn",
    status,
    changedFields,
    message:
      `This quote was sent to the customer ("${status}"). ` +
      `Their email link will show the updated pricing on their ` +
      `next visit. Continue?`,
  };
}

// Re-exported as constants so tests + future callers can refer to
// the contract by name rather than copy-pasting magic strings.
export { SACRED_STATUSES, POST_SEND_STATUSES, MONEY_AFFECTING_FIELDS };
