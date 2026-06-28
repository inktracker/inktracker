-- Phase 1 of multi-state tax (docs/qb-multistate-tax-scope.md): structured
-- ship-to address so QuickBooks Automated Sales Tax can source destination tax.
--
-- The legacy `address` is a single free-text line (kept as bill-to / display).
-- AST sources the jurisdiction from state + ZIP, which a Line1-only address
-- can't provide — so it falls back to the shop's home rate. This column holds
-- the structured destination used to build a proper QB ShipAddr.
--
-- Shape: { street, city, state, zip, country }  (state = 2-letter, country = US default).
-- Matches the keys lib/tax/quickbooksTaxProvider.js already expects.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS ship_to_address jsonb;

COMMENT ON COLUMN public.customers.ship_to_address IS
  'Structured ship-to for sales-tax sourcing: { street, city, state, zip, country }. Sent to QuickBooks as ShipAddr so AST computes destination tax. Legacy `address` remains the free-text bill-to/display.';
