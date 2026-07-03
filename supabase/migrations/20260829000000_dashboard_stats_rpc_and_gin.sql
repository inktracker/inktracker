-- Server-side dashboard stats + assigned_shops GIN index (pre-scale audit
-- items #6, 2026-07-02).
--
-- The Dashboard computed its headline chips from CAPPED fetches (quotes
-- limit 100, orders limit 50, invoices limit 1000) — a busy shop crossing
-- any cap silently got WRONG numbers (30 days of completed orders compete
-- with open ones inside the same 50-row fetch). This RPC aggregates over
-- everything the caller can see.
--
-- SECURITY INVOKER on purpose: RLS scopes the aggregate to exactly what the
-- caller's role can read (owner / manager / broker via the same policies as
-- the page's own fetches) — no shop_owner parameter to spoof.
--
-- STATUS SETS MIRROR THE JS SOURCE OF TRUTH — keep in lockstep:
--   * normalizeQuoteStatus (src/lib/broker/quoteStatus.js):
--       'Approved','Approved and Paid' → approved · 'Sent','Pending' →
--       pending · null/'' → 'Draft'
--   * isConvertedToOrder (src/lib/quotes/approvalState.js):
--       status = 'Converted to Order' OR converted_order_id set
--   * TERMINAL_STATUSES (Dashboard.jsx): 'Completed','Cancelled','Voided'
-- A drift-guard test (dashboardStatsRpc.test.js) fails if these literals
-- diverge from the JS constants.

CREATE OR REPLACE FUNCTION public.dashboard_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH q AS (
    SELECT
      status,
      converted_order_id,
      COALESCE(total, 0) AS total,
      (status = 'Converted to Order' OR NULLIF(converted_order_id, '') IS NOT NULL) AS is_converted,
      CASE
        WHEN status IN ('Approved', 'Approved and Paid') THEN 'approved'
        WHEN status IN ('Sent', 'Pending')               THEN 'pending'
        WHEN status IS NULL OR status = '' OR status = 'Draft' THEN 'draft'
        ELSE 'other'
      END AS bucket
    FROM public.quotes
  ),
  o AS (
    SELECT
      COALESCE(total, 0) AS total,
      paid,
      status,
      completed_date,
      line_items,
      status NOT IN ('Completed', 'Cancelled', 'Voided') AS is_open,
      (status = 'Completed' AND completed_date >= (now() - interval '30 days')::date) AS in_revenue_window
    FROM public.orders
  )
  SELECT jsonb_build_object(
    'active_quotes_count',  (SELECT count(*) FROM q WHERE NOT is_converted),
    'active_quotes_value',  (SELECT COALESCE(sum(total), 0) FROM q WHERE NOT is_converted),
    'open_quotes_count',    (SELECT count(*) FROM q WHERE bucket IN ('draft', 'pending')),
    'open_quotes_value',    (SELECT COALESCE(sum(total), 0) FROM q WHERE bucket IN ('draft', 'pending')),
    'approved_quotes_count',(SELECT count(*) FROM q WHERE bucket = 'approved'),
    'approved_quotes_value',(SELECT COALESCE(sum(total), 0) FROM q WHERE bucket = 'approved'),
    'open_orders_count',        (SELECT count(*) FROM o WHERE is_open),
    'open_orders_unpaid_value', (SELECT COALESCE(sum(total), 0) FROM o WHERE is_open AND NOT COALESCE(paid, false)),
    'open_invoices_count', (SELECT count(*) FROM public.invoices WHERE NOT COALESCE(paid, false) AND COALESCE(total, 0) > 0),
    'open_invoices_value', (SELECT COALESCE(sum(total), 0) FROM public.invoices WHERE NOT COALESCE(paid, false) AND COALESCE(total, 0) > 0),
    'revenue_30d', (SELECT COALESCE(sum(total), 0) FROM o WHERE in_revenue_window),
    -- Units = sum of every line item's size quantities across the window's
    -- completed orders. Mirrors Dashboard.jsx unitsLast30 (parseInt per size
    -- value; non-numeric values count 0).
    'units_30d', (
      SELECT COALESCE(sum(
        CASE WHEN s.value ~ '^\s*\d+' THEN (regexp_match(s.value, '\d+'))[1]::bigint ELSE 0 END
      ), 0)
      FROM o
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.line_items, '[]'::jsonb)) AS li
      CROSS JOIN LATERAL jsonb_each_text(COALESCE(li->'sizes', '{}'::jsonb)) AS s
      WHERE o.in_revenue_window
    ),
    'customer_count', (SELECT count(*) FROM public.customers)
  );
$$;

REVOKE ALL ON FUNCTION public.dashboard_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dashboard_stats() TO authenticated;

-- ── GIN index for assigned_shops membership (audit item, latent) ──────
-- shops/customers/orders/profiles RLS clauses do `assigned_shops @> …` and
-- `assigned_shops ? …` against profiles with no index. Trivial at today's
-- profile count; this is the cheap preventative before broker/manager
-- counts grow. Default jsonb_ops (NOT jsonb_path_ops) because the `?`
-- existence operator needs it.

CREATE INDEX IF NOT EXISTS profiles_assigned_shops_gin
  ON public.profiles USING GIN (assigned_shops);
