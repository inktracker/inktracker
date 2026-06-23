-- ============================================================================
-- SECURITY FIX (CRITICAL): lock down self-service writes to privileged
-- profile columns.
-- ============================================================================
-- The only UPDATE policy on `profiles` is `auth_id = auth.uid()` — it scopes
-- WHICH ROW a user may update but NOT which COLUMNS. Postgres RLS cannot do
-- column-level write restriction. So any authenticated user could, via the
-- bundled anon key + their own JWT:
--
--   UPDATE profiles SET role = 'admin'              -- privilege escalation
--   UPDATE profiles SET subscription_tier = 'shop', -- free paid plan
--                       trial_ends_at = '2030-01-01'
--   UPDATE profiles SET assigned_shops = '["victim@othershop.com"]'
--                                                   -- FULL CROSS-TENANT BREAKOUT
--                                                   -- (broker/manager/employee
--                                                   --  policies key off this)
--   UPDATE profiles SET mfa_email_enabled = false   -- self-disable own MFA
--
-- This trigger rejects any change to those governance columns when the caller
-- is one of the client-facing API roles (`authenticated` / `anon`). It fires
-- ONLY on an actual value change (IS DISTINCT FROM), so ordinary profile edits
-- (shop name, logo, phone, address, pricing_config, …) are unaffected.
--
-- Legitimate writers of these columns are intentionally exempt because they do
-- NOT run as `authenticated`/`anon`:
--   • service_role edge functions (adminAction setRole / inviteBroker, billing
--     webhook + self-heal)      → current_user = 'service_role'
--   • SECURITY DEFINER RPCs owned by postgres (activate_trial, enable_mfa_email,
--     disable_mfa_email)         → current_user = 'postgres'
--   • handle_new_user signup trigger sets these at INSERT — this is BEFORE
--     UPDATE only, so signup is unaffected.
--
-- The function is SECURITY INVOKER (the default) ON PURPOSE: it must observe
-- the *caller's* current_user. A SECURITY DEFINER function would always see the
-- owner and defeat the check.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.guard_profiles_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Only the client-authenticatable API roles are constrained. Everything
  -- else (service_role, postgres-owned DEFINER functions, replication) passes.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF NEW.role                 IS DISTINCT FROM OLD.role
     OR NEW.shop_owner        IS DISTINCT FROM OLD.shop_owner
     OR NEW.subscription_tier   IS DISTINCT FROM OLD.subscription_tier
     OR NEW.subscription_status IS DISTINCT FROM OLD.subscription_status
     OR NEW.trial_ends_at     IS DISTINCT FROM OLD.trial_ends_at
     OR NEW.mfa_email_enabled IS DISTINCT FROM OLD.mfa_email_enabled
     -- assigned_shops / manager_permissions may be jsonb/json — compare as text
     OR NEW.assigned_shops::text      IS DISTINCT FROM OLD.assigned_shops::text
     OR NEW.manager_permissions::text IS DISTINCT FROM OLD.manager_permissions::text
  THEN
    RAISE EXCEPTION
      'Not permitted: role, shop_owner, subscription_tier, subscription_status, trial_ends_at, mfa_email_enabled, assigned_shops, and manager_permissions can only be changed through the server (admin/billing/trial/MFA paths), not by direct profile update.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_profiles_privileged_columns ON public.profiles;
CREATE TRIGGER guard_profiles_privileged_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profiles_privileged_columns();

COMMENT ON FUNCTION public.guard_profiles_privileged_columns() IS
  'Blocks authenticated/anon from changing governance columns on profiles (role, shop_owner, subscription_*, trial_ends_at, mfa_email_enabled, assigned_shops, manager_permissions). service_role + DEFINER RPCs exempt. SECURITY INVOKER on purpose so current_user reflects the caller.';
