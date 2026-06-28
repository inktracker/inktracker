-- QB tax-sync hardening: mirror QuickBooks' authoritative subtotal/tax/total
-- onto the invoices table, parallel to the columns the quotes table already
-- carries. The IT-side `subtotal`/`tax`/`total` are what the quote BILLED;
-- these qb_* columns are what QuickBooks actually RECORDED, so the InkTracker
-- invoice record reflects QB exactly. Written back by qbSync.createInvoice.
-- See docs/qb-tax-sync.md.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS qb_subtotal   numeric,
  ADD COLUMN IF NOT EXISTS qb_tax_amount numeric,
  ADD COLUMN IF NOT EXISTS qb_total      numeric;

COMMENT ON COLUMN public.invoices.qb_subtotal   IS 'QuickBooks-recorded subtotal (authoritative). IT-side `subtotal` is what the quote billed.';
COMMENT ON COLUMN public.invoices.qb_tax_amount IS 'QuickBooks-recorded sales tax (authoritative, AST-computed). IT-side `tax` is what the quote billed.';
COMMENT ON COLUMN public.invoices.qb_total      IS 'QuickBooks-recorded invoice total (authoritative). IT-side `total` is what the quote billed.';
