-- Shopping List columns on inventory_items.
--
-- Adds three columns that drive the new restock workflow on the
-- Inventory page (replacing the Shopify auto-sync UI):
--
--   supplier      — free-text label users can filter the shopping
--                   list by ("S&S Activewear", "AS Colour", "Local
--                   ink shop", etc.). NULL means "Unspecified" in
--                   the UI.
--
--   ordered_at    — timestamp the user marked the item as ordered.
--                   Items with a non-null ordered_at appear in the
--                   "Pending Delivery" sub-section instead of the
--                   active shopping list.
--
--   ordered_qty   — qty the user said they ordered. Used when they
--                   click "Receive" — we bump qty by ordered_qty
--                   and clear ordered_at + ordered_qty.
--
-- Backfill: items that already have ss_style_number set get a
-- supplier of 'S&S Activewear' so the new filter pills work
-- immediately on existing data without manual cleanup.

ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS supplier    text,
  ADD COLUMN IF NOT EXISTS ordered_at  timestamptz,
  ADD COLUMN IF NOT EXISTS ordered_qty integer;

UPDATE public.inventory_items
SET    supplier = 'S&S Activewear'
WHERE  supplier IS NULL
  AND  ss_style_number IS NOT NULL
  AND  ss_style_number <> '';

-- Index the hot path: shop's pending shopping list (low stock,
-- not yet ordered).
CREATE INDEX IF NOT EXISTS inventory_items_shop_pending_idx
  ON public.inventory_items (shop_owner, supplier)
  WHERE ordered_at IS NULL;
