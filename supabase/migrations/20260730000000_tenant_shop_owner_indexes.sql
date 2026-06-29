-- Add missing shop_owner indexes on tenant tables (audit SCALE-01).
--
-- RLS filters every read by shop_owner. These tables had NO usable shop_owner
-- index, so each read sequentially scans the whole (cross-tenant) table — and
-- one shop's query pays to skip every other shop's rows. Fine at 5 shops,
-- quadratically worse as the platform grows.
--
-- inventory_items DID have an index but it's PARTIAL — (shop_owner, supplier)
-- WHERE ordered_at IS NULL — so general shop_owner reads can't use it; add a
-- plain one.
--
-- All additive + idempotent (CREATE INDEX IF NOT EXISTS). Plain CREATE INDEX
-- (not CONCURRENTLY) is intentional: it runs inside the migration transaction
-- and the brief ACCESS EXCLUSIVE lock is negligible at current table sizes.
-- The quotes/orders/invoices/customers/notifications/etc. tables already got
-- their shop_owner indexes in 20260621.

CREATE INDEX IF NOT EXISTS expenses_shop_owner_idx        ON public.expenses        (shop_owner);
CREATE INDEX IF NOT EXISTS commissions_shop_owner_idx     ON public.commissions     (shop_owner);
CREATE INDEX IF NOT EXISTS shop_performance_shop_owner_idx ON public.shop_performance (shop_owner);
CREATE INDEX IF NOT EXISTS tax_categories_shop_owner_idx  ON public.tax_categories  (shop_owner);
CREATE INDEX IF NOT EXISTS payees_shop_owner_idx          ON public.payees          (shop_owner);
CREATE INDEX IF NOT EXISTS payment_accounts_shop_owner_idx ON public.payment_accounts (shop_owner);
CREATE INDEX IF NOT EXISTS messages_shop_owner_idx        ON public.messages        (shop_owner);
CREATE INDEX IF NOT EXISTS inventory_items_shop_owner_idx ON public.inventory_items (shop_owner);
