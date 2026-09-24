-- Broker contact columns on quotes.
--
-- BrokerDashboard.handleSaveQuote stamps broker_phone (plus broker_name /
-- broker_company / broker_email) onto every broker quote so the Shop Order
-- Form PDF can print them (pdfExport reads quote.broker_phone). broker_phone
-- was only ever added to profiles, so since #892 every broker quote insert
-- failed with PGRST204 ("column not found") and brokers saw a generic
-- "Something went wrong" on save. Idempotent — safe if any already exist.

alter table public.quotes add column if not exists broker_phone   text;
alter table public.quotes add column if not exists broker_name    text;
alter table public.quotes add column if not exists broker_company text;
alter table public.quotes add column if not exists broker_email   text;
