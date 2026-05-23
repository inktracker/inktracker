-- ============================================================================
-- Backfill `orders.completed_date` AGAIN — second pass.
-- ============================================================================
-- The first backfill (20260520030000_backfill_completed_date.sql) ran on
-- 2026-05-20. Between then and now, any order marked Completed via the
-- plain arrow-advance button (Production.jsx / Orders.jsx → handleAdvance)
-- got `status = 'Completed'` set without a `completed_date` stamp, because
-- handleAdvance only updated the status string. The other path —
-- handleComplete (the "complete + invoice" button) — has always stamped
-- the date correctly.
--
-- Application-level fix shipped with this migration:
--   - Production.jsx handleAdvance now stamps completed_date when the
--     next status is Completed.
--   - Orders.jsx handleAdvance does the same.
--
-- This SQL cleans up the rows that were silently null'd between
-- 2026-05-20 and the fix. Same heuristic as the earlier backfill, same
-- idempotent shape: only touches Completed rows where completed_date is
-- still null. Safe to re-run.
--
-- Heuristic (most-accurate first):
--   1. paid_date — usually within a day or two of completion.
--   2. created_at::date — last resort. Far from when the order actually
--      completed but at least the green chip lands somewhere chronologically
--      reasonable, so the shop owner can correct it by editing the order.
-- ============================================================================

UPDATE orders
SET completed_date = COALESCE(paid_date, created_at::date)
WHERE status = 'Completed'
  AND completed_date IS NULL;
