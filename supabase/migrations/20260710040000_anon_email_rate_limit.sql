-- ============================================================================
-- SECURITY (MEDIUM): rate-limit the anonymous sendQuoteEmail path.
-- ============================================================================
-- The anon branch of sendQuoteEmail restricts recipients to the quote's own
-- {shop_owner, customer_email, sent_to}, but customer_email is attacker-set
-- (they created the wizard quote), and there's no per-call limit. So a single
-- created quote could be replayed to email-bomb that address (or the shop
-- owner) from the verified quotes@inktracker.app domain, harming deliverability
-- reputation. This adds a bucketed per-quote hourly cap, mirroring the existing
-- supplier_lookup_rate design.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.anon_email_rate (
  rate_key     text        NOT NULL,
  window_start timestamptz NOT NULL,
  call_count   integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (rate_key, window_start)
);

ALTER TABLE public.anon_email_rate ENABLE ROW LEVEL SECURITY;
-- Service-role only; the RPC is SECURITY DEFINER so anon never touches it directly.
REVOKE ALL ON public.anon_email_rate FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS anon_email_rate_window_idx
  ON public.anon_email_rate (window_start);

-- Atomic increment-then-check. Returns FALSE once the bucket is saturated for
-- the current hour. Increment happens before the check so a saturated key keeps
-- returning FALSE until the hour rolls over.
CREATE OR REPLACE FUNCTION public.check_anon_email_rate(
  p_key          text,
  p_limit_per_hr integer DEFAULT 10
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

  INSERT INTO public.anon_email_rate (rate_key, window_start, call_count)
  VALUES (p_key, v_window, 1)
  ON CONFLICT (rate_key, window_start)
  DO UPDATE SET call_count = anon_email_rate.call_count + 1
  RETURNING call_count INTO v_count;

  RETURN v_count <= p_limit_per_hr;
END;
$$;

REVOKE ALL ON FUNCTION public.check_anon_email_rate(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_anon_email_rate(text, integer) TO anon, authenticated, service_role;
