-- ============================================================================
-- Profile Secrets — phase 1 of moving sensitive tokens out of `profiles`.
-- ============================================================================
-- The `profiles` table currently contains OAuth tokens and supplier credentials
-- which are visible to brokers/employees through the `profiles_select_team`
-- and `profiles_select_shop_owner` RLS policies. Brokers can SELECT the shop
-- owner's profile row and read every token in it.
--
-- This migration is PHASE 1 — additive only:
--   1. Creates `profile_secrets` keyed by profile_id with no permissive RLS.
--      Only service_role (edge functions) can read/write it.
--   2. Backfills from existing columns on `profiles`.
--   3. Leaves existing profiles columns + policies in place so nothing breaks.
--
-- PHASE 2 (separate migration, after edge functions are updated to read from
-- profile_secrets and verified in production):
--   - Drop the sensitive columns from `profiles`.
--   - At that point the leak is fully closed (no columns = nothing to leak).
-- ============================================================================

CREATE TABLE IF NOT EXISTS profile_secrets (
  profile_id uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,

  -- QuickBooks
  qb_access_token       text,
  qb_refresh_token      text,
  qb_token_expires_at   timestamptz,
  qb_realm_id           text,
  qb_oauth_state        text,

  -- Gmail
  gmail_access_token    text,
  gmail_refresh_token   text,
  gmail_token_expires_at timestamptz,
  gmail_oauth_state     text,

  -- AS Colour
  ac_password           text,
  ac_subscription_key   text,

  -- S&S Activewear
  ss_account            text,
  ss_api_key            text,

  -- Shopify
  shopify_access_token  text,

  -- Stripe (customer-tied identifiers; not strictly secret but lumped here for tidiness)
  stripe_customer_id     text,
  stripe_subscription_id text,

  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS on, no permissive policies. Anything that isn't service_role gets denied.
ALTER TABLE profile_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON profile_secrets FROM anon, authenticated;
GRANT  ALL ON profile_secrets TO service_role;

-- Backfill from existing profiles columns. Idempotent — re-running is a no-op
-- because of ON CONFLICT.
INSERT INTO profile_secrets (
  profile_id,
  qb_access_token, qb_refresh_token, qb_token_expires_at, qb_realm_id, qb_oauth_state,
  gmail_access_token, gmail_refresh_token, gmail_token_expires_at, gmail_oauth_state,
  ac_password, ac_subscription_key,
  ss_account, ss_api_key,
  shopify_access_token,
  stripe_customer_id, stripe_subscription_id
)
SELECT
  id,
  qb_access_token, qb_refresh_token, qb_token_expires_at, qb_realm_id, qb_oauth_state,
  gmail_access_token, gmail_refresh_token, gmail_token_expires_at, gmail_oauth_state,
  ac_password, ac_subscription_key,
  ss_account, ss_api_key,
  shopify_access_token,
  stripe_customer_id, stripe_subscription_id
FROM profiles
ON CONFLICT (profile_id) DO NOTHING;
