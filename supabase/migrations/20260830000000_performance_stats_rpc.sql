-- Server-side Performance-page stats (follow-up to 20260829's
-- dashboard_stats; audit item #6, second half).
--
-- The Performance page computed its cards from capped fetches
-- (shop_performance 1000 / orders 1000 / invoices 1000) — a multi-year
-- shop silently lost its OLDEST rows, skewing every historical range.
-- Worse, the orphan cross-reference (drop shop_performance rows whose
-- order was deleted) had to disable itself entirely at the cap
-- ("orders.length >= 1000" guard) because it couldn't tell orphaned
-- from unfetched. Server-side EXISTS is exact — the guard's dilemma
-- disappears.
--
-- SECURITY INVOKER — RLS is the tenant scope (same rationale and
-- drift-guard test pattern as dashboard_stats).
--
-- STATUS SETS MIRROR Performance.jsx — keep in lockstep (guard test:
-- performanceStatsRpc cases in dashboardStatsRpc.test.js):
--   COMPLETED_STATUSES: 'Completed','Shipped','Delivered','Picked Up'
--   CANCELLED_STATUSES: 'Cancelled','Canceled','Voided'
--   active = status truthy AND not in either set
-- Units math mirrors getQty/getOrderUnits (sum of parseInt over each
-- line item's sizes values).

CREATE OR REPLACE FUNCTION public.performance_stats(p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH live_perf AS (
    -- shop_performance rows in range, minus orphans: a row is written when
    -- an order completes and is NOT cascade-deleted with the order, so
    -- deleted orders would keep counting forever (the "My Name" cleanup
    -- complaint, 2026-05-30). Rows with no order_id (legacy) are kept —
    -- mirrors the page's `!r.order_id ||` clause.
    SELECT sp.total, sp.order_id
    FROM public.shop_performance sp
    WHERE (p_from IS NULL OR sp.date >= p_from)
      AND (p_to   IS NULL OR sp.date <= p_to)
      AND (
        sp.order_id IS NULL OR sp.order_id = ''
        OR EXISTS (SELECT 1 FROM public.orders o WHERE o.order_id = sp.order_id)
      )
  )
  SELECT jsonb_build_object(
    'period_orders_count', (SELECT count(*) FROM live_perf),
    'period_gross_sales',  (SELECT COALESCE(sum(total), 0) FROM live_perf),
    'period_units', (
      SELECT COALESCE(sum(
        CASE WHEN s.value ~ '^\s*\d+' THEN (regexp_match(s.value, '\d+'))[1]::bigint ELSE 0 END
      ), 0)
      FROM live_perf lp
      JOIN public.orders o ON o.order_id = lp.order_id
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.line_items, '[]'::jsonb)) AS li
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

REVOKE ALL ON FUNCTION public.performance_stats(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.performance_stats(date, date) TO authenticated;
