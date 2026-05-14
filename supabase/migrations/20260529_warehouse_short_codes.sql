-- AS Colour's actual warehouse strings (confirmed via probe to
-- /v1/inventory/items) are short state codes: "CA" and "NC", not
-- "Carson, CA" / "Charlotte, NC". Country code "USA" was wrong too.
--
-- Backfill existing rows and reset the column default.

UPDATE public.purchase_orders
SET warehouse = 'CA'
WHERE warehouse IN ('Carson, CA', 'USA') OR warehouse IS NULL OR warehouse = '';

UPDATE public.purchase_orders
SET warehouse = 'NC'
WHERE warehouse = 'Charlotte, NC';

ALTER TABLE public.purchase_orders
  ALTER COLUMN warehouse SET DEFAULT 'CA';
