-- Read-through cache for ANONYMOUS public-wizard supplier style lookups.
--
-- The ssLookupStyle / acLookupStyle edge functions make several live calls
-- to S&S Activewear / AS Colour on every garment a wizard shopper picks
-- (AS Colour: product + images + paginated variants + inventory + pricing,
-- per request). Many shoppers on one shop's shared wizard link look up the
-- same handful of styles, so without a cache the same expensive lookup is
-- repeated over and over — and the shop's throughput is capped by the
-- suppliers' latency and rate limits rather than our own infra.
--
-- This table caches the *successful response payload* per shop, so repeat
-- lookups of the same style return instantly and don't hit the supplier.
--
-- Keyed by (supplier, shop_owner, cache_key):
--   - supplier:   'ss' or 'ac'
--   - shop_owner: the shop's email. CRITICAL — pricing and inventory in the
--                 payload are resolved using THAT shop's supplier credentials,
--                 so the cache MUST be per-shop. Keying by style alone would
--                 serve one shop's negotiated prices to another.
--   - cache_key:  normalized request params (style number, etc).
--
-- Only the anonymous public-wizard path is cached (calls that pass a
-- shopOwner body param). Authenticated in-app calls (the WizardConfigEditor
-- "Sync from suppliers" flow, broker / quote line-item editors) pass an
-- Authorization header and NO shopOwner, so they always hit live suppliers
-- and are never served from this cache.
--
-- TTL is enforced in the edge function (env SUPPLIER_CACHE_TTL_SECONDS,
-- default 3600s). Setting that env var to 0 disables the cache entirely —
-- the kill switch — and behavior reverts exactly to pre-cache live lookups.

CREATE TABLE IF NOT EXISTS public.supplier_style_cache (
  supplier   text        NOT NULL,
  shop_owner text        NOT NULL,
  cache_key  text        NOT NULL,
  payload    jsonb       NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (supplier, shop_owner, cache_key)
);

-- Supports TTL range reads and any future cleanup of stale rows.
CREATE INDEX IF NOT EXISTS supplier_style_cache_created_idx
  ON public.supplier_style_cache (created_at);

-- RLS on, no policies: only the edge functions (via the service-role key,
-- which bypasses RLS) can read or write. No anon / authenticated access.
-- Same pattern as supplier_lookup_rate.
ALTER TABLE public.supplier_style_cache ENABLE ROW LEVEL SECURITY;
