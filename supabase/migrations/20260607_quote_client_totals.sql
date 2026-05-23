-- Snapshot client-side totals on broker quotes.
--
-- Until now the only saved totals on a quote were broker-side
-- (what the shop charges the broker). The client-side totals
-- (what the broker charges the end client) were recomputed live
-- in every viewer — broker dashboard, client-form PDF, broker
-- invoices tab. That recomputation reads the current viewer's
-- pricing config, which can differ between users (different shops,
-- brokers vs admins) and silently produced different "client total"
-- numbers depending on who opened the quote.
--
-- The contract going forward: a saved quote is a snapshot. Both
-- broker-side and client-side totals are stamped at save time and
-- read straight through by every viewer. No recalculation.
--
-- Columns:
--   client_subtotal  — sum of (clientPpp || live client ppp) * qty
--                       across line items, BEFORE discount, INCLUDING rush
--   client_tax        — tax amount at the broker's chosen rate
--                       (broker_tax_rate). 0 for tax-exempt customers.
--   client_total      — client_subtotal - discount + client_tax
--
-- Non-broker quotes leave these at 0 (untouched). The columns are
-- only consulted on broker quotes.

alter table quotes
  add column if not exists client_subtotal numeric not null default 0,
  add column if not exists client_tax       numeric not null default 0,
  add column if not exists client_total     numeric not null default 0;

comment on column quotes.client_subtotal is
  'Snapshot: sum of client-facing per-piece prices × qty (incl rush, pre-discount). Broker quotes only. Stamped by BrokerQuoteEditor at save time so viewers never recompute the client total.';
comment on column quotes.client_tax is
  'Snapshot: tax the broker charges their end client (broker_tax_rate applied to discounted client_subtotal). Broker quotes only.';
comment on column quotes.client_total is
  'Snapshot: what the end client pays the broker. = client_subtotal − discount + client_tax. Broker quotes only.';
