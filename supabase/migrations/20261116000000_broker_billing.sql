-- Broker billing (Phase A): the shop bills the broker for the wholesale amount
-- when a broker order completes. This invoice lives in the SHOP's QuickBooks,
-- billed to the broker, at wholesale, B2B (no tax). It is tracked on the order
-- in its OWN columns — deliberately NOT quotes/invoices.qb_invoice_id, so the
-- reconcile/webhook layer never compares this wholesale invoice against the
-- quote's client total (which would fire permanent false books-drift).

alter table public.orders
  add column if not exists qb_broker_invoice_id        text,
  add column if not exists qb_broker_doc_number        text,
  add column if not exists qb_broker_payment_link      text,
  add column if not exists qb_broker_invoice_synced_at timestamptz,
  add column if not exists broker_invoice_paid         boolean not null default false,
  add column if not exists broker_invoice_paid_at      timestamptz;

comment on column public.orders.qb_broker_invoice_id is
  'QB invoice id for the shop→broker wholesale bill (shop''s realm). Separate from any client invoice so reconcile ignores it.';

-- Mark a customers row that actually represents a broker (a wholesale B2B
-- account created to bill the broker), so it can be labeled / filtered out of
-- the normal customer list later. Optional; billing works without reading it.
alter table public.customers
  add column if not exists is_broker_account boolean not null default false;

comment on column public.customers.is_broker_account is
  'True when this customer record represents a broker being billed wholesale (created by broker billing), not an end customer.';
