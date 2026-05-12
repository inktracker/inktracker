-- Drop the Shopify integration columns now that the integration has
-- been removed from the app (PR #21 stripped the UI, this PR removes
-- the edge functions + dead schema). Safe because:
--
--   1. No code reads from these columns anymore — verified by grep
--      across src/ and supabase/functions/ before this migration.
--   2. profiles.shopify_access_token was being dual-written to
--      profile_secrets.shopify_access_token during the secrets
--      migration phase. Dropping both at once.
--   3. profiles.shopify_oauth_state and profiles.shopify_store never
--      moved to profile_secrets — they only ever lived on profiles.
--
-- IF EXISTS guards so re-running on a partially-cleaned env is a
-- no-op.

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS shopify_access_token,
  DROP COLUMN IF EXISTS shopify_oauth_state,
  DROP COLUMN IF EXISTS shopify_store;

ALTER TABLE public.profile_secrets
  DROP COLUMN IF EXISTS shopify_access_token;
