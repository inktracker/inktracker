-- Press scheduler — orders need two new fields to be schedulable:
--   scheduled_date    when the job is planned to run
--   estimated_hours   how long it'll take to run (so per-press,
--                     per-day capacity can be summed)
--
-- Both nullable on purpose: any existing order without these fields
-- shows up in the scheduler's "Unscheduled" pool until the operator
-- drags it onto a press lane. `actual_labor_hours` already exists
-- and is kept distinct — it's what was logged AFTER the job ran;
-- estimated_hours is the upfront plan.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS scheduled_date  DATE,
  ADD COLUMN IF NOT EXISTS estimated_hours NUMERIC;

-- Helpful index for the press-lane query (filter by assigned_press +
-- range of scheduled_date). The existing shop_owner index covers the
-- outer scope; this one speeds up the per-shop drill-down.
CREATE INDEX IF NOT EXISTS orders_press_schedule_idx
  ON public.orders (shop_owner, scheduled_date)
  WHERE scheduled_date IS NOT NULL;
