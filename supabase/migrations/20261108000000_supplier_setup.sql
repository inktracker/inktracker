-- In-app supplier setup progress for S&S Activewear and AS Colour (2026-09-16),
-- the sibling of profiles.sanmar_po_onboarding. Non-secret progress only
-- (credentials stay in profile_secrets):
--
--   { ss: { verified_at, verified_account },
--     ac: { api_requested_at, verified_at, credit_requested_at, credit_approved_at } }
--
-- "verified" = the supplierSetup edge function made a real authenticated call
-- with the SHOP'S OWN credentials and it succeeded — proof the account that
-- will be billed for orders is the one connected. Written only by edge
-- functions (service role); readable by the shop via existing profiles RLS.

alter table public.profiles
  add column if not exists supplier_setup jsonb not null default '{}'::jsonb;
