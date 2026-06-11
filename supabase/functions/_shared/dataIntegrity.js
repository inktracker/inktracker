// Pure helpers for the nightly customer-reference integrity alert.
// Mirrors the qbErrorDigest pattern: no fetch, no Deno, unit-testable.
//
// Input rows come from the data_integrity_violations() SQL function:
//   [{ tbl: "invoices", missing_link: 0, dangling_link: 0 }, ...]

export function totalIntegrityViolations(rows) {
  return (rows ?? []).reduce(
    (sum, r) => sum + Number(r.missing_link || 0) + Number(r.dangling_link || 0),
    0,
  );
}

export function shouldSendIntegrityAlert(rows) {
  // Any violation at all is signal — the invariant held at zero when
  // this check shipped (2026-06-10, post beloved's repair).
  return totalIntegrityViolations(rows) > 0;
}

export function buildIntegrityAlertText(rows) {
  const lines = [
    "InkTracker data-integrity check found customer-reference violations.",
    "",
    "Invariant: every quote / order / invoice points at a real customer.",
    "",
  ];
  for (const r of rows ?? []) {
    const missing = Number(r.missing_link || 0);
    const dangling = Number(r.dangling_link || 0);
    if (missing === 0 && dangling === 0) continue;
    lines.push(
      `  ${r.tbl}: ${missing} missing customer_id, ${dangling} dangling (points at deleted customer)`,
    );
  }
  lines.push(
    "",
    "This is how the beloved's orphaned-invoice incident stayed invisible",
    "for 9 months — investigate before it compounds. Query:",
    "  SELECT * FROM data_integrity_violations();",
    "then find the rows with customer_id IS NULL/'' or a dangling id and",
    "relink them to the right customers record.",
  );
  return lines.join("\n");
}
