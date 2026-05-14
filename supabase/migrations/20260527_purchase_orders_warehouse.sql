-- PO-level warehouse selector.
--
-- AS Colour items each carry a warehouse, but typical use is one
-- warehouse per order. Store it on the PO row and apply to every
-- item at submit time. Per-item warehouses can be added later if
-- shops actually need splits.
--
-- Default "USA" matches the most common case; AS Colour also exposes
-- "AUS" and "NZ". Older draft rows pick up USA automatically.

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS warehouse TEXT DEFAULT 'USA';
