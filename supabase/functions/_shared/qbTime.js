// Pure helpers for the qbSync pushTimeEntries action (InkTracker → QBO
// TimeActivity). Kept out of the edge function so the behavior contract is
// unit-tested (see __tests__/qbTime.test.js).
//
// Books-safety: these only BUILD create payloads. The edge function never
// updates or deletes TimeActivity records — a synced entry is stamped with
// its qb_time_activity_id and skipped forever after.

// Match an InkTracker team member to a QBO Employee. Email is the only
// trustworthy key; name matching is deliberately strict (exact,
// case/whitespace-insensitive) because a wrong match books hours to the
// wrong person's payroll. No fuzzy matching here — an unmatched member is
// surfaced to the owner instead ("add them as an Employee in QB Payroll").
export function pickQbEmployeeMatch(entry, qbEmployees) {
  const norm = (v) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const email = norm(entry?.member_email);
  const name = norm(entry?.member_name);
  const list = Array.isArray(qbEmployees) ? qbEmployees.filter((e) => e && e.Active !== false) : [];

  if (email) {
    const byEmail = list.filter((e) => norm(e.PrimaryEmailAddr?.Address) === email);
    if (byEmail.length === 1) return byEmail[0];
    if (byEmail.length > 1) return null; // ambiguous — refuse to guess
  }
  if (name) {
    const byName = list.filter((e) => {
      const display = norm(e.DisplayName);
      const given = norm([e.GivenName, e.FamilyName].filter(Boolean).join(" "));
      return display === name || given === name;
    });
    if (byName.length === 1) return byName[0];
  }
  return null;
}

// Build the QBO TimeActivity create body for one approved entry.
// Returns null when the entry has nothing to bill (zero minutes) so the
// caller can skip it rather than create an empty record in someone's books.
export function buildTimeActivityBody(entry, qbEmployeeId) {
  const minutes = Math.max(0, Math.round(Number(entry?.minutes) || 0));
  if (!minutes || !qbEmployeeId || !entry?.work_date) return null;
  const body = {
    NameOf: "Employee",
    EmployeeRef: { value: String(qbEmployeeId) },
    TxnDate: entry.work_date,
    Hours: Math.floor(minutes / 60),
    Minutes: minutes % 60,
    Taxable: false,
    BillableStatus: "NotBillable",
  };
  const desc = String(entry.notes ?? "").trim();
  body.Description = desc
    ? `InkTracker timesheet — ${desc}`.slice(0, 4000)
    : "InkTracker timesheet";
  return body;
}
