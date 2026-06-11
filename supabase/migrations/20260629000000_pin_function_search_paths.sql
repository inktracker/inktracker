-- Pin search_path on the last 3 public functions without one — flagged
-- by Supabase Security Advisor (function_search_path_mutable) during
-- Joe's 2026-06-11 scan sweep. Same hardening class as the MFA pgcrypto
-- fix (20260627): an unpinned search_path lets a session's search_path
-- influence name resolution inside the function.
--
-- current_user_email is the one that matters: SECURITY DEFINER and used
-- by RLS policies. Its body already schema-qualifies everything
-- (public.profiles, auth.uid()), so pinning changes resolution of
-- nothing — it just closes the door. The two trigger functions touch
-- only NEW/OLD and pg_catalog builtins.
--
-- Bodies are byte-identical to prod (pulled from pg_get_functiondef
-- before writing this). Idempotent CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.current_user_email()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT email FROM public.profiles WHERE auth_id = auth.uid() LIMIT 1;
  $$;

CREATE OR REPLACE FUNCTION public.refuse_completed_order_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status = 'Completed' THEN
    RAISE EXCEPTION
      'Cannot delete a Completed order (order_id: %, customer: %). Completed orders are preserved as historical records — update the status instead if you really mean it.',
      OLD.order_id, OLD.customer_name
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;

CREATE OR REPLACE FUNCTION public.touch_purchase_orders_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;
