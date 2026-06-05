-- Core table indexes for the hot read paths.
--
-- Why: every list page runs "this shop's rows, newest first"
--   (e.g. quotes WHERE shop_owner = ? ORDER BY created_at DESC LIMIT n),
-- and the Customers detail/merge flow looks rows up by customer_id /
-- customer_name. None of those columns were indexed on the four core
-- tables, so Postgres was sequential-scanning + sorting on every visit.
-- These indexes turn those into index range scans that also satisfy the
-- ORDER BY ... LIMIT without a separate sort.
--
-- Safety: every statement is additive and idempotent (CREATE INDEX IF NOT
-- EXISTS). No data is modified and no application behavior changes — only
-- query plans get faster. Existing unique indexes on (shop_owner, <id>)
-- already cover plain shop_owner equality; these add the created_at / date
-- ordering and the customer_id / customer_name lookups that weren't covered.
--
-- Note on locking: plain CREATE INDEX takes a brief ACCESS EXCLUSIVE lock.
-- On the current (small, pre-launch) tables this is milliseconds. If these
-- tables are ever large before this runs, build the CONCURRENTLY variants
-- by hand instead (CONCURRENTLY cannot run inside a migration transaction).

-- ── quotes ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS quotes_shop_created_idx
  ON public.quotes (shop_owner, created_at DESC);
CREATE INDEX IF NOT EXISTS quotes_customer_id_idx
  ON public.quotes (customer_id);
CREATE INDEX IF NOT EXISTS quotes_customer_name_idx
  ON public.quotes (customer_name);

-- ── orders ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS orders_shop_created_idx
  ON public.orders (shop_owner, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_customer_id_idx
  ON public.orders (customer_id);
CREATE INDEX IF NOT EXISTS orders_customer_name_idx
  ON public.orders (customer_name);

-- ── invoices ─────────────────────────────────────────────────────────────
-- Invoices.jsx sorts by "-date"; Performance.jsx sorts by created_at.
-- Index both so each page's ORDER BY is covered.
CREATE INDEX IF NOT EXISTS invoices_shop_created_idx
  ON public.invoices (shop_owner, created_at DESC);
CREATE INDEX IF NOT EXISTS invoices_shop_date_idx
  ON public.invoices (shop_owner, date DESC);
CREATE INDEX IF NOT EXISTS invoices_customer_id_idx
  ON public.invoices (customer_id);
CREATE INDEX IF NOT EXISTS invoices_customer_name_idx
  ON public.invoices (customer_name);

-- ── customers ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS customers_shop_owner_idx
  ON public.customers (shop_owner);
