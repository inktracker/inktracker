-- Add broker_tax_rate to quotes so brokers can charge their end client
-- sales tax independently of the shop's tax_rate (the shop never charges
-- tax to a broker — broker is B2B — but the broker may need to collect
-- sales tax from their client).
--
-- Used only when rendering broker quotes in client mode (Client Form PDF
-- and broker price panel client total). Shop form / order form still use
-- 0% because the broker is the shop's customer.

alter table quotes
  add column if not exists broker_tax_rate numeric not null default 0;

comment on column quotes.broker_tax_rate is
  'Tax rate the broker charges their end client. Independent of tax_rate (which is the shop-to-customer rate, always 0 for broker quotes). Only consulted when rendering the broker''s client-facing PDF / pricing.';
