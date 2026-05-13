-- Stripe Connect (Express) for direct charges.
--
-- When a shop connects Stripe, we store their Stripe account ID and
-- a coarse status string on their shops row. createCheckoutSession
-- uses the account ID to route customer payments DIRECTLY to the shop
-- (Direct Charges model — shop is merchant of record, their name on
-- the customer's CC statement, InkTracker never touches the money,
-- no platform fee).
--
-- stripe_account_status values written by stripeWebhook (account.updated):
--   "pending"     — account created, onboarding not finished
--   "active"      — details_submitted=true && charges_enabled=true
--   "restricted"  — details_submitted=true but charges_enabled=false
--                   (Stripe needs more info, action needed in dashboard)
--   "disabled"    — disabled by Stripe / closed by shop
--
-- NULL preserves current behavior: shop has not connected Stripe yet,
-- the Stripe radio in SendQuoteModal stays disabled with "Connect
-- Stripe in Account first."

ALTER TABLE public.shops
  ADD COLUMN IF NOT EXISTS stripe_account_id      text,
  ADD COLUMN IF NOT EXISTS stripe_account_status  text;

-- Index for the webhook's lookup-by-account-id path (every connected
-- account event needs to find which shop it belongs to).
CREATE INDEX IF NOT EXISTS shops_stripe_account_id_idx
  ON public.shops (stripe_account_id)
  WHERE stripe_account_id IS NOT NULL;
