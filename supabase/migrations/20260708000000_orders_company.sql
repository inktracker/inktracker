-- Denormalize customer company onto orders so every order surface (customer-
-- facing status / art-approval pages, broker views) can render COMPANY first,
-- matching quotes (which already carry `company`). Orders previously stored only
-- customer_name, forcing those anon pages to show the contact name.
-- See feedback_company_name_first.

alter table public.orders
  add column if not exists company text;

comment on column public.orders.company is
  'Denormalized customer company (company-first display). Copied from the source quote/customer at conversion. Added 2026-06-18.';

-- Backfill existing orders from the (authoritative) customer record.
-- orders.customer_id is text; customers.id is uuid — cast to compare.
update public.orders o
set company = c.company
from public.customers c
where c.id::text = o.customer_id
  and (o.company is null or o.company = '')
  and c.company is not null
  and c.company <> '';
