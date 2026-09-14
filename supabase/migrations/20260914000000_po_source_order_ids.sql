-- Consolidated purchase orders cover blanks from MANY customer orders at once,
-- but purchase_orders.source_order_id is a single UUID (the one-order-per-PO
-- model). Add a nullable array of ALL covered order ids so a consolidated PO
-- can (a) tick every covered order's "goods ordered" checklist on submit and
-- (b) register as THE purchase order for each of those orders (so none of them
-- re-prompt "Create PO" and spawn a duplicate). The scalar source_order_id is
-- left intact for the existing single-order flow.
alter table public.purchase_orders
  add column if not exists source_order_ids jsonb not null default '[]'::jsonb;

comment on column public.purchase_orders.source_order_ids is
  'All customer order ids (uuids) this PO covers — used by consolidated POs that batch blanks across several orders. Single-order POs keep using source_order_id.';
