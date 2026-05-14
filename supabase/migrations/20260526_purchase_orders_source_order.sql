-- Link a PO back to the customer order that triggered it.
--
-- "Order from AS Colour" on the OrderDetailModal creates a draft PO
-- pre-filled with the order's AC line items. We need to remember that
-- linkage so the next time someone opens the order, the button can show
-- "View Pending PO" or "✓ Ordered" instead of inviting a duplicate.
--
-- Stored on purchase_orders rather than orders because:
--   - one customer order can spawn multiple POs (one per supplier);
--   - linkage gets created later, when the PO is created;
--   - existing orders rows don't have to migrate.
--
-- Nullable: standalone POs (created from /PurchaseOrders without an
-- originating customer order) leave it null.

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS source_order_id UUID;

-- Hot path: "does this order already have a PO?" lookup, scoped per-shop.
CREATE INDEX IF NOT EXISTS purchase_orders_source_order_idx
  ON public.purchase_orders (shop_owner, source_order_id)
  WHERE source_order_id IS NOT NULL;
