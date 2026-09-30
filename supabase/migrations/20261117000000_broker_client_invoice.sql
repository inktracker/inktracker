-- Broker client invoicing (Phase B): the broker invoices their END CLIENT at
-- the CLIENT price in the BROKER's own QuickBooks. Tracked on the quote in its
-- OWN columns — never quotes.qb_invoice_id, which belongs to the SHOP's realm.
-- Keeping them separate means the shop's reconcile/webhook (which run against
-- the shop's QB) never touch the broker's client invoice (a different realm).

alter table public.quotes
  add column if not exists qb_broker_client_invoice_id        text,
  add column if not exists qb_broker_client_doc_number        text,
  add column if not exists qb_broker_client_payment_link      text,
  add column if not exists qb_broker_client_invoice_synced_at timestamptz,
  add column if not exists broker_client_invoice_paid         boolean not null default false,
  add column if not exists broker_client_invoice_paid_at      timestamptz;

comment on column public.quotes.qb_broker_client_invoice_id is
  'QB invoice id for the broker->client bill, in the BROKER''s realm (not the shop''s). Separate from qb_invoice_id so the shop''s reconcile never touches it.';
