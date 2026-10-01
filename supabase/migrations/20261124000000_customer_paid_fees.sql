-- Customers pay the processing fee (2026-10-01), replacing the bank-transfer
-- discount from 20261123000000 (its columns are dropped in 20261125000000,
-- after the edge functions stop reading them).
--
-- Per shop, off by default. When on: credit cards pay a 2.99% surcharge
-- (never debit/prepaid; US card rules cap it at 3%), bank payments pay
-- bank_fee_pct (0–1%). The quote shows the plain total with a note; the pay
-- page shows the exact fee before the customer pays.
alter table public.processor_accounts
  add column if not exists customer_fees_enabled boolean not null default false,
  -- When the owner confirmed surcharging is allowed in their state and that
  -- they've told their card networks (Visa asks for notice first).
  add column if not exists customer_fees_ack_at timestamptz,
  add column if not exists bank_fee_pct numeric(3,2) not null default 1
    check (bank_fee_pct >= 0 and bank_fee_pct <= 1);

-- The fee the customer paid on top of the invoice (card surcharge or bank
-- fee). The QuickBooks Payment is amount_cents − customer_fee_cents (the
-- invoice); the fee is booked on the payout Deposit.
alter table public.processor_payments
  add column if not exists customer_fee_cents integer not null default 0
    check (customer_fee_cents >= 0);
