-- NEW-09 (High, money): the "Create Invoice → QuickBooks" flow silently
-- under-bills because the setup/screen-fee line is dropped from the QB invoice.
--
-- buildQBInvoicePayload emits the "Setup & Screen Fees" QB line from
-- `setup_total`, but that field never made it onto the order or the invoice:
--   * orders HAS a setup_total column (20260801) but buildOrderFromQuote
--     didn't populate it (fixed in code);
--   * invoices has NO setup_total column at all, so the invoice-derived QB
--     payload always saw setup_total = 0.
-- The order/invoice `total` already includes setup, so QB ends up billing LESS
-- than the InkTracker total — and reconciliation compares QB against the lines
-- we send (which already omit setup), so it never catches the gap.
--
-- This migration:
--   1. adds invoices.setup_total,
--   2. backfills orders.setup_total from the originating quote (where missing),
--   3. backfills invoices.setup_total from the linked order, then from the
--      originating quote for quote-derived invoices.
-- Backfill only POPULATES a missing fee field; it never changes any stored
-- total. It makes the QB "Setup & Screen Fees" line correct for rows that
-- haven't been pushed to QB yet.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS setup_total numeric;

-- 2. orders.setup_total ← originating quote (only where the order doesn't
--    already carry one). Match on quote_id.
UPDATE public.orders o
SET setup_total = q.setup_total
FROM public.quotes q
WHERE o.setup_total IS NULL
  AND o.quote_id IS NOT NULL
  AND o.quote_id = q.quote_id
  AND o.shop_owner = q.shop_owner
  AND q.setup_total IS NOT NULL;

-- 3a. invoices.setup_total ← linked order (order-derived invoices). Match on
--     order_id within the same shop.
UPDATE public.invoices i
SET setup_total = o.setup_total
FROM public.orders o
WHERE i.setup_total IS NULL
  AND i.order_id IS NOT NULL
  AND i.order_id = o.order_id
  AND i.shop_owner = o.shop_owner
  AND o.setup_total IS NOT NULL;

-- 3b. invoices.setup_total ← originating quote (quote-derived invoices, where
--     invoice_id mirrors the quote's DocNumber / quote_id). Only fills rows
--     still missing one after 3a.
UPDATE public.invoices i
SET setup_total = q.setup_total
FROM public.quotes q
WHERE i.setup_total IS NULL
  AND i.invoice_id = q.quote_id
  AND i.shop_owner = q.shop_owner
  AND q.setup_total IS NOT NULL;
