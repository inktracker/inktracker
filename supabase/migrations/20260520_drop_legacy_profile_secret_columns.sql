-- ============================================================================
-- Drop the legacy secret columns from `profiles` — close the intra-shop leak.
-- ============================================================================
-- The `profiles` RLS policies allow team members assigned to a shop
-- (brokers / managers / employees) to SELECT the shop owner's profile row.
-- That row historically contained the shop owner's QuickBooks / Gmail OAuth
-- tokens, Stripe customer/subscription IDs, and supplier API credentials —
-- so any teammate could read them all.
--
-- Mig 20260504_profile_secrets created the service-role-only
-- `profile_secrets` table to fix this, but kept the legacy columns in place
-- (dual-write window). This migration finishes the job:
--   1. Adds `ss_account_number` + `ac_email` to profile_secrets (the canonical
--      names that the application code uses today). Backfills from profiles.
--   2. Backfills any other secret columns from profiles → profile_secrets
--      so we never lose data that was only written to the old location.
--   3. Drops the legacy `profile_secrets.ss_account` column.
--   4. Drops every secret column from `profiles`.
--
-- Pre-flight verified:
--   - Application code reads all secrets via loadProfileWithSecrets, which
--     queries profile_secrets first.
--   - Account.jsx now saves supplier creds through the profileSecrets edge
--     function (not via auth.updateMe → profiles).
--   - qbOAuthCallback / gmailOAuthCallback / emailScanner write OAuth state +
--     tokens to profile_secrets, not profiles.
--   - BrokerProfile.jsx routes connect/disconnect through profileSecrets too.
--
-- Reversibility: this migration is one-way. If something breaks, restore the
-- columns from a DB backup (the data is preserved in profile_secrets, so a
-- worst-case restore is just `ALTER TABLE profiles ADD COLUMN ...` + copy
-- back). No data is lost by this migration itself.
-- ============================================================================

-- 1a. profile_secrets.ss_account_number — the column the app reads from.
ALTER TABLE profile_secrets
  ADD COLUMN IF NOT EXISTS ss_account_number text;

-- 1b. profile_secrets.ac_email — was on profiles, paired with ac_password.
ALTER TABLE profile_secrets
  ADD COLUMN IF NOT EXISTS ac_email text;

-- 2a. Backfill ss_account_number — prefer profiles (where Account.jsx wrote)
-- over the legacy profile_secrets.ss_account (which the earlier migration
-- attempted to use but Account.jsx never wrote to).
UPDATE profile_secrets ps
SET ss_account_number = COALESCE(p.ss_account_number, ps.ss_account)
FROM profiles p
WHERE p.id = ps.profile_id
  AND ps.ss_account_number IS NULL
  AND (p.ss_account_number IS NOT NULL OR ps.ss_account IS NOT NULL);

-- 2b. Backfill ac_email from profiles.
UPDATE profile_secrets ps
SET ac_email = p.ac_email
FROM profiles p
WHERE p.id = ps.profile_id
  AND ps.ac_email IS NULL
  AND p.ac_email IS NOT NULL;

-- 3. Catch-all backfill: any other secret column that still has data only
-- on profiles (e.g. a shop never disconnected so profile_secrets.qb_* is
-- null but profiles.qb_* still has the live token). Idempotent UPSERT.
INSERT INTO profile_secrets (
  profile_id,
  qb_access_token, qb_refresh_token, qb_token_expires_at, qb_realm_id, qb_oauth_state,
  gmail_access_token, gmail_refresh_token, gmail_token_expires_at, gmail_oauth_state,
  ac_password, ac_subscription_key, ac_email,
  ss_account_number, ss_api_key,
  stripe_customer_id, stripe_subscription_id
)
SELECT
  p.id,
  p.qb_access_token, p.qb_refresh_token, p.qb_token_expires_at, p.qb_realm_id, p.qb_oauth_state,
  p.gmail_access_token, p.gmail_refresh_token, p.gmail_token_expires_at, p.gmail_oauth_state,
  p.ac_password, p.ac_subscription_key, p.ac_email,
  p.ss_account_number, p.ss_api_key,
  p.stripe_customer_id, p.stripe_subscription_id
