// Deep links to QuickBooks Online reports — used to replace the in-app
// QB report viewer. We let QB render its own reports (it's the source
// of truth for accounting data) and just give shop owners a one-click
// jump to each report.
//
// QB's per-report URL slugs are stable. Once the user is logged into
// QBO, these URLs route into their company context automatically.
//
// Pure data + a tiny lookup. Tests at __tests__/qbReportLink.test.js.

const QB_BASE = "https://app.qbo.intuit.com/app";

export const QB_REPORTS = Object.freeze([
  { key: "profitAndLoss",   label: "Profit & Loss",     slug: "profitandlossreport" },
  { key: "balanceSheet",    label: "Balance Sheet",     slug: "balancesheetreport" },
  { key: "cashFlow",        label: "Cash Flow",         slug: "cashflowreport" },
  { key: "arAging",         label: "Aged Receivables",  slug: "aragingdetailreport" },
  { key: "salesByCustomer", label: "Sales by Customer", slug: "salesbycustomersummary" },
]);

/**
 * Resolve a QB report key to its public deep-link URL. Returns null for
 * unknown keys so callers can hide the link instead of showing a broken one.
 */
export function qbReportUrl(key) {
  const r = QB_REPORTS.find((r) => r.key === key);
  if (!r) return null;
  return `${QB_BASE}/${r.slug}`;
}
