-- Let a shop's TEAM (owner, managers, employees) read the broker
-- profiles assigned to their shop.
--
-- Gap found while shipping per-broker pricing (PR #652): the pricing
-- UIs list a shop's brokers by querying profiles with
-- `role='broker' AND assigned_shops @> [shopEmail]`. The only profiles
-- SELECT policy that admits broker rows is profiles_select_team
-- (20260501), which matches `assigned_shops ? auth.jwt()->>'email'` —
-- i.e. only the OWNER, whose email is literally inside the broker's
-- assigned_shops. A manager's own email is never in that array, so
-- managers saw an empty broker list in Account → Pricing →
-- Per-Broker Pricing and in Admin → Broker Management's RLS fallback,
-- even though the broker_pricing table itself is manager-writable.
--
-- Managers carry their shop two ways in this codebase:
--   * profiles.shop_owner = owner's email (what shopScope() reads)
--   * profiles.assigned_shops containing the owner's email (what the
--     20260706 manager RLS policies read)
-- The helper below returns the union of both (plus the caller's own
-- email, which makes the policy uniform for owners too), so either
-- shape works.
--
-- The helper returns NOTHING for role='broker' callers. Brokers also
-- carry assigned_shops, and without that filter every broker could
-- enumerate their co-brokers at the same shop — visibility they've
-- never had and don't need.
--
-- RECURSION WARNING (the 20260513 lesson): a profiles policy must not
-- subquery profiles directly — the subquery re-fires the policy →
-- 42P17 infinite recursion, which once broke ALL sign-ins. That's why
-- the lookup (including the role check) lives in a SECURITY DEFINER
-- function, same pattern as assigned_shop_emails_for.

CREATE OR REPLACE FUNCTION public.team_shop_emails_for(p_auth_id uuid)
RETURNS SETOF text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  WITH me AS (
    SELECT email, shop_owner, assigned_shops
    FROM public.profiles
    WHERE auth_id = p_auth_id
      AND role IS DISTINCT FROM 'broker'
  )
  SELECT jsonb_array_elements_text(assigned_shops::jsonb)
  FROM me
  WHERE assigned_shops IS NOT NULL
  UNION
  SELECT shop_owner FROM me
  WHERE shop_owner IS NOT NULL AND shop_owner <> ''
  UNION
  SELECT email FROM me
  WHERE email IS NOT NULL
$$;

-- Same lockdown as assigned_shop_emails_for: authenticated only, so
-- anon can't use it to probe email/shop relationships.
REVOKE ALL ON FUNCTION public.team_shop_emails_for(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.team_shop_emails_for(uuid) TO authenticated;

-- Team members can SELECT broker profiles assigned to their shop.
-- Deliberately scoped to role='broker' rows only — this policy grants
-- no visibility into owners, managers, or other shops' teams. A broker
-- assigned to shops A and B is visible to both shops' teams (each shop
-- already sees the broker in their assignment UI; pricing per shop is
-- isolated in broker_pricing).
DROP POLICY IF EXISTS "profiles_select_shop_brokers" ON public.profiles;
CREATE POLICY "profiles_select_shop_brokers" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    role = 'broker'
    AND EXISTS (
      SELECT 1
      FROM public.team_shop_emails_for(auth.uid()) AS s(email)
      WHERE profiles.assigned_shops::jsonb ? s.email
    )
  );
