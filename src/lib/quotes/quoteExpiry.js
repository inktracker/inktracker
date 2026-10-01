import { localDateStr } from "@/lib/dateRangeUtils";

// ONE expiry predicate for quotes. expires_date is a DATE-ONLY string
// ("2026-08-11"); `new Date(dateOnly) < new Date()` parses it as UTC midnight,
// which flips a quote to "expired" the evening BEFORE its date for any
// negative-offset (US) viewer — costing the customer the whole final day.
// QuotePayment fixed this inline (its comment documents the incident); the
// shop-side surfaces (Quotes list, QuoteEditorModal) kept the broken compare
// and showed "Expired" a day early while the public payment link still
// correctly accepted the quote (audit 2026-09-30). All three now share this:
// a quote is valid through the END of its expires_date in the viewer's local
// date.
export function isQuoteDateExpired(expiresDate, now = new Date()) {
  if (!expiresDate) return false;
  return localDateStr(now) > expiresDate;
}
