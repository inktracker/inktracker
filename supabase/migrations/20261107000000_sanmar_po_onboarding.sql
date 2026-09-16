-- SanMar PO-integration onboarding, driven from inside InkTracker (2026-09-16).
--
-- SanMar enables integrated purchase orders PER CUSTOMER ACCOUNT: the shop
-- requests access, SanMar issues separate EDEV (test) credentials, the shop
-- submits a multi-line test PO on EDEV, emails SanMar the PO number, and
-- SanMar then configures the production account. Instead of each shop doing
-- that by hand (email + PDF guide + a script), the smOnboarding edge function
-- walks them through it with buttons. This migration adds the storage:
--
--   profile_secrets.sanmar_edev_username / sanmar_edev_password
--     SanMar's EDEV credentials (secret; service-role-only table). The
--     customer number is the same as production.
--
--   profiles.sanmar_po_onboarding jsonb
--     Non-secret progress: { status, requested_at, edev_saved_at, tests[],
--     notified_at, payment_method, live_at }. status ∈ not_started |
--     requested | edev_ready | tested | awaiting_sanmar | live. Only
--     status = 'live' lets smPlaceOrder post a real order for the shop.
--     Written only by edge functions (service role); readable by the shop
--     through the existing profiles RLS.

alter table public.profile_secrets
  add column if not exists sanmar_edev_username text,
  add column if not exists sanmar_edev_password text;

alter table public.profiles
  add column if not exists sanmar_po_onboarding jsonb not null default '{}'::jsonb;
