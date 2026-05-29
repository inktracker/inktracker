-- Per-shop rate limit for ANONYMOUS supplier lookup calls
--
-- The `ssLookupStyle` and `acLookupStyle` edge functions accept a
-- `shopOwner` body param so the anonymous public quote wizard can
-- look up garment data using a shop's saved S&S / AS Colour
-- credentials. Without a rate limit, anyone with just the anon key +
-- a known shop owner email can burn through the shop's supplier API
-- quota by hammering these endpoints.
--
-- This migration adds:
--   1. A bucketed counter table (one row per shop_owner per hour)
--   2. An atomic SECURITY DEFINER RPC that increments + checks in one
--      call. Returns TRUE when the request is allowed, FALSE when the
--      shop has exceeded its hourly ceiling.
--
-- Default ceiling: 600 calls/hour per shop. Enough headroom for ~10
-- concurrent customers browsing the wizard simultaneously, well below
-- the level a scraper / quota-burn attack would need.
--
-- Authenticated callers (the shop's own WizardConfigEditor "Sync from
-- suppliers" flow, broker line-item editor, quote editor) skip the
-- limit entirely — they pass an Authorization header instead of a
-- shopOwner body param, and the edge function reads that branch
-- without calling this RPC.

CREATE TABLE IF NOT EXISTS public.supplier_lookup_rate (
  shop_owner   text        NOT NULL,
  window_start timestamptz NOT NULL,
  call_count   integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (shop_owner, window_start)
);

-- Cleanup helper — older windows never get read but consume row space.
-- Cron later if/when needed; for now an index keeps lookups fast even
-- with stale rows.
CREATE INDEX IF NOT EXISTS supplier_lookup_rate_window_idx
  ON public.supplier_lookup_rate (window_start);

-- RLS so only the function (via SECURITY DEFINER) can read/write.
-- No anon select/insert.
ALTER TABLE public.supplier_lookup_rate ENABLE ROW LEVEL SECURITY;

-- Atomic increment + check. Returns TRUE when the call is allowed.
-- Returns FALSE when the current bucket is full. The increment
-- happens before the check, so a saturated shop continues to see
-- FALSE until the hour rolls over.
CREATE OR REPLACE FUNCTION public.check_supplier_lookup_rate(
  p_shop_owner    text,
  p_limit_per_hr  integer DEFAULT 600
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window timestamptz;
  v_count  integer;
BEGIN
  IF p_shop_owner IS NULL OR trim(p_shop_owner) = '' THEN
    RAISE EXCEPTION 'shop_owner required';
  END IF;
  v_window := date_trunc('hour', now());

  INSERT INTO public.supplier_lookup_rate (shop_owner, window_start, call_count)
  VALUES (p_shop_owner, v_window, 1)
  ON CONFLICT (shop_owner, window_start)
  DO UPDATE SET call_count = supplier_lookup_rate.call_count + 1
  RETURNING call_count INTO v_count;

  RETURN v_count <= p_limit_per_hr;
END;
$$;

REVOKE ALL ON FUNCTION public.check_supplier_lookup_rate(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_supplier_lookup_rate(text, integer) TO anon, authenticated;
