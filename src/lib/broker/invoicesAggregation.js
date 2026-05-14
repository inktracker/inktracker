// Pure-logic for BrokerInvoicesTab.jsx — date bucketing for the
// monthly revenue chart.
//
//   getMonthKey("2026-05-14T...")   → "2026-05"
//   formatMonthLabel("2026-05")     → "May '26"
//   buildMonthlyChart(jobs)         → 12-month rolling window of
//                                     { month, revenue, jobs, label }
//
// `jobs` are completed broker orders/quotes with a `_brokerTotal`
// field pre-computed (the broker's view of revenue). Output rows are
// sorted ascending by month and trimmed to the last 12 months so the
// chart stays readable when an account has years of history.

export function getMonthKey(dateStr) {
  if (!dateStr) return null;
  const d = String(dateStr).split("T")[0];
  // Validate "YYYY-MM" prefix — anything else is unusable.
  if (!/^\d{4}-\d{2}/.test(d)) return null;
  return d.slice(0, 7);
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatMonthLabel(key) {
  if (!key) return "";
  const [y, m] = key.split("-");
  const idx = parseInt(m, 10) - 1;
  const name = MONTH_NAMES[idx] || "";
  if (!name || !y) return "";
  return `${name} '${y.slice(2)}`;
}

export function buildMonthlyChart(jobs) {
  const list = Array.isArray(jobs) ? jobs : [];
  const map = {};
  for (const job of list) {
    const key = getMonthKey(job.date || job.created_date);
    if (!key) continue;
    if (!map[key]) map[key] = { month: key, revenue: 0, jobs: 0 };
    map[key].revenue += Number(job._brokerTotal) || 0;
    map[key].jobs += 1;
  }
  return Object.values(map)
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-12)
    .map((row) => ({ ...row, label: formatMonthLabel(row.month) }));
}
