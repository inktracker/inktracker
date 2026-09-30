-- Broker billing: persist the WHOLESALE invoice total on the order at bill
-- time. Previously only the invoice id / doc / pay link were stored, so no
-- surface could show the actual amount due — the broker's "Due — $X" fell back
-- to the saved quote wholesale (stale if the order was edited after
-- conversion), and the shop had no accurate broker-AR total at all. qbSync's
-- createInvoice returns the authoritative QB TotalAmt (qbTotal); billBrokerForOrder
-- stamps it here so both the broker view and the new shop broker-AR view show
-- the real invoiced amount.

alter table public.orders
  add column if not exists qb_broker_invoice_total numeric;

comment on column public.orders.qb_broker_invoice_total is
  'The wholesale amount billed to the broker (QB TotalAmt of the shop→broker invoice), stamped by billBrokerForOrder. Nullable for orders billed before this column existed.';
