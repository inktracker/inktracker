-- Per-shop QuickBooks income account for InkTracker invoices.
--
-- Without this, qbSync GUESSES the income account (by name, then the first
-- Income account, then auto-creating "InkTracker Sales"). For a shop whose
-- chart of accounts doesn't match, revenue silently posts to the wrong P&L
-- bucket. These columns let the owner pick the account explicitly in
-- Account → QuickBooks. Nullable: when unset, qbSync keeps the old guessing
-- behavior (default-until-set), so existing shops are unaffected.
--
-- Stored on shops (owner_email-keyed) so it's one setting per shop and qbSync
-- reads it by the quote's shop_owner. Name is kept only for display.

alter table shops
  add column if not exists qb_income_account_id   text,
  add column if not exists qb_income_account_name text;
