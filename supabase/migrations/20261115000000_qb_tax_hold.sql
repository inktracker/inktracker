-- Persisted QuickBooks tax hold (2026-09-28). Joe: "why do people keep
-- getting books drifts? that just should not happen."
--
-- When qbSync createInvoice holds an invoice because QuickBooks computed a
-- different sales tax than the quote (a dollar or more — sub-dollar rounding
-- is now adopted automatically), the hold used to live only in the session
-- that hit it plus a bell notification nobody read (21 unread in 30 days).
-- The hold now lives on the row: the quote/invoice modal renders a blocking
-- banner with the "Use QuickBooks' tax" action on every open, the quotes
-- list shows a chip, and the nightly drift scan skips held rows (a hold is
-- the system working, not drift). Cleared (null) by any createInvoice that
-- is not held — a clean re-sync, an explicit accept, or the auto-adopt.
--
-- Shape: { quoted_tax, qb_tax, tax_drift, quoted_total, qb_total,
--          missing_tax, held_at }  (see _shared/qbTaxAutoAdopt.js)

alter table public.quotes   add column if not exists qb_tax_hold jsonb;
alter table public.invoices add column if not exists qb_tax_hold jsonb;

comment on column public.quotes.qb_tax_hold is
  'Set while the QB invoice is held for a tax mismatch (>= $1); null once resolved. Written by qbSync createInvoice.';
comment on column public.invoices.qb_tax_hold is
  'Set while the QB invoice is held for a tax mismatch (>= $1); null once resolved. Written by qbSync createInvoice.';
