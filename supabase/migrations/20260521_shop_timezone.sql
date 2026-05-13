-- Shop timezone — lets the calendar/production "today" calculation respect
-- the shop's location instead of whatever timezone the user's browser is in.
-- Solves: an employee logging in from a different state would see the
-- calendar's "today" highlight on the wrong day.
--
-- Nullable text column, IANA timezone name (e.g. "America/Los_Angeles").
-- NULL means "fall back to the user's browser timezone" — preserves current
-- behavior for shops that haven't set it yet.

ALTER TABLE public.shops
  ADD COLUMN IF NOT EXISTS timezone text;
