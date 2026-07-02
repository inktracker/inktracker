-- SanMar supplier credentials — third supplier alongside S&S (ss_*) and
-- AS Colour (ac_*). SanMar's web services authenticate every SOAP call with
-- the shop's SanMar customer number + sanmar.com username + password, so all
-- three live in profile_secrets (service-role-only; see 20260504_profile_secrets).
alter table public.profile_secrets
  add column if not exists sanmar_customer_number text,
  add column if not exists sanmar_username text,
  add column if not exists sanmar_password text;
