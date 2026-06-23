-- Generic per-key hourly rate limiter, reusable by any edge function.
-- Same atomic increment-then-check design as check_anon_email_rate, but
-- key-agnostic so we can throttle: anon quote approvals (email amplification),
-- createQuoteFromPayload (authed write spam), getPublicShopConfig enumeration,
-- etc. Caller picks the key + limit.

CREATE TABLE IF NOT EXISTS public.request_rate (
  rate_key     text        NOT NULL,
  window_start timestamptz NOT NULL,
  call_count   integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (rate_key, window_start)
);

ALTER TABLE public.request_rate ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.request_rate FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS request_rate_window_idx ON public.request_rate (window_start);

-- Returns FALSE once the bucket is saturated for the current hour. Increment
-- happens before the check, so a saturated key keeps returning FALSE until the
-- hour rolls over. SECURITY DEFINER so callers needn't have table grants.
CREATE OR REPLACE FUNCTION public.check_request_rate(
  p_key          text,
  p_limit_per_hr integer DEFAULT 60
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window timestamptz;
  v_count  integer;
BEGIN
  IF p_key IS NULL OR trim(p_key) = '' THEN
    RAISE EXCEPTION 'rate key required';
  END IF;
  v_window := date_trunc('hour', now());

  INSERT INTO public.request_rate (rate_key, window_start, call_count)
  VALUES (p_key, v_window, 1)
  ON CONFLICT (rate_key, window_start)
  DO UPDATE SET call_count = request_rate.call_count + 1
  RETURNING call_count INTO v_count;

  RETURN v_count <= p_limit_per_hr;
END;
$$;

REVOKE ALL ON FUNCTION public.check_request_rate(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_request_rate(text, integer) TO anon, authenticated, service_role;
