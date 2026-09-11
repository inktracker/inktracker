-- due_date_requested distinguishes the two things a quote's due_date can mean:
--   * FALSE (default) — an auto turnaround (send date + standard/rush days).
--     At quote→order conversion this re-anchors to the APPROVAL date, so the
--     turnaround clock starts when the customer approves, not when the quote
--     was sent.
--   * TRUE — a specific in-hands date the customer/operator requested. This is
--     a hard deadline and is kept as-is on conversion (never pushed out).
--
-- See src/lib/orders/buildOrderFromQuote.js. Existing quotes default to FALSE
-- (treated as auto turnaround); the flag is set going forward by the wizard
-- (createQuoteFromPayload) and the quote editors when a specific date is set.

alter table public.quotes
  add column if not exists due_date_requested boolean not null default false;

comment on column public.quotes.due_date_requested is
  'TRUE = due_date is a customer-requested hard in-hands date (kept on order conversion). FALSE = auto turnaround (re-anchored to the approval date on conversion).';
