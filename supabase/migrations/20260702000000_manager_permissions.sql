-- Per-manager section permissions, set by the shop owner.
--
-- Tester request (2026-06-12): the owner wants to control which parts
-- of the app a manager can see — quotes, orders, customers, invoices,
-- pricing, etc.
--
-- NULL = full access (the default; every existing manager keeps seeing
-- everything, so this is backward-compatible). When set, it's a map of
-- section key → bool; an absent or true key is allowed, false is denied.
-- e.g. {"Invoices": false, "Performance": false} hides those two.
--
-- Only meaningful for role='manager'. Owners/admins are never gated.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS manager_permissions jsonb DEFAULT NULL;