FROM profiles p
ON CONFLICT (profile_id) DO UPDATE SET
  qb_access_token        = COALESCE(profile_secrets.qb_access_token,        EXCLUDED.qb_access_token),
  qb_refresh_token       = COALESCE(profile_secrets.qb_refresh_token,       EXCLUDED.qb_refresh_token),
  qb_token_expires_at    = COALESCE(profile_secrets.qb_token_expires_at,    EXCLUDED.qb_token_expires_at),
  qb_realm_id            = COALESCE(profile_secrets.qb_realm_id,            EXCLUDED.qb_realm_id),
  qb_oauth_state         = COALESCE(profile_secrets.qb_oauth_state,         EXCLUDED.qb_oauth_state),
  gmail_access_token     = COALESCE(profile_secrets.gmail_access_token,     EXCLUDED.gmail_access_token),
  gmail_refresh_token    = COALESCE(profile_secrets.gmail_refresh_token,    EXCLUDED.gmail_refresh_token),
  gmail_token_expires_at = COALESCE(profile_secrets.gmail_token_expires_at, EXCLUDED.gmail_token_expires_at),
  gmail_oauth_state      = COALESCE(profile_secrets.gmail_oauth_state,      EXCLUDED.gmail_oauth_state),
  ac_password            = COALESCE(profile_secrets.ac_password,            EXCLUDED.ac_password),
  ac_subscription_key    = COALESCE(profile_secrets.ac_subscription_key,    EXCLUDED.ac_subscription_key),
  ac_email               = COALESCE(profile_secrets.ac_email,               EXCLUDED.ac_email),
  ss_account_number      = COALESCE(profile_secrets.ss_account_number,      EXCLUDED.ss_account_number),
  ss_api_key             = COALESCE(profile_secrets.ss_api_key,             EXCLUDED.ss_api_key),
  stripe_customer_id     = COALESCE(profile_secrets.stripe_customer_id,     EXCLUDED.stripe_customer_id),
  stripe_subscription_id = COALESCE(profile_secrets.stripe_subscription_id, EXCLUDED.stripe_subscription_id),
  updated_at             = now();

-- 4. Indexes for OAuth-state lookups (callbacks query by these).
CREATE INDEX IF NOT EXISTS profile_secrets_qb_oauth_state_idx
  ON profile_secrets (qb_oauth_state)
  WHERE qb_oauth_state IS NOT NULL;
CREATE INDEX IF NOT EXISTS profile_secrets_gmail_oauth_state_idx
  ON profile_secrets (gmail_oauth_state)
  WHERE gmail_oauth_state IS NOT NULL;

-- 5. Drop the legacy `ss_account` column from profile_secrets — superseded
-- by ss_account_number. Data was already migrated above.
ALTER TABLE profile_secrets DROP COLUMN IF EXISTS ss_account;

-- 6. Drop every secret column from `profiles`. After this point, the
-- intra-shop leak is fully closed — there's nothing left in the
-- broker/team-readable row to leak.
ALTER TABLE profiles
  DROP COLUMN IF EXISTS qb_access_token,
  DROP COLUMN IF EXISTS qb_refresh_token,
  DROP COLUMN IF EXISTS qb_token_expires_at,
  DROP COLUMN IF EXISTS qb_realm_id,
  DROP COLUMN IF EXISTS qb_oauth_state,
  DROP COLUMN IF EXISTS gmail_access_token,
  DROP COLUMN IF EXISTS gmail_refresh_token,
  DROP COLUMN IF EXISTS gmail_token_expires_at,
  DROP COLUMN IF EXISTS gmail_oauth_state,
  DROP COLUMN IF EXISTS ac_password,
  DROP COLUMN IF EXISTS ac_subscription_key,
  DROP COLUMN IF EXISTS ac_email,
  DROP COLUMN IF EXISTS ss_account_number,
  DROP COLUMN IF EXISTS ss_api_key,
  DROP COLUMN IF EXISTS stripe_customer_id,
  DROP COLUMN IF EXISTS stripe_subscription_id;
