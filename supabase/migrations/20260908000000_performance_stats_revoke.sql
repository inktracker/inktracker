-- performance_stats v2.1: identical to 20260907000000 plus the REVOKE that
-- migration omitted. CREATE OR REPLACE preserves ACLs on live databases, so
-- prod was never PUBLIC-executable — but a FRESH database (restore drill, CI
-- baseline) built only from migrations would have defaulted to PUBLIC
-- EXECUTE without this. Caught by dashboardStatsRpc contract tests.
--
-- v2 rationale (source period stats from ORDERS, not shop_performance):
--
-- shop_performance rows are only written by runOrderCompletion — orders
-- completed via any other path (Production status advance, webhook paid
-- cascade, etc.) never got a row, so the Performance page undercounted
-- badly (Biota 2026-07-18: page showed 2 orders/$2,126 for July against
-- 8 real completions/$8,454.68). Every completed order fleet-wide has
-- completed_date (verified: 0 of 42 missing) and shop_performance holds
-- zero rows that orders doesn't (0 orphans, 0 legacy) — orders is a
-- strict superset, so it becomes the single source. The orphan
-- cross-reference is obsolete: deleted orders drop out by definition.
--
-- SECURITY INVOKER — RLS is the tenant scope, unchanged from v1.
CREATE OR REPLACE FUNCTION public.performance_stats(p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  WITH completed AS (
    SELECT o.total, o.order_id, o.line_items
    FROM public.orders o
    WHERE o.status IN ('Completed', 'Shipped', 'Delivered', 'Picked Up')
      AND o.completed_date IS NOT NULL
      AND (p_from IS NULL OR o.completed_date >= p_from)
      AND (p_to   IS NULL OR o.completed_date <= p_to)
  )
  SELECT jsonb_build_object(
    'period_orders_count', (SELECT count(*) FROM completed),
    'period_gross_sales',  (SELECT COALESCE(sum(total), 0) FROM completed),
    'period_units', (
      SELECT COALESCE(sum(
        CASE WHEN s.value ~ '^\s*\d+' THEN (regexp_match(s.value, '\d+'))[1]::bigint ELSE 0 END
      ), 0)
      FROM completed c
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.line_items, '[]'::jsonb)) AS li
      CROSS JOIN LATERAL jsonb_each_text(COALESCE(li->'sizes', '{}'::jsonb)) AS s
    ),
    'active_orders_count', (
      SELECT count(*) FROM public.orders
      WHERE status IS NOT NULL AND status <> ''
        AND status NOT IN ('Completed', 'Shipped', 'Delivered', 'Picked Up')
        AND status NOT IN ('Cancelled', 'Canceled', 'Voided')
    ),
    'active_orders_value', (
      SELECT COALESCE(sum(total), 0) FROM public.orders
      WHERE status IS NOT NULL AND status <> ''
        AND status NOT IN ('Completed', 'Shipped', 'Delivered', 'Picked Up')
        AND status NOT IN ('Cancelled', 'Canceled', 'Voided')
    ),
    'outstanding_count', (SELECT count(*) FROM public.invoices WHERE NOT COALESCE(paid, false) AND COALESCE(total, 0) > 0),
    'outstanding_total', (SELECT COALESCE(sum(total), 0) FROM public.invoices WHERE NOT COALESCE(paid, false) AND COALESCE(total, 0) > 0)
  );
$$;

GRANT EXECUTE ON FUNCTION public.performance_stats(date, date) TO authenticated;

REVOKE ALL ON FUNCTION public.performance_stats(date, date) FROM PUBLIC;
