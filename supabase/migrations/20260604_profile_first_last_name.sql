-- Add first/last name to profiles so the app can address shop
-- owners by their first name instead of email.
--
-- Existing `full_name` is kept for backward compat (30+ usages
-- across broker UI, admin panel, dashboard, etc.). The Account
-- page now edits first_name + last_name as the source of truth
-- and writes full_name = TRIM(first || ' ' || last) on save so
-- legacy consumers keep working.
--
-- Backfill: best-effort split of existing full_name on the first
-- whitespace. Single-token names ("Madonna") become first_name
-- with last_name NULL. Names with three+ tokens ("Mary Ann Smith")
-- become first_name = "Mary" + last_name = "Ann Smith" — imperfect
-- but better than blanking everyone.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name  TEXT;

-- Backfill from full_name. Only touches rows where first_name is
-- still NULL — re-running this migration is a no-op.
UPDATE public.profiles
SET
  first_name = NULLIF(TRIM(SPLIT_PART(full_name, ' ', 1)), ''),
  last_name  = CASE
    WHEN POSITION(' ' IN full_name) > 0
    THEN NULLIF(TRIM(SUBSTRING(full_name FROM POSITION(' ' IN full_name) + 1)), '')
    ELSE NULL
  END
WHERE full_name IS NOT NULL
  AND TRIM(full_name) <> ''
  AND first_name IS NULL;
