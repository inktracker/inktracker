-- Lease lock to serialize QuickBooks token refreshes.
--
-- QB rotates refresh tokens: each refresh invalidates the prior refresh token.
-- If two edge invocations both cross the refresh window at once, they refresh
-- concurrently with the same token; one of the rotated tokens gets clobbered
-- and the next QB call fails with invalid_grant ("randomly disconnected").
--
-- This column is an advisory lease: a refresher atomically claims it with a
-- conditional UPDATE (... WHERE lock IS NULL OR lock < now()-30s), which
-- Postgres serializes via row locks, so only one refresh runs at a time. The
-- 30s stale-reclaim guards against a crashed refresher leaving it stuck.
-- Cleared as part of the token write. Additive + nullable.

alter table profile_secrets
  add column if not exists qb_token_refresh_lock timestamptz;
