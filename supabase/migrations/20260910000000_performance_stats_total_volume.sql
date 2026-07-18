-- performance_stats v3: adds Total Volume — pieces across completed orders
-- PLUS QB-only invoices (imported history / QB-first jobs never bridged to
-- production). Spec: docs/total-volume-scope.md. Everything else identical
-- to v2.2 (20260909). Keep in lockstep with src/lib/reports/totalVolume.js
-- (client fallback + unit-tested reference implementation).
--
-- QB-only dedup: an invoice counts iff it has NO live linked order AND no
-- quote (same tenant, quote_id = invoice_id) with converted_order_id —
-- quote-born invoices usually carry order_id NULL with the linkage on the
-- quote; checking only order_id would double-count every quoted job.
--
-- Fee-line exclusion: non-garment lines (shipping/setup/fee/rush/discount/
-- surcharge) are excluded on invoice lines and on order lines inherited
-- from a QB invoice (id 'qb-…'). Production-born lines are never excluded.
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
      CASE WHEN li->>'qty' ~ '^\d+' THEN (regexp_match(li->>'qty', '^\d+'))[1]::bigint ELSE 0 END AS qty_units,
      (COALESCE(li->>'id', '') LIKE 'qb-%'
        AND COALESCE(li->>'style', '') ~* '(shipping|setup|fee|rush|discount|surcharge)') AS fee_excluded
    FROM completed c
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.line_items, '[]'::jsonb)) AS li
  ),
  qb_only_inv AS (
    SELECT i.line_items
    FROM public.invoices i
    WHERE (p_from IS NULL OR i.date >= p_from)
      AND (p_to   IS NULL OR i.date <= p_to)
      AND NOT EXISTS (
        SELECT 1 FROM public.orders o2
        WHERE o2.order_id = i.order_id AND o2.shop_owner = i.shop_owner
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.quotes q
        WHERE q.shop_owner = i.shop_owner
          AND q.quote_id = i.invoice_id
          AND q.converted_order_id IS NOT NULL
      )
  ),
  inv_line_units AS (
    SELECT
      COALESCE((
        SELECT sum(CASE WHEN s.value ~ '^\s*\d+' THEN (regexp_match(s.value, '\d+'))[1]::bigint ELSE 0 END)
        FROM jsonb_each_text(COALESCE(li->'sizes', '{}'::jsonb)) AS s
      ), 0) AS sizes_units,
      CASE WHEN li->>'qty' ~ '^\d+' THEN (regexp_match(li->>'qty', '^\d+'))[1]::bigint ELSE 0 END AS qty_units,
      (COALESCE(li->>'style', '') ~* '(shipping|setup|fee|rush|discount|surcharge)') AS fee_excluded
    FROM qb_only_inv qi
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(qi.line_items, '[]'::jsonb)) AS li
  )
  SELECT jsonb_build_object(
    'period_orders_count', (SELECT count(*) FROM completed),
    'period_gross_sales',  (SELECT COALESCE(sum(total), 0) FROM completed),
    'period_units', (
      SELECT COALESCE(sum(CASE WHEN sizes_units > 0 THEN sizes_units ELSE qty_units END), 0)
      FROM line_units
    ),
    'period_total_volume', (
      SELECT COALESCE((
        SELECT sum(CASE WHEN fee_excluded THEN 0 WHEN sizes_units > 0 THEN sizes_units ELSE qty_units END)
        FROM line_units), 0)
      + COALESCE((
        SELECT sum(CASE WHEN fee_excluded THEN 0 WHEN sizes_units > 0 THEN sizes_units ELSE qty_units END)
        FROM inv_line_units), 0)
    ),
    'period_qb_only_invoice_count', (SELECT count(*) FROM qb_only_inv),
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
