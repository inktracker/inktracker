-- Flag invoices that appeared in QuickBooks WITHOUT an InkTracker origin.
--
-- Background (2026-07-22): a $5,000 California 89 invoice
-- (INV-2026-OW0M1-r3, QB Id 3746) showed up in QB with no InkTracker
-- audit event and no "InkTracker Quote …" PrivateNote stamp — it was
-- created directly in QuickBooks (UI or a bulk-import tool), not by
-- InkTracker's createInvoice path. These are legitimate QB records
-- (QB is the book of record), but they arrive with no local origin, so
-- they used to slip into AR silently and cause "where did this come
-- from?" confusion.
--
-- external_origin marks a row that pullInvoices INSERTED for the first
-- time while the QB invoice carried no InkTracker stamp. It is written
-- ONLY on insert (never on update), so InkTracker-originated invoices
-- and already-known/historical rows are never touched. The Invoices
-- page renders a subtle muted dot for flagged rows — visibility, not an
-- alarm.
--
-- Default false so every existing row is unflagged; the known 3746 row
-- is backfilled explicitly out-of-band.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS external_origin boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.invoices.external_origin IS
  'True when this invoice first appeared in QuickBooks with no InkTracker origin stamp (created directly in QB, not via InkTracker''s createInvoice). Set only on pullInvoices INSERT, never on update.';
