-- Preserve Completed orders forever.
--
-- BEFORE this migration: Production.jsx's handleComplete called
-- Order.delete() once an order finished, which wiped the orders row
-- and left the corresponding invoice with a dangling order_id. Joe
-- discovered this when "View Order" on every invoice he had ever
-- completed showed "Order not found" — verified by query: 100% of
-- his invoices with an order_id pointed to deleted orders.
--
-- AFTER this migration:
--
--   1. orders gains a `completed_date` column so the completion
--      timestamp can be stored alongside the status. (Orders.jsx
--      already wrote this field in code, but the column didn't
--      exist — so the write silently dropped on the floor.)
--
--   2. A BEFORE DELETE trigger refuses any DELETE on a row whose
--      status = 'Completed'. This is the hard-coded enforcement —
--      even a service-role client or a careless future PR cannot
--      delete a completed order. The trigger raises a clear
--      exception so the error is visible at the call site instead
--      of failing silently.
--
-- Reverting: drop the trigger, drop the function, drop the column.
-- No data loss — the column is additive and only stores a date.

-- 1. Column for the completion date.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS completed_date date;

-- 2. The guard function. SECURITY DEFINER not needed — trigger
--    functions run with the privileges of the triggering session,
--    but the check itself is just a column read.
CREATE OR REPLACE FUNCTION public.refuse_completed_order_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'Completed' THEN
    RAISE EXCEPTION
      'Cannot delete a Completed order (order_id: %, customer: %). Completed orders are preserved as historical records — update the status instead if you really mean it.',
      OLD.order_id, OLD.customer_name
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;

-- 3. The trigger. BEFORE DELETE so the exception aborts the
--    transaction before anything is removed.
DROP TRIGGER IF EXISTS refuse_completed_order_delete_trg ON public.orders;
CREATE TRIGGER refuse_completed_order_delete_trg
  BEFORE DELETE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.refuse_completed_order_delete();
