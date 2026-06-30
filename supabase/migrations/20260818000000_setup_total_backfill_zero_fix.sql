-- Correction to 20260817: that backfill only touched rows where setup_total
-- IS NULL, but existing orders/invoices carry setup_total = 0 (the column
-- pre-existed on orders, and 0 is the stored default), so the affected rows
-- were skipped — they still drop the setup line when pushed to QB.
--
-- Re-run the backfill for 0 (or NULL) rows, with a SAFETY GUARD: only set
-- setup_total when the row's stored `total` already accounts for the setup
-- (total == the source's total, which includes setup). That way we add the
-- "Setup & Screen Fees" QB line ONLY where the customer-facing total already
-- billed it — never inflating a total. Rows whose total diverged from the
-- source (e.g. edited after conversion, or genuine pre-fix totals that excluded
-- setup) are left at 0 so QB keeps matching their stored total.

-- orders.setup_total ← originating quote
UPDATE public.orders o
SET setup_total = q.setup_total
FROM public.quotes q
WHERE COALESCE(o.setup_total, 0) = 0
  AND o.quote_id IS NOT NULL
  AND o.quote_id = q.quote_id
  AND o.shop_owner = q.shop_owner
  AND COALESCE(q.setup_total, 0) > 0
  AND o.total = q.total;            -- guard: total already includes the setup

-- invoices.setup_total ← linked order (order-derived invoices)
UPDATE public.invoices i
SET setup_total = o.setup_total
FROM public.orders o
WHERE COALESCE(i.setup_total, 0) = 0
  AND i.order_id IS NOT NULL
  AND i.order_id = o.order_id
  AND i.shop_owner = o.shop_owner
  AND COALESCE(o.setup_total, 0) > 0
  AND i.total = o.total;

-- invoices.setup_total ← originating quote (quote-derived invoices)
UPDATE public.invoices i
SET setup_total = q.setup_total
FROM public.quotes q
WHERE COALESCE(i.setup_total, 0) = 0
  AND i.invoice_id = q.quote_id
  AND i.shop_owner = q.shop_owner
  AND COALESCE(q.setup_total, 0) > 0
  AND i.total = q.total;
