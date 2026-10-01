-- Bank-transfer discount for InkTracker payments (2026-10-01).
--
-- Joe: pass processing costs to customers without a card surcharge (debit
-- cards can't be surcharged, and Stripe's checkout can't tell credit from
-- debit). Instead the CARD price is the invoice price and customers who pay
-- by bank get a discount, shown on the quote/invoice email, the pay page and
-- Stripe's checkout.
--
-- Books: the QuickBooks invoice stays as issued (its sales tax untouched) and
-- is paid in full; the discount is booked on the payout Deposit alongside
-- processing fees, so the deposit still equals what reached the bank.

-- Per shop, percent off for bank payments. 0 = off (default). Owner sets it.
alter table public.processor_accounts
  add column if not exists bank_discount_pct numeric(4,2) not null default 0
    check (bank_discount_pct >= 0 and bank_discount_pct <= 5);

-- Per payment: the discount the customer got (cents), so the QuickBooks
-- Payment covers the full invoice and the Deposit books the difference.
alter table public.processor_payments
  add column if not exists discount_cents integer not null default 0
    check (discount_cents >= 0);
