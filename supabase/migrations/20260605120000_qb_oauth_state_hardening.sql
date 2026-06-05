-- ============================================================================
-- QuickBooks OAuth state — expiry + uniqueness hardening.
-- ============================================================================
-- Two changes to `profile_secrets`:
--
-- 1. New column `qb_oauth_state_at timestamptz` records when each state was
--    issued. The qbOAuthCallback edge function now rejects any state older
--    than 30 minutes — closes the "infinite reuse" property the column-less
--    design had. Industry-standard OAuth state lifetime.
--
-- 2. Partial unique index on `qb_oauth_state` (where non-NULL). UUID
--    collisions are vanishingly unlikely with crypto.randomUUID, but the
--    callback's `.maybeSingle()` lookup ALREADY assumes uniqueness — if a
--    refactor ever introduced a duplicate the lookup would error rather
--    than match. The constraint makes the assumption explicit at write
--    time so the failure mode is "couldn't start connect" (loud) instead
--    of "callback fails for one user" (silent).
--
-- NULL values stay allowed (most rows). Adding the index does NOT migrate
-- or backfill anything; existing rows without a state just continue to
-- have one NULL value.
-- ============================================================================

ALTER TABLE profile_secrets
  ADD COLUMN IF NOT EXISTS qb_oauth_state_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS profile_secrets_qb_oauth_state_unique
  ON profile_secrets (qb_oauth_state)
  WHERE qb_oauth_state IS NOT NULL;
