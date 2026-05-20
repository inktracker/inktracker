-- ============================================================================
-- Backfill `orders.completed_date` for historical Completed orders.
-- ============================================================================
-- The calendar now renders a green "Completed" chip on each order's
-- `completed_date` (see PR #199). For orders completed before that field
-- was reliably set, the chip won't show because completed_date is null.
--
-- Backfill heuristic (best-effort, ordered by likely accuracy):
--   1. paid_date — a completed order was usually paid the same day or
--      shortly after. Best signal we have for "when did this ship."
--   2. created_at::date — last-resort fallback. Far from when the
--      order actually completed, but at least the chip shows up
--      somewhere chronologically reasonable.
--
-- After the calendar's chip renders, the shop owner can manually fix
-- any glaringly wrong dates by editing the order.
--
-- Idempotent: only touches Completed orders where completed_date is
-- currently null. Running this again is a no-op.
-- ============================================================================

UPDATE orders
SET completed_date = COALESCE(paid_date, created_at::date)
WHERE status = 'Completed'
  AND completed_date IS NULL;
