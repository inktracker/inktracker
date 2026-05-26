-- Let a shop owner SELECT the customers belonging to brokers
-- assigned to their shop, so the Dashboard → Brokers tab can show a
-- "Clients: N" count next to each broker.
--
-- Background: brokers store their clients with shop_owner = 'broker:'
-- || their_email (migration 20260507). Two existing policies cover
-- writes:
--   customers_owner   — shop_owner = auth.email           (shop's own)
--   customers_broker  — shop_owner = 'broker:' || email   (broker's own)
-- Neither lets a shop owner READ a broker's client rows, so the
-- BrokerCard's Customer.filter({ shop_owner: 'broker:...' }) call from
-- the shop owner's session was returning [] (silent RLS deny) and the
-- header stat rendered 0 even when a broker had clients.
--
-- Fix mirrors the pattern from 20260513_fix_profiles_recursion: a
-- SECURITY DEFINER helper that bypasses RLS on profiles (the shop
-- owner doesn't have direct read access to broker profiles), wrapped
-- in a SELECT-only policy that uses it. Read-only — shop owners
-- cannot insert / update / delete a broker's clients, matching the
-- product model where brokers own their own client list.

CREATE OR REPLACE FUNCTION public.broker_shop_owner_values_for(p_shop_email text)
RETURNS SETOF text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT 'broker:' || email
  FROM public.profiles
  WHERE role = 'broker'
    AND assigned_shops IS NOT NULL
    AND assigned_shops::jsonb ? p_shop_email
$$;

REVOKE ALL ON FUNCTION public.broker_shop_owner_values_for(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.broker_shop_owner_values_for(text) TO authenticated;

DROP POLICY IF EXISTS "customers_shop_owner_view_brokers" ON public.customers;
CREATE POLICY "customers_shop_owner_view_brokers" ON public.customers
  FOR SELECT TO authenticated
  USING (
    shop_owner IN (
      SELECT public.broker_shop_owner_values_for(auth.jwt()->>'email')
    )
  );
