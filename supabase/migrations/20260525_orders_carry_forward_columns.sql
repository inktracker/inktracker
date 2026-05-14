-- Backfill columns that buildOrderFromQuote has been writing all along
-- but were never added to the orders schema. The conversion was failing
-- silently for any quote that had real values in these fields, surfacing
-- as "Could not find the 'customer_email' column of 'orders' in the
-- schema cache" once we added visible error reporting in handleConvert.
--
-- Each column is consumed downstream:
--   customer_email      → OrderDetailModal (invoice send), pdfExport
--   quote_id            → OrderDetailModal (originating quote / message
--                         thread / invoice lookup), pdfExport header
--   broker_name         → pdfExport (header)
--   broker_company      → pdfExport (header)
--   broker_client_name  → BrokerPerformance, pdfExport
--   job_title           → OrderDetailModal
--   discount_type       → OrderDetailModal, pdfExport, BrokerOrderPDFModal
--   deposit_paid        → carried forward from quote so a deposit isn't
--                         requested twice on order conversion
--
-- All nullable / defaulted so existing rows are unaffected.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS customer_email      TEXT,
  ADD COLUMN IF NOT EXISTS quote_id            TEXT,
  ADD COLUMN IF NOT EXISTS broker_name         TEXT,
  ADD COLUMN IF NOT EXISTS broker_company      TEXT,
  ADD COLUMN IF NOT EXISTS broker_client_name  TEXT,
  ADD COLUMN IF NOT EXISTS job_title           TEXT,
  ADD COLUMN IF NOT EXISTS discount_type       TEXT DEFAULT 'percent',
  ADD COLUMN IF NOT EXISTS deposit_paid        BOOLEAN DEFAULT FALSE;

-- quote_id is the link OrderDetailModal walks for invoice/message
-- thread/header — index it so the lookup is a btree hit rather than a
-- seq scan as the orders table grows.
CREATE INDEX IF NOT EXISTS orders_quote_id_idx
  ON public.orders (quote_id)
  WHERE quote_id IS NOT NULL;
