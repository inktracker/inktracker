-- Fix warehouse default + backfill.
--
-- 20260527 added purchase_orders.warehouse DEFAULT 'USA'. Wrong — AS
-- Colour's US API uses warehouse NAMES, not country codes. The two US
-- warehouses are "Carson, CA" and "Charlotte, NC" (per the AS Colour
-- customer portal). Country codes get rejected by /v1/orders.
--
-- Migrate existing 'USA' rows to 'Carson, CA' (west-coast warehouse,
-- the more common default for the launch shop in Reno, NV). Shops can
-- override per-PO. Update the column default for new rows.

UPDATE public.purchase_orders
SET    warehouse = 'Carson, CA'
WHERE  warehouse IS NULL
   OR  warehouse = 'USA'
   OR  warehouse = '';

ALTER TABLE public.purchase_orders
  ALTER COLUMN warehouse SET DEFAULT 'Carson, CA';
