-- Rip out the founding-member program entirely.
--
-- Background: the program was a $50/mo locked-for-life rate for the
-- first 10 shops to claim it at Stripe checkout. Decided 2026-06-02
-- to remove — all new signups pay the standard $99/mo (or $999/yr).
--
-- What this migration drops:
--   1. profiles.is_founding_member          — column
--   2. profiles.founding_rate_forfeited     — column
--   3. claim_founding_slot(uuid)            — SECURITY DEFINER RPC
--
-- Trade-off acknowledged: any existing founding members lose their
-- recorded flag on the profile. There's nothing in the codebase that
-- still reads these columns after this PR — the matching code removal
-- happens in the same commit. Stripe-side, the $50 founding price
-- still exists; the application no longer routes anyone to it.
--
-- Reversal: re-create the function from
-- 20260603_founding_cap_to_10.sql and re-add the two columns. Existing
-- subscriptions on the founding price would need manual reconciliation
-- against Stripe's customer.subscription records since the local flags
-- are gone.

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS is_founding_member,
  DROP COLUMN IF EXISTS founding_rate_forfeited;

DROP FUNCTION IF EXISTS public.claim_founding_slot(uuid);
