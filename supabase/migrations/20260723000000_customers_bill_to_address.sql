-- Structured billing address on customers, parallel to ship_to_address.
-- The customer form now captures Billing + Shipping as discrete fields (with a
-- "Same as billing" copy). The legacy free-text `address` column is kept and
-- derived from this on save (QB BillAddr + customer-list display still read it).
--
-- Shape: { street, city, state, zip, country }  (matches ship_to_address).

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS bill_to_address jsonb;

COMMENT ON COLUMN public.customers.bill_to_address IS
  'Structured billing address { street, city, state, zip, country }. The legacy `address` text is kept in sync (derived) for back-compat.';
