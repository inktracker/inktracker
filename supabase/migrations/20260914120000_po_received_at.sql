-- Receiving is TWO separate checks (Joe, 2026-09-14): a PO-level "Received"
-- (the shipment showed up) and a per-line "Checked in" (someone counted the
-- garments in). This column is the first: when the box arrives. Per-line
-- checked-in counts live in the items jsonb (items[].checkedIn), and reconcile
-- to each covered order's floor goods_progress ('received') + shortfall.
alter table public.purchase_orders
  add column if not exists received_at timestamptz;

comment on column public.purchase_orders.received_at is
  'When the shipment was marked Received (PO-level). Distinct from per-line check-in counts in items[].checkedIn.';
