-- Fix infinite recursion in profiles RLS that was blocking ALL sign-ins.
--
-- The previous `profiles_select_shop_owner` policy contained a SELECT
-- against the same `profiles` table inside its USING expression:
--
--   USING (email IN (
--     SELECT jsonb_array_elements_text(p.assigned_shops::jsonb)
--     FROM profiles p
--     WHERE p.auth_id = auth.uid() AND p.assigned_shops IS NOT NULL
--   ))
--
-- Postgres evaluates RLS policies for ANY query against the table —
-- including the subquery inside the policy itself. The subquery hits
-- profiles → policy fires → subquery hits profiles → policy fires →
-- 42P17: infinite recursion detected.
--
-- This had broken sign-in completely: fetchUserWithProfile() in
-- AuthContext does a `select * from profiles where auth_id = ...`
-- which triggered the recursion and returned an error, leading the
-- app to drop the user back to the public landing page.
--
-- CLAUDE.md flagged this exact pattern: "Profiles table uses flat
-- single policy (no self-referencing subqueries — causes infinite
-- recursion)." The original migration (20260501) didn't follow it.
--
-- Fix: extract the broker → assigned_shops lookup into a SECURITY
-- DEFINER function so it bypasses RLS, then rebuild the policy on
-- top of the function. Same intent (brokers/employees can see their
-- assigned shop owners' profiles), no recursion.

-- 1. The lookup, isolated. SECURITY DEFINER + STABLE means Postgres
--    runs it as the function owner (which has bypass-RLS rights) and
--    can cache results within a single statement. Returns a SETOF text
--    so it composes cleanly with `email = ANY(...)`.

CREATE OR REPLACE FUNCTION public.assigned_shop_emails_for(p_auth_id uuid)
RETURNS SETOF text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT jsonb_array_elements_text(assigned_shops::jsonb)
  FROM public.profiles
  WHERE auth_id = p_auth_id
    AND assigned_shops IS NOT NULL
$$;

-- Lock function permissions: only authenticated callers, can't be
-- invoked by anon to enumerate emails.
REVOKE ALL ON FUNCTION public.assigned_shop_emails_for(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assigned_shop_emails_for(uuid) TO authenticated;

-- 2. Rebuild the policy without the recursive subquery.
DROP POLICY IF EXISTS profiles_select_shop_owner ON public.profiles;
CREATE POLICY profiles_select_shop_owner ON public.profiles
  FOR SELECT
  TO authenticated
  USING (email IN (SELECT public.assigned_shop_emails_for(auth.uid())));
