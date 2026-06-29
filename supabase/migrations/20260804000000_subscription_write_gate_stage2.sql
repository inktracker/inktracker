-- Subscription write gate — STAGE 2 (audit BILL-02).
--
-- Stage 1 (20260726) gated quotes + orders owner writes with
-- has_active_subscription() and has run cleanly in prod. This extends the SAME
-- guard to the remaining owner write policies, so a lapsed shop owner can't
-- create/modify ANY of their tenant data (reads/exports still work — WITH CHECK
-- only, USING untouched).
--
-- All nine policies share the identical, never-redefined check
-- `shop_owner = auth.jwt()->>'email'`, so each ALTER just appends the guard.
-- has_active_subscription() is fail-safe (admins/brokers + unresolved state →
-- allowed; only a clearly-lapsed sub is blocked).
--
-- Stage 3 (follow-up): the team/assigned-shop write paths (orders_employee,
-- purchase_orders_insert/update, any manager/broker write policies). The owner
-- is the common case and matches stage 1's scope; team gating needs each
-- policy's assigned-shops clause reconstructed, handled separately.

ALTER POLICY "customers_owner"        ON public.customers
  WITH CHECK (shop_owner = auth.jwt()->>'email' AND public.has_active_subscription());
ALTER POLICY "invoices_owner"         ON public.invoices
  WITH CHECK (shop_owner = auth.jwt()->>'email' AND public.has_active_subscription());
ALTER POLICY "expenses_owner"         ON public.expenses
  WITH CHECK (shop_owner = auth.jwt()->>'email' AND public.has_active_subscription());
ALTER POLICY "inventory_items_owner"  ON public.inventory_items
  WITH CHECK (shop_owner = auth.jwt()->>'email' AND public.has_active_subscription());
ALTER POLICY "commissions_owner"      ON public.commissions
  WITH CHECK (shop_owner = auth.jwt()->>'email' AND public.has_active_subscription());
ALTER POLICY "shop_performance_owner" ON public.shop_performance
  WITH CHECK (shop_owner = auth.jwt()->>'email' AND public.has_active_subscription());
ALTER POLICY "tax_categories_owner"   ON public.tax_categories
  WITH CHECK (shop_owner = auth.jwt()->>'email' AND public.has_active_subscription());
ALTER POLICY "payees_owner"           ON public.payees
  WITH CHECK (shop_owner = auth.jwt()->>'email' AND public.has_active_subscription());
ALTER POLICY "payment_accounts_owner" ON public.payment_accounts
  WITH CHECK (shop_owner = auth.jwt()->>'email' AND public.has_active_subscription());
