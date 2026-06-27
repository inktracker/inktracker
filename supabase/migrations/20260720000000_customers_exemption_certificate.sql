-- Phase 2 of multi-state tax (docs/qb-multistate-tax-scope.md): exemption
-- certificates. A bare `tax_exempt = true` is an audit liability — to defend
-- an exemption you need the type, the certificate, where it applies, and when
-- it expires. These columns capture that; `tax_exempt` stays the master switch.
--
--   exemption_type            resale | government | nonprofit | other
--   exemption_certificate_number  the permit / certificate number
--   exemption_certificate_path    storage path (artwork bucket) of the cert PDF/image
--   exemption_expires_at      cert expiry (valid THROUGH this date); after it
--                             the exemption is inactive → collect tax
--   exemption_states          jsonb array of 2-letter states the cert covers;
--                             null/empty = blanket (applies wherever exempt)
--
-- `tax_id` (existing) remains the customer's general tax ID / EIN — distinct
-- from the exemption certificate number.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS exemption_type                text,
  ADD COLUMN IF NOT EXISTS exemption_certificate_number  text,
  ADD COLUMN IF NOT EXISTS exemption_certificate_path    text,
  ADD COLUMN IF NOT EXISTS exemption_expires_at          date,
  ADD COLUMN IF NOT EXISTS exemption_states              jsonb;

COMMENT ON COLUMN public.customers.exemption_type IS 'resale | government | nonprofit | other — basis for the tax exemption.';
COMMENT ON COLUMN public.customers.exemption_certificate_number IS 'Exemption / resale certificate number (distinct from tax_id).';
COMMENT ON COLUMN public.customers.exemption_certificate_path IS 'Storage path (artwork bucket) of the uploaded certificate document; view via signArtworkUrl.';
COMMENT ON COLUMN public.customers.exemption_expires_at IS 'Certificate expiry; valid through this date. After it the exemption is inactive and tax is collected.';
COMMENT ON COLUMN public.customers.exemption_states IS 'jsonb array of 2-letter states the certificate covers; null/empty = blanket.';
