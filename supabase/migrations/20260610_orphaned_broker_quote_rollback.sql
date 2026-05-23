-- Roll back broker quotes whose `converted_order_id` points at an order
-- that no longer exists. Before today's fix (handleBrokerOrderDeletion),
-- the shop could delete an order without resetting the source quote —
-- leaving the broker staring at a "Converted to Order" status for a job
-- that had no underlying order row.
--
-- This one-shot cleanup:
--   - Finds quotes where status = 'Converted to Order' AND
--     converted_order_id is set but doesn't match any current order
--   - Rolls them back to 'Client Approved' (the step before submission)
--     so the broker can resubmit if they want
--   - Clears converted_order_id and shop_owner so the row drops out of
--     the shop's queue
--
-- Idempotent: only touches rows where the orphan condition holds. Running
-- this again is a no-op.

UPDATE quotes q
SET
  status              = 'Client Approved',
  converted_order_id  = NULL,
  shop_owner          = NULL
WHERE q.status = 'Converted to Order'
  AND q.converted_order_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM orders o WHERE o.order_id = q.converted_order_id
  );
