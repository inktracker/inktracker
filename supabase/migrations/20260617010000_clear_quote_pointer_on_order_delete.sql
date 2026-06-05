-- Extend the cascade-delete trigger to also clean up orphaned
-- quote pointers when an order is deleted.
--
-- Background: 20260617000000 added a cascade for shop_performance +
-- broker_performance. But a converted quote ALSO carries a pointer
-- to its order (quotes.converted_order_id, quotes.converted_at) —
-- and that pointer was getting orphaned the same way. Symptom:
-- after the user deleted a converted order, the quote stayed in the
-- DB with `converted_order_id` pointing at the now-gone order. The
-- Calendar then showed "ghost" Quote Sent / Quote Approved chips
-- for it that, when clicked, navigated to /Orders (because
-- resolveQuoteLink treats `converted_order_id` set as "looks
-- converted" — and routed there) — landing on the empty Orders page.
--
-- Two-part fix:
--   (a) One-time cleanup: find every quote whose converted_order_id
--       points at a non-existent order and clear the pointer. Status
--       is reset to "Approved" so the quote becomes visible in
--       /Quotes again (the user can decide whether to re-convert or
--       delete). We don't try to recover the pre-conversion status
--       because that value isn't preserved on the row.
--   (b) Extend the cascade trigger: on order delete, run the same
--       cleanup for the matching tenant. Future order deletes won't
--       leak quote-side ghosts.
--
-- We do NOT delete the quote itself. Quote → Order is a transition;
-- losing the quote's historical record on an order delete would
-- silently destroy audit trail (especially for broker quotes where
-- the originating thread is on the quote row).

-- ── 1. One-time orphan cleanup ──────────────────────────────────────

UPDATE public.quotes q
SET converted_order_id = NULL,
    converted_at       = NULL,
    -- "Approved" is the closest universally-true status for a
    -- previously-converted quote — they were at least approved to
    -- get converted in the first place. Operators can re-route from
    -- there (re-convert, delete, decline) via the normal UI.
    status = 'Approved'
WHERE q.converted_order_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.order_id   = q.converted_order_id
      AND o.shop_owner = q.shop_owner
  );

-- ── 2. Extend the trigger function ──────────────────────────────────
-- Same SECURITY DEFINER guarantees as the previous version. Tenant-
-- scoped by (order_id, shop_owner) so we never touch another shop's
-- quotes on an order_id collision.

CREATE OR REPLACE FUNCTION public.cascade_performance_on_order_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.shop_performance
   WHERE order_id   = OLD.order_id
     AND shop_owner = OLD.shop_owner;

  DELETE FROM public.broker_performance
   WHERE order_id   = OLD.order_id
     AND shop_owner = OLD.shop_owner;

  -- Clear the originating quote's pointer so it doesn't surface as a
  -- ghost chip on the Calendar or as a dead-link click target. The
  -- quote itself is preserved (audit trail). Status reset to
  -- "Approved" so the quote is reachable in /Quotes again.
  UPDATE public.quotes
     SET converted_order_id = NULL,
         converted_at       = NULL,
         status             = 'Approved'
   WHERE converted_order_id = OLD.order_id
     AND shop_owner         = OLD.shop_owner;

  RETURN OLD;
END;
$$;

-- Trigger itself is unchanged (BEFORE DELETE on orders) — the
-- function body is what we redefined. No DROP/CREATE needed.

COMMENT ON FUNCTION public.cascade_performance_on_order_delete IS
  'BEFORE DELETE trigger on orders. Removes denormalized analytics rows (shop_performance, broker_performance) AND clears the converted_order_id pointer on the originating quote so it doesn''t surface as a ghost chip on Calendar. Tenant-scoped by (order_id, shop_owner). SECURITY DEFINER so the cascade fires regardless of caller role.';
