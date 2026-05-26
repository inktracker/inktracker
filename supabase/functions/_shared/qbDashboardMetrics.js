// Pure helpers for turning a list of QuickBooks Invoice records into
// the four dashboard metrics:
//
//   - revenueLast30Days   sum of TotalAmt for invoices whose TxnDate
//                         falls within the last 30 days
//   - revenueOrderCount   how many invoices contributed (used in the
//                         "X orders" sub-label on the chip)
//   - openInvoicesCount   count of invoices with Balance > 0
//   - openInvoicesTotal   sum of those balances (this is AR)
//
// Extracted so the QB edge-function HTTP layer stays a thin wrapper
// around testable logic. Mirrors the pattern used by qbInvoice.js +
// qbWebhookLogic.js — pure functions with their own test files.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Parse a QB TxnDate (yyyy-mm-dd) into epoch ms. Returns NaN for
// invalid / missing values so the filter below can drop them
// without crashing.
function parseTxnDate(s) {
  if (!s || typeof s !== "string") return NaN;
  // QB returns dates in the local books timezone but the date string
  // itself is timezone-agnostic — treat as UTC midnight for inclusion
  // window math. Off-by-one-day at the boundary is acceptable for a
  // "last 30 days" headline number.
  const t = Date.parse(`${s.slice(0, 10)}T00:00:00Z`);
  return t;
}

export function summarizeInvoicesForDashboard(invoices, now = Date.now(), windowDays = 30) {
  const list = Array.isArray(invoices) ? invoices : [];
  const cutoff = now - windowDays * MS_PER_DAY;

  let revenueLast30Days = 0;
  let revenueOrderCount = 0;
  let openInvoicesCount = 0;
  let openInvoicesTotal = 0;

  for (const inv of list) {
    if (!inv || typeof inv !== "object") continue;
    const total = Number(inv.TotalAmt);
    const balance = Number(inv.Balance);

    // Revenue: invoices created in the last N days. We sum TotalAmt
    // (the billed amount), not paid amount — this matches the
    // "billed in last 30 days" definition shops typically expect
    // when they see "Revenue" on a dashboard. P&L-grade revenue
    // requires the QB ProfitAndLoss report and tax-period awareness;
    // out of scope here.
    if (Number.isFinite(total)) {
      const t = parseTxnDate(inv.TxnDate);
      if (!Number.isNaN(t) && t >= cutoff && t <= now + MS_PER_DAY) {
        revenueLast30Days += total;
        revenueOrderCount += 1;
      }
    }

    // Open invoices: Balance > 0 is QB's canonical "unpaid"
    // indicator. Includes overdue + not-yet-due. Matches the AR
    // Aging Summary's "Total" row total.
    if (Number.isFinite(balance) && balance > 0) {
      openInvoicesCount += 1;
      openInvoicesTotal += balance;
    }
  }

  // Round to cents — float drift over many invoices otherwise shows
  // .0000001 tails that look broken next to QB's nicely rounded UI.
  return {
    revenueLast30Days: Math.round(revenueLast30Days * 100) / 100,
    revenueOrderCount,
    openInvoicesCount,
    openInvoicesTotal: Math.round(openInvoicesTotal * 100) / 100,
    windowDays,
  };
}
