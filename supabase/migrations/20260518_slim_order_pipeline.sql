-- Slim the order pipeline from 8 stages to 5.
--
-- New pipeline:
--   Art Approval → Order Goods → Pre-Press → Printing → Completed
--
-- Dropping: Finishing, QC, Ready for Pickup. Joe's audit decision —
-- for the single-press / garage-shop ICP, these stages are inline
-- with Printing and don't earn a separate kanban column. The
-- Completed status carries the "done" semantics for the customer
-- handoff.
--
-- Safety: verified pre-migration that zero orders are currently in
-- the dropped statuses, so this is a clean drop. No data backfill
-- needed.
--
-- The CHECK constraint must be replaced atomically — drop the old,
-- add the new — so the DB enforces the new pipeline immediately.

DO $$
DECLARE
  v_orphans int;
BEGIN
  -- Belt-and-suspenders: re-verify no orders are in the doomed statuses
  -- at migration time (in case any showed up between PR and apply).
  SELECT count(*) INTO v_orphans
  FROM public.orders
  WHERE status IN ('Finishing', 'QC', 'Ready for Pickup');

  IF v_orphans > 0 THEN
    RAISE EXCEPTION
      'Cannot slim pipeline: % orders are still in Finishing/QC/Ready for Pickup. Move them to Printing or Completed first.',
      v_orphans;
  END IF;
END $$;

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_check
  CHECK (status = ANY (ARRAY[
    'Art Approval'::text,
    'Order Goods'::text,
    'Pre-Press'::text,
    'Printing'::text,
    'Completed'::text
  ]));
