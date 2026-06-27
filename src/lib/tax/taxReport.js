// Aggregate immutable tax_records (Phase 3) into a by-state filing report.
// A shop files a sales-tax return in each state where it has nexus; this rolls
// the per-invoice records into the per-state totals that return needs.

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Roll tax records up by ship-to state. Returns rows sorted by tax collected
 * (desc). State "—" buckets records with no ship-to state captured.
 */
export function summarizeTaxByState(records) {
  const byState = new Map();
  for (const r of records || []) {
    const state = String(r?.ship_to_state ?? "").trim().toUpperCase() || "—";
    const cur = byState.get(state) || {
      state, taxable: 0, tax: 0, total: 0, count: 0, exemptCount: 0,
    };
    cur.taxable += Number(r?.taxable_amount) || 0;
    cur.tax     += Number(r?.tax_total) || 0;
    cur.total   += Number(r?.total) || 0;
    cur.count   += 1;
    if (r?.exempt) cur.exemptCount += 1;
    byState.set(state, cur);
  }
  const rows = Array.from(byState.values()).map((r) => ({
    ...r,
    taxable: round2(r.taxable),
    tax: round2(r.tax),
    total: round2(r.total),
  }));
  rows.sort((a, b) => {
    // Unknown-state bucket ("—") always sorts last.
    if (a.state === "—" && b.state !== "—") return 1;
    if (b.state === "—" && a.state !== "—") return -1;
    return b.tax - a.tax || a.state.localeCompare(b.state);
  });
  return rows;
}

/** Grand totals across the by-state rows. */
export function taxReportTotals(rows) {
  return (rows || []).reduce(
    (acc, r) => ({
      taxable: round2(acc.taxable + r.taxable),
      tax: round2(acc.tax + r.tax),
      total: round2(acc.total + r.total),
      count: acc.count + (r.count || 0),
    }),
    { taxable: 0, tax: 0, total: 0, count: 0 },
  );
}
