-- Cascade cleanup of denormalized performance rows when an order is deleted.
--
-- Background: shop_performance and broker_performance are append-only
-- analytics archives. A row is written when an order completes
-- (buildOrderCompletionPlan emits shopPerformanceCreate +
-- brokerPerformanceCreate). They are NOT FK-linked to orders — they
-- snapshot what the order looked like at completion, then the order
-- can change or be deleted without losing the historical record.
--
-- That worked when shops never deleted completed orders. But on
-- 2026-05-30 Joe deleted a stack of test orders ("My Name" customer)
-- and the Performance page kept counting them in stats because the
-- shop_performance rows survived. The Calendar had the same class of
-- bug for quote chips, fixed at read time.
--
-- This migration fixes performance the right way: a BEFORE DELETE
-- trigger on `orders` removes the matching shop_performance and
-- broker_performance rows for the SAME tenant. The read-time filter
-- in Performance.jsx (added the same day) stays as defense in depth
-- — covers any orphans that slipped through before this trigger
-- existed.
--
-- Tenant safety: the trigger filters by BOTH order_id AND shop_owner.
-- order_id is human-readable (ORD-XXXX) and could collide across
-- tenants on imported data. The shop_owner filter makes the cascade
-- tenant-scoped — never cross-shop.

-- ── 1. One-time orphan cleanup ──────────────────────────────────────
-- Remove rows whose referenced order no longer exists. After this,
-- the trigger keeps things clean going forward.

DELETE FROM public.shop_performance sp
WHERE NOT EXISTS (
  SELECT 1 FROM public.orders o
  WHERE o.order_id   = sp.order_id
    AND o.shop_owner = sp.shop_owner
);

DELETE FROM public.broker_performance bp
WHERE NOT EXISTS (
  SELECT 1 FROM public.orders o
  WHERE o.order_id   = bp.order_id
    AND o.shop_owner = bp.shop_owner
);

-- ── 2. Trigger function ─────────────────────────────────────────────
-- Runs as the table owner (SECURITY DEFINER) so the cleanup happens
-- regardless of which role issued the DELETE. Without this, an
-- authenticated user deleting their own order would still need write
-- access to broker_performance rows — they have it via RLS, but a
-- service role caller hitting bypasses RLS, and a future tightening
-- of the broker_performance policy could break the cascade silently.
-- DEFINER + explicit schema search_path is the safer default.

CREATE OR REPLACE FUNCTION public.cascade_performance_on_order_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Tenant-scoped: never delete across shop_owners on an order_id
  -- collision. The OLD row's shop_owner is the authoritative tenant
  -- for this cleanup.
  DELETE FROM public.shop_performance
   WHERE order_id   = OLD.order_id
     AND shop_owner = OLD.shop_owner;

  DELETE FROM public.broker_performance
   WHERE order_id   = OLD.order_id
     AND shop_owner = OLD.shop_owner;

  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION public.cascade_performance_on_order_delete IS
  'BEFORE DELETE trigger on orders. Removes shop_performance + broker_performance rows for the same (order_id, shop_owner) so Performance stats stop counting deleted orders. SECURITY DEFINER so the cascade fires regardless of caller role.';

-- ── 3. Trigger ──────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS cascade_performance_on_order_delete ON public.orders;

CREATE TRIGGER cascade_performance_on_order_delete
  BEFORE DELETE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.cascade_performance_on_order_delete();
