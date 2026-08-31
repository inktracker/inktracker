-- Close a cross-tenant WRITE hole on the four broker_* satellite tables.
--
-- broker_documents / broker_files / broker_notifications / broker_performance
-- each had a single FOR ALL policy whose WITH CHECK was
--     (shop_owner = me) OR (broker_id = me)
-- Because either branch satisfies the check, any authenticated account could
-- INSERT a row with broker_id = <their own email> and shop_owner = <any
-- victim shop>, planting rows into a tenant they have no relationship with.
-- Verified 2026-08-31: an account with assigned_shops = [] planted a
-- broker_notification into another shop's tenant (row deleted).
--
-- Fix mirrors quotes_broker_write (20261002000000): the broker-role branch
-- must additionally prove the row's shop is in the caller's assigned_shops —
-- a governance column the caller cannot self-grant. The owner branch
-- (shop_owner = me) is unchanged, so every legitimate owner-create flow and
-- the broker "mark notification read" UPDATE keep working. USING (reads /
-- deletes) is unchanged: no cross-tenant READ existed — a caller only ever
-- matched rows where they are the owner or the named broker.
--
-- assigned_shops is a jsonb array of owner emails; `?` tests element
-- membership, same operator quotes_broker_write uses.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['broker_documents','broker_files','broker_notifications','broker_performance']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_access', t);
    EXECUTE format($p$
      CREATE POLICY %I ON public.%I
      FOR ALL TO authenticated
      USING (
        shop_owner = (SELECT auth.jwt() ->> 'email')
        OR broker_id = (SELECT auth.jwt() ->> 'email')
      )
      WITH CHECK (
        shop_owner = (SELECT auth.jwt() ->> 'email')
        OR (
          broker_id = (SELECT auth.jwt() ->> 'email')
          AND EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.auth_id = (SELECT auth.uid())
              AND p.assigned_shops ? %I.shop_owner
          )
        )
      )
    $p$, t || '_access', t, t);
  END LOOP;
END $$;
