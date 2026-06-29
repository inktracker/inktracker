-- Subscription write gate — STAGE 3: team / assigned-shop write paths (BILL-02).
--
-- Stages 1 (20260726) + 2 (20260804) gated the OWNER write policies. This closes
-- the remaining hole: a lapsed shop's MANAGER/EMPLOYEE could still create or
-- modify orders + purchase orders via the assigned-shops policies. Append the
-- same has_active_subscription() guard to their WITH CHECK.
--
-- has_active_subscription() judges a team member by the OWNER's subscription
-- (and is fail-safe: admins/brokers + unresolved state → allowed), so only a
-- genuinely lapsed shop's team is blocked from writes; an active shop's staff
-- are unaffected. WITH CHECK only — reads/deletes/exports stay open.
--
-- The OR clauses are parenthesized before `AND has_active_subscription()` so the
-- precedence is `(owner OR assigned) AND active`, not `owner OR (assigned AND
-- active)`.
--
-- NOT gated (intentionally): broker_notifications / broker_performance /
-- broker_documents / broker_files write policies — those are broker-scoped
-- (brokers bypass the gate) and not core shop revenue data.

ALTER POLICY "orders_employee" ON public.orders
  WITH CHECK (
    shop_owner IN (
      SELECT jsonb_array_elements_text(p.assigned_shops::jsonb)
      FROM public.profiles p
      WHERE p.auth_id = auth.uid() AND p.assigned_shops IS NOT NULL
    )
    AND public.has_active_subscription()
  );

ALTER POLICY purchase_orders_insert ON public.purchase_orders
  WITH CHECK (
    (
      shop_owner = (SELECT email FROM public.profiles WHERE auth_id = auth.uid())
      OR shop_owner IN (SELECT public.assigned_shop_emails_for(auth.uid()))
    )
    AND public.has_active_subscription()
  );

ALTER POLICY purchase_orders_update ON public.purchase_orders
  WITH CHECK (
    (
      shop_owner = (SELECT email FROM public.profiles WHERE auth_id = auth.uid())
      OR shop_owner IN (SELECT public.assigned_shop_emails_for(auth.uid()))
    )
    AND public.has_active_subscription()
  );
