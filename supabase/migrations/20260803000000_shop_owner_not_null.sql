-- shop_owner NOT NULL on owned tenant tables (audit DB-07).
--
-- A NULL shop_owner row matches NO RLS policy → an invisible "ghost row" only
-- service_role can see. schema.sql left shop_owner nullable on almost every
-- table. These ten are owned business tables whose RLS already requires
-- shop_owner = jwt email on authenticated writes (so NULLs could only come from
-- service_role) and which have ZERO NULL rows in prod — verified at deploy time
-- — so SET NOT NULL validates cleanly and just adds DB-level enforcement.
--
-- Intentionally EXCLUDED for now (need a backfill first / separate pass):
--   quotes (6 NULL rows, anon-wizard insertable), orders (anon insertable),
--   messages (35 NULL rows), notifications / notification_log (system-inserted).
-- Those keep nullable until their NULLs are backfilled and insert paths audited.

ALTER TABLE public.customers        ALTER COLUMN shop_owner SET NOT NULL;
ALTER TABLE public.invoices         ALTER COLUMN shop_owner SET NOT NULL;
ALTER TABLE public.commissions      ALTER COLUMN shop_owner SET NOT NULL;
ALTER TABLE public.shop_performance ALTER COLUMN shop_owner SET NOT NULL;
ALTER TABLE public.tax_categories   ALTER COLUMN shop_owner SET NOT NULL;
ALTER TABLE public.payees           ALTER COLUMN shop_owner SET NOT NULL;
ALTER TABLE public.payment_accounts ALTER COLUMN shop_owner SET NOT NULL;
ALTER TABLE public.purchase_orders  ALTER COLUMN shop_owner SET NOT NULL;
ALTER TABLE public.tax_records      ALTER COLUMN shop_owner SET NOT NULL;
ALTER TABLE public.inventory_items  ALTER COLUMN shop_owner SET NOT NULL;
