-- SQL aggregates for the daily-briefing revenue stats (audit SCALE-03).
--
-- dailyStats was SELECTing every quotes.total / invoices.total / invoices.paid
-- row across ALL shops in the 7-day window and summing them in JS — unbounded
-- memory + a guaranteed timeout/OOM as the platform grows. This function does
-- the count()/sum() in Postgres (using the created_at/shop indexes) and returns
-- a single jsonb blob, so the edge function ships one tiny RPC instead.
--
-- service-role only — it reads platform-wide (cross-tenant) totals for the
-- internal morning briefing; never exposed to authenticated/anon.
--
-- Note: invoices.paid is a BOOLEAN flag (not an amount); a paid invoice's value
-- is invoices.total. The old JS summed the boolean (effectively a count) for the
-- payments "total" — a quirk. Here payments_total is the real dollar value (sum
-- of total for paid invoices in the window), the intended metric.

CREATE OR REPLACE FUNCTION public.daily_briefing_revenue()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'quotes_24h_count',   (SELECT count(*)              FROM public.quotes   WHERE created_at >= now() - interval '1 day'),
    'quotes_24h_total',   (SELECT coalesce(sum(total),0) FROM public.quotes  WHERE created_at >= now() - interval '1 day'),
    'quotes_7d_count',    (SELECT count(*)              FROM public.quotes   WHERE created_at >= now() - interval '7 days'),
    'quotes_7d_total',    (SELECT coalesce(sum(total),0) FROM public.quotes  WHERE created_at >= now() - interval '7 days'),
    'invoices_24h_count', (SELECT count(*)              FROM public.invoices WHERE created_at >= now() - interval '1 day'),
    'invoices_24h_total', (SELECT coalesce(sum(total),0) FROM public.invoices WHERE created_at >= now() - interval '1 day'),
    'invoices_7d_count',  (SELECT count(*)              FROM public.invoices WHERE created_at >= now() - interval '7 days'),
    'invoices_7d_total',  (SELECT coalesce(sum(total),0) FROM public.invoices WHERE created_at >= now() - interval '7 days'),
    'payments_24h_count', (SELECT count(*)              FROM public.invoices WHERE paid IS TRUE AND paid_date >= now() - interval '1 day'),
    'payments_24h_total', (SELECT coalesce(sum(total),0)  FROM public.invoices WHERE paid IS TRUE AND paid_date >= now() - interval '1 day'),
    'payments_7d_count',  (SELECT count(*)              FROM public.invoices WHERE paid IS TRUE AND paid_date >= now() - interval '7 days'),
    'payments_7d_total',  (SELECT coalesce(sum(total),0)  FROM public.invoices WHERE paid IS TRUE AND paid_date >= now() - interval '7 days')
  );
$$;

REVOKE ALL ON FUNCTION public.daily_briefing_revenue() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.daily_briefing_revenue() TO service_role;
