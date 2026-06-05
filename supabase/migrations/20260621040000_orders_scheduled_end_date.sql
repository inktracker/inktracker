-- Multi-day press scheduling — a job that takes 16 hrs can run
-- Mon + Tue on the same press. `scheduled_date` is the start day;
-- `scheduled_end_date` is the last day. When unset, the scheduler
-- treats it as a single-day job ending on the start date.
--
-- Capacity-per-day in the UI is now `estimated_hours / span_days`
-- so a 16-hr job over 2 days shows as 8 hrs on each day, rather
-- than 16/8 (overcapacity) on day one and nothing on day two.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS scheduled_end_date DATE;

-- Defensive check: end_date should never be before start_date. The
-- frontend gates this, but a CHECK keeps the database honest in
-- case of a future scripted update.
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_schedule_range_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_schedule_range_check
    CHECK (
      scheduled_end_date IS NULL
      OR scheduled_date IS NULL
      OR scheduled_end_date >= scheduled_date
    );
