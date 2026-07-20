-- BILL-03: past_due subscriptions get a 7-day grace window, then go READ-ONLY.
--
-- Before this, a past_due subscription kept FULL write access indefinitely
-- (has_active_subscription() allowed it, and the edge/frontend guards allowed
-- it too). Stripe can leave a sub past_due for weeks of dunning — or forever if
-- a webhook is missed — so a shop that stops paying never lost write access.
--
-- New policy (Joe, 2026-06-29): keep full access for 7 days after the sub lapses
-- (a transient card decline shouldn't lock anyone out), then block WRITES while
-- leaving READS open — i.e. read-only. Reads stay open because the RLS USING
-- clauses are untouched; only WITH CHECK consults has_active_subscription().
--
-- The grace clock is `profiles.past_due_since`, stamped by billingWebhook on the
-- transition INTO past_due (COALESCE so dunning retries don't reset it) and
-- cleared when the sub recovers. The 7-day constant is mirrored in
-- _shared/billingLogic.js (PAST_DUE_GRACE_DAYS) and src/lib/billing.js — keep
-- all three in lockstep.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS past_due_since timestamptz;

-- ── CANONICAL READ-ONLY PREDICATE (server ↔ client, ONE rule) ───────────────
-- has_active_subscription() below is the authoritative WRITE gate (WITH CHECK
-- only — reads stay open). Its exact client inverse is `computeReadOnly(user)`
-- in src/lib/billing.js, which the UI uses to disable create/edit affordances
-- so a user never clicks a button that then fails this gate. The rule, stated
-- once for both sides:
--   WRITABLE iff  role in (admin, broker)
--              OR the governing subscription is NOT lapsed, where lapsed =
--                 tier expired OR tier incomplete OR status canceled
--                 OR (trial AND trial_ends_at < now)
--                 OR (past_due AND past_due_since < now - 7 days).
-- Team members inherit the shop owner's subscription on both sides. If you
-- change either side, change the other and the agreement test
-- (src/lib/__tests__/readOnlyAgreement.test.js).

-- ── has_active_subscription(): add the past_due grace check ─────────────────
CREATE OR REPLACE FUNCTION public.has_active_subscription()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role       text;
  v_shop_owner text;
  v_tier       text;
  v_status     text;
  v_trial      timestamptz;
  v_past_due   timestamptz;
BEGIN
  SELECT role, shop_owner, subscription_tier, subscription_status, trial_ends_at, past_due_since
    INTO v_role, v_shop_owner, v_tier, v_status, v_trial, v_past_due
  FROM public.profiles
  WHERE auth_id = auth.uid()
  LIMIT 1;

  -- No profile resolvable (service role / edge / odd state): fail-safe allow.
  IF NOT FOUND THEN
    RETURN true;
  END IF;

  -- Admins and brokers are never gated by subscription here.
  IF v_role IN ('admin', 'broker') THEN
    RETURN true;
  END IF;

  -- Team members inherit the shop OWNER's subscription, never their own.
  IF v_role IN ('manager', 'employee') AND v_shop_owner IS NOT NULL THEN
    SELECT subscription_tier, subscription_status, trial_ends_at, past_due_since
      INTO v_tier, v_status, v_trial, v_past_due
    FROM public.profiles
    WHERE email = v_shop_owner AND role IN ('shop', 'admin')
    LIMIT 1;
    IF NOT FOUND THEN
      RETURN true;
    END IF;
  END IF;

  -- Clearly lapsed → block writes. past_due blocks only AFTER its 7-day grace
  -- (within grace, or with no stamped start, it still writes). Everything else
  -- (active / trialing / trial-in-window / unknown null) → allow.
  IF v_tier = 'expired'
     OR v_tier = 'incomplete'
     OR v_status = 'canceled'
     OR (v_tier = 'trial' AND v_trial IS NOT NULL AND v_trial < now())
     OR (v_status = 'past_due' AND v_past_due IS NOT NULL AND v_past_due < now() - interval '7 days') THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.has_active_subscription() IS
  'BILL-02/03: true unless the governing subscription is clearly lapsed (expired/incomplete/canceled/expired-trial) OR past_due beyond its 7-day grace (read-only after). Admins+brokers always true. Fail-safe true on unresolved state. WITH CHECK only — reads stay open.';

-- ── Protect past_due_since from client tampering ────────────────────────────
-- A user could otherwise set their own past_due_since to a future date (extend
-- grace) or null (reset it), dodging read-only. Only server paths (service_role)
-- may change it — same guard the other billing columns use.
CREATE OR REPLACE FUNCTION public.guard_profiles_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF NEW.role                 IS DISTINCT FROM OLD.role
     OR NEW.shop_owner        IS DISTINCT FROM OLD.shop_owner
     OR NEW.subscription_tier   IS DISTINCT FROM OLD.subscription_tier
     OR NEW.subscription_status IS DISTINCT FROM OLD.subscription_status
     OR NEW.trial_ends_at     IS DISTINCT FROM OLD.trial_ends_at
     OR NEW.past_due_since    IS DISTINCT FROM OLD.past_due_since
     OR NEW.mfa_email_enabled IS DISTINCT FROM OLD.mfa_email_enabled
     OR NEW.assigned_shops::text      IS DISTINCT FROM OLD.assigned_shops::text
     OR NEW.manager_permissions::text IS DISTINCT FROM OLD.manager_permissions::text
  THEN
    RAISE EXCEPTION
      'Not permitted: role, shop_owner, subscription_tier, subscription_status, trial_ends_at, past_due_since, mfa_email_enabled, assigned_shops, and manager_permissions can only be changed through the server (admin/billing/trial/MFA paths), not by direct profile update.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;
