-- Feature request (clients): order forms should show the date the order was
-- created — i.e. the date the quote was approved/converted into an order.
--
-- The order row already has a `created_at` insert timestamp, but:
--   * it's a UTC timestamptz, so formatting it to a date can drift a day near
--     midnight relative to the shop's timezone, and
--   * every other order milestone (`date`, `due_date`, `completed_date`) is
--     stored as a plain shop-tz `date`, so the form/PDF should read a matching
--     `date` field, not a timestamptz.
--
-- Add an explicit `order_date` (set in shop-tz at conversion by
-- buildOrderFromQuote) and backfill historical rows from `created_at` so old
-- orders still render a sensible date.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS order_date date;

-- Idempotent backfill: only touch rows that don't already have one.
UPDATE public.orders
SET order_date = created_at::date
WHERE order_date IS NULL;
