-- ============================================================================
-- Let managers (assigned team) UPDATE their shop's settings — Stage 2 of the
-- manager=full-partnership work. Until now shops_update was owner-only
-- (`owner_email = jwt.email`), so a manager editing Account → Pricing/branding
-- couldn't write the real shop and the client silently created a phantom shop
-- keyed to the manager's own email.
--
-- SECURITY (the careful part):
--   • UPDATE is scoped by assigned_shops — the SAME boundary shops_select
--     already uses, so a manager can only update shops they're assigned to
--     (no cross-tenant write).
--   • owner_email is made IMMUTABLE for any authenticated update by the trigger
--     below. Without it, a manager could set owner_email = their own email
--     (which satisfies the WITH CHECK's `owner_email = jwt.email` branch) and
--     hijack the shop. The trigger blocks ALL owner_email changes from the
--     client roles; reassigning a shop is a service-role/admin operation only.
--   • Owners are unaffected: they already matched the owner branch, and they
--     never change owner_email through the settings UI.
-- ============================================================================

-- owner_email immutability guard (SECURITY INVOKER so current_user reflects the
-- caller; service_role / postgres-owned DEFINER functions pass through).
CREATE OR REPLACE FUNCTION public.guard_shops_owner_email_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF NEW.owner_email IS DISTINCT FROM OLD.owner_email THEN
    RAISE EXCEPTION 'A shop''s owner_email cannot be changed.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_shops_owner_email_immutable ON public.shops;
CREATE TRIGGER guard_shops_owner_email_immutable
  BEFORE UPDATE ON public.shops
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_shops_owner_email_immutable();

-- Open UPDATE to owner OR assigned team member (mirrors shops_select scope).
DROP POLICY IF EXISTS shops_update ON public.shops;
CREATE POLICY shops_update ON public.shops
  FOR UPDATE
  TO authenticated
  USING (
    owner_email = (auth.jwt() ->> 'email')
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.email = (auth.jwt() ->> 'email')
        AND profiles.assigned_shops @> to_jsonb(shops.owner_email)
    )
  )
  WITH CHECK (
    owner_email = (auth.jwt() ->> 'email')
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.email = (auth.jwt() ->> 'email')
        AND profiles.assigned_shops @> to_jsonb(shops.owner_email)
    )
  );

COMMENT ON FUNCTION public.guard_shops_owner_email_immutable() IS
  'Blocks owner_email changes on shops from authenticated/anon (prevents a manager from reassigning/hijacking the shop). service_role/postgres exempt.';
