// Coerce customer form values that don't match their Postgres column type
// before an insert/update.
//
// The Add/Edit Customer forms initialize date fields to "" (empty string),
// and toggling Tax Exempt off resets exemption_expires_at to "". Postgres
// rejects "" for a `date` column — "invalid input syntax for type date: ''"
// — which broke EVERY non-exempt customer added through the Customers tab
// (the quote-flow customer create already nulls these inline, which is why
// that path worked). This shares that coercion so both paths agree.
//
// exemption_expires_at is the only date-typed column on `customers`
// (verified against information_schema 2026-07-04). Kept as a list so a
// future date column is a one-line add, not another silent breakage.
const DATE_FIELDS = ["exemption_expires_at"];

export function normalizeCustomerWrite(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const out = { ...payload };
  for (const key of DATE_FIELDS) {
    if (key in out) {
      const v = out[key];
      if (v == null || (typeof v === "string" && v.trim() === "")) {
        out[key] = null;
      }
    }
  }
  return out;
}
