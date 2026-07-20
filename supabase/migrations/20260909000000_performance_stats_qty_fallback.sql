-- performance_stats v2.2: per-line qty fallback for units.
--
-- QB-imported lines (pullInvoices stubs, Add-to-Production orders) carry a
-- bare `qty` with an EMPTY sizes map — the sizes-only sum counted those
-- lines as 0 units (a 2,675-piece imported job showed 0 in Units Sold,
-- Biota 2026-07-18). Per line: sizes sum when any size is present, else
-- the line's qty. Mirrors getQty() in pricing.jsx — keep in lockstep.
-- Everything else identical to v2.1 (20260908).
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
  ),
  line_units AS (
    SELECT
      COALESCE((
        SELECT sum(CASE WHEN s.value ~ '^\s*\d+' THEN (regexp_match(s.value, '\d+'))[1]::bigint ELSE 0 END)
        FROM jsonb_each_text(COALESCE(li->'sizes', '{}'::jsonb)) AS s
      ), 0) AS sizes_units,
      CASE WHEN li->>'qty' ~ '^\d+' THEN (regexp_match(li->>'qty', '^\d+'))[1]::bigint ELSE 0 END AS qty_units
    FROM completed c
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.line_items, '[]'::jsonb)) AS li
  )
  SELECT jsonb_build_object(
    'period_orders_count', (SELECT count(*) FROM completed),
    'period_gross_sales',  (SELECT COALESCE(sum(total), 0) FROM completed),
    'period_units', (
      SELECT COALESCE(sum(CASE WHEN sizes_units > 0 THEN sizes_units ELSE qty_units END), 0)
      FROM line_units
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
