-- Nightly data-integrity check: customer reference invariants.
--
-- Why: the 2025 "beloved's" merge incident left 3 invoices orphaned
-- (customer_id NULL + "(deleted)" name stamps) for ~9 months with no
-- alarm — orphans render fine on list pages via the name-string
-- fallback, so nothing ever LOOKED broken. This function gives the
-- qbReconcile cron a single cheap call to count violations of the
-- invariant "every quote/order/invoice points at a real customer",
-- covering both failure shapes:
--   missing_link  — customer_id NULL or empty string
--   dangling_link — customer_id set but no matching customers row
--
-- Verified clean (all zeros) at creation on 2026-06-10 after the
-- beloved's/Choo Choo's repair. Any future nonzero is signal, from
-- any cause: code regression, bad import, manual edit.
--
-- customer_id columns are TEXT while customers.id is UUID (legacy of
-- the Base44-era data model) — hence the ::text cast. A real FK with
-- ON DELETE RESTRICT is the stronger guard, parked until post-tester
-- (requires text→uuid column conversion; regression surface on the
-- public wizard insert path).

CREATE OR REPLACE FUNCTION public.data_integrity_violations()
RETURNS TABLE(tbl text, missing_link bigint, dangling_link bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT 'invoices'::text,
         count(*) FILTER (WHERE i.customer_id IS NULL OR i.customer_id = ''),
         count(*) FILTER (WHERE i.customer_id IS NOT NULL AND i.customer_id <> '' AND c.id IS NULL)
  FROM invoices i LEFT JOIN customers c ON c.id::text = i.customer_id
  UNION ALL
  SELECT 'quotes',
         count(*) FILTER (WHERE q.customer_id IS NULL OR q.customer_id = ''),
         count(*) FILTER (WHERE q.customer_id IS NOT NULL AND q.customer_id <> '' AND c.id IS NULL)
  FROM quotes q LEFT JOIN customers c ON c.id::text = q.customer_id
  UNION ALL
  SELECT 'orders',
         count(*) FILTER (WHERE o.customer_id IS NULL OR o.customer_id = ''),
         count(*) FILTER (WHERE o.customer_id IS NOT NULL AND o.customer_id <> '' AND c.id IS NULL)
  FROM orders o LEFT JOIN customers c ON c.id::text = o.customer_id
$$;

-- Service-role / cron only. Counts are cross-tenant operator telemetry,
-- not shop-facing data.
REVOKE ALL ON FUNCTION public.data_integrity_violations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.data_integrity_violations() TO service_role;
