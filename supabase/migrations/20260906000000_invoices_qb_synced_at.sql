-- invoices.qb_synced_at — parallel to quotes.qb_synced_at (Phase 0 mirror).
--
-- The qbReconcile drift-verify pass (PR #638) and the qbWebhook
-- Invoice/Update mirror both patch qb_* mirror columns on BOTH tables;
-- the invoices table was missing this timestamp, so its mirror updates
-- silently failed (42703 swallowed by the unchecked update). Adding the
-- column makes the invoice-side mirror heal actually land and records
-- when each row last agreed with QuickBooks.
alter table public.invoices
  add column if not exists qb_synced_at timestamptz;
