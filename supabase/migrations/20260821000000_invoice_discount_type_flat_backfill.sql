-- Invoice discount_type correction: some order-derived invoices show a FLAT
-- discount as a PERCENTAGE.
--
-- Root cause: `invoices.discount_type` has a column DEFAULT 'percent'
-- (20260525). Order-completion invoices created BEFORE the discount_type carry
-- fix (completeOrder now sets it) inserted no discount_type, so they got
-- 'percent' by default — even when the originating order/quote was 'flat'. The
-- 20260819 backfill only touched rows where discount_type IS NULL, so these
-- 'percent'-defaulted rows were skipped. Result: InvoiceDetailModal renders a
-- $75 flat discount as "(75%) −$806.25" while the total stays the flat $1,000.
--
-- Fix: for invoices whose discount_type DISAGREES with their source (linked
-- order, else originating quote), adopt the source's discount_type — but ONLY
-- when the invoice.total already equals the source total. That guard means the
-- stored total was computed with the source's discount interpretation, so
-- relabeling the type makes the DISPLAY consistent without ever changing a
-- stored total. Rows whose totals diverged (edited invoices) are left alone.
--
-- ROLLBACK: none needed — this only corrects a mislabeled type to match the
-- authoritative source; it changes no amount. (To undo, re-set discount_type
-- per-row from a backup.)

-- invoices.discount_type ← linked order (order-derived invoices)
UPDATE public.invoices i
SET discount_type = o.discount_type
FROM public.orders o
WHERE i.order_id = o.order_id
  AND i.shop_owner = o.shop_owner
  AND o.discount_type IS NOT NULL
  AND o.discount_type IS DISTINCT FROM i.discount_type
  AND COALESCE(i.discount, 0) > 0
  AND i.total = o.total;                 -- total already reflects the source discount

-- invoices.discount_type ← originating quote (quote-derived invoices)
UPDATE public.invoices i
SET discount_type = q.discount_type
FROM public.quotes q
WHERE i.invoice_id = q.quote_id
  AND i.shop_owner = q.shop_owner
  AND q.discount_type IS NOT NULL
  AND q.discount_type IS DISTINCT FROM i.discount_type
  AND COALESCE(i.discount, 0) > 0
  AND i.total = q.total;
