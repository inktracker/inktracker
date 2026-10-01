-- The bank-transfer discount (20261123000000) was replaced by customer-paid
-- fees (20261124000000) the same day, before any shop used it. Apply AFTER
-- the edge functions that no longer read these columns are deployed.
alter table public.processor_accounts drop column if exists bank_discount_pct;
alter table public.processor_payments drop column if exists discount_cents;
