-- Track the QuickBooks REFRESH token's expiry (~100 days).
--
-- We already store qb_token_expires_at, but that's the ~1-hour ACCESS token,
-- which auto-refreshes hourly and is invisible to the shop. The refresh token
-- is the one whose lapse silently breaks the connection — the next QB action
-- then fails mid-flow with invalid_grant and no prior warning. Storing its
-- expiry (from Intuit's x_refresh_token_expires_in) lets the UI nudge the shop
-- to reconnect before it dies.
--
-- Additive + nullable: existing connections made before this simply have null
-- (no warning until their next token refresh repopulates it). Tokens live only
-- on profile_secrets (legacy profiles columns were dropped in 20260520).

alter table profile_secrets
  add column if not exists qb_refresh_token_expires_at timestamptz;
