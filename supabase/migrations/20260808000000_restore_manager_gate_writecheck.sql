-- NEW-05: restore the manager_section_allowed() guard on order / purchase-order
-- WRITE checks that the BILL-02 stage-3 migration (20260805000000) clobbered.
--
-- Stage 3 appended has_active_subscription() to these policies with
--   ALTER POLICY ... WITH CHECK (<new expr>)
-- which REPLACES the whole WITH CHECK expression. It rewrote only the tenant
-- clause + subscription gate and silently dropped the per-section manager gate
-- (manager_section_allowed('Production' | 'Inventory')) that 20260706 added.
--
-- Net regression: a manager whose Production/Inventory permission was revoked
-- could write orders / purchase_orders again (USING was untouched, so reads
-- stayed gated — only the write path opened up). Re-add the manager gate so the
-- WITH CHECK is (tenant AND manager_gate) AND active_subscription, matching the
-- USING clause plus the subscription requirement.

-- orders: managers ride orders_employee; gate writes on 'Production'.
ALTER POLICY "orders_employee" ON public.orders
  WITH CHECK (
    (
      shop_owner IN (
        SELECT jsonb_array_elements_text(p.assigned_shops)
        FROM public.profiles p
        WHERE p.auth_id = auth.uid() AND p.assigned_shops IS NOT NULL
      )
      AND public.manager_section_allowed('Production')
    )
    AND public.has_active_subscription()
  );

-- purchase_orders insert/update: gate writes on 'Inventory'.
ALTER POLICY purchase_orders_insert ON public.purchase_orders
  WITH CHECK (
    (
      (
        shop_owner = (SELECT email FROM public.profiles WHERE auth_id = auth.uid())
        OR shop_owner IN (SELECT public.assigned_shop_emails_for(auth.uid()))
      )
      AND public.manager_section_allowed('Inventory')
    )
    AND public.has_active_subscription()
  );

ALTER POLICY purchase_orders_update ON public.purchase_orders
  WITH CHECK (
    (
      (
        shop_owner = (SELECT email FROM public.profiles WHERE auth_id = auth.uid())
        OR shop_owner IN (SELECT public.assigned_shop_emails_for(auth.uid()))
      )
      AND public.manager_section_allowed('Inventory')
    )
    AND public.has_active_subscription()
  );
