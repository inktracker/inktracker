-- BILL-04: close the dunning-escalation fail-open in the write gate.
--
-- has_active_subscription() (20260811000000) treated only status='canceled'
-- as terminally lapsed. But Stripe's own lifecycle moves subscriptions to
-- OTHER terminal statuses this gate never checked:
--   past_due  → 'unpaid'              (dunning exhausted — the sharp one: a
--                                      shop correctly read-only after the
--                                      7-day grace got FULL WRITE ACCESS BACK
--                                      the moment Stripe gave up collecting,
--                                      because past_due no longer matched)
--   incomplete → 'incomplete_expired' (checkout never completed, card never
--                                      cleared — tier already says 'shop')
--   trialing  → 'paused'              (trial ended with no payment method,
--                                      collection paused)
-- billingWebhook persists the raw Stripe status, so these land in
-- profiles.subscription_status verbatim. Audit 2026-09-30; latent (no live
-- rows in these statuses today).
--
-- Mirrors: _shared/billingLogic.js LAPSED_SUB_STATUSES,
-- _shared/subscriptionGuard.ts, src/lib/billing.js — all updated in the same
-- change; keep the four in lockstep.

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

  -- Clearly lapsed → block writes. The status list now covers ALL of Stripe's
  -- terminal statuses, not just 'canceled' (BILL-04 above). past_due blocks
  -- only AFTER its 7-day grace (within grace, or with no stamped start, it
  -- still writes). Everything else (active / trialing / trial-in-window /
  -- unknown null) → allow.
  IF v_tier = 'expired'
     OR v_tier = 'incomplete'
     OR v_status IN ('canceled', 'unpaid', 'incomplete_expired', 'paused')
     OR (v_tier = 'trial' AND v_trial IS NOT NULL AND v_trial < now())
     OR (v_status = 'past_due' AND v_past_due IS NOT NULL AND v_past_due < now() - interval '7 days') THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.has_active_subscription() IS
  'BILL-02/03/04: true unless the governing subscription is clearly lapsed (expired/incomplete tier; canceled/unpaid/incomplete_expired/paused status; expired trial) OR past_due beyond its 7-day grace. Admins+brokers always true. Fail-safe true on unresolved state. WITH CHECK only — reads stay open.';
