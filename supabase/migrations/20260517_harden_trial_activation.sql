-- Harden the trial-activation pipeline.
--
-- Background: Joe found during the launch-readiness audit that a new
-- user could get permanently stuck on the "Account pending review"
-- screen if the client-side `activate_trial` RPC failed silently
-- (network blip, edge function timeout, race with checkAppState,
-- etc.). The error was logged to console, never surfaced to the UI,
-- and the user's role stayed `'user'` forever.
--
-- This migration removes that whole failure class.
--
--   1. handle_new_user (the auth.users → public.profiles trigger)
--      now creates self-signups with role='shop' directly. The
--      transient 'user' role doesn't exist on the happy path
--      anymore. The trigger runs inside the auth.users INSERT
--      transaction, so either both rows commit or both roll back —
--      atomic.
--
--   2. activate_trial becomes a thoroughly-defensive jsonb-returning
--      backstop. Returns explicit status strings the React app can
--      map to UI states instead of returning void and forcing the
--      caller to guess. Idempotent — calling on an already-active
--      profile returns 'already_active' with no side effects.
--
-- Existing data: zero profiles currently have role='user' (checked
-- via census), so no backfill needed.
--
-- Brokers/employees are unaffected — they're created with their
-- intended role pre-existing in profiles before they sign up. The
-- trigger's first branch handles those.

-- ── 1. handle_new_user trigger function ─────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Invited account flow: a row already exists (admin pre-created a
  -- broker/employee). Just link auth_id. Don't touch role — the
  -- shop owner already decided what they should be.
  IF EXISTS (SELECT 1 FROM public.profiles WHERE email = NEW.email) THEN
    UPDATE public.profiles
    SET auth_id = NEW.id
    WHERE email = NEW.email AND auth_id IS NULL;
    RETURN NEW;
  END IF;

  -- Fresh self-signup: fully-activated trial shop, immediately.
  -- No transient 'user' role, no client-side activation step
  -- required for the happy path.
  INSERT INTO public.profiles (
    auth_id, email, role, subscription_tier, subscription_status, trial_ends_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    'shop',
    'trial',
    'trialing',
    NOW() + INTERVAL '14 days'
  );
  RETURN NEW;
END;
$$;

-- ── 2. activate_trial RPC: idempotent backstop with jsonb status ─

CREATE OR REPLACE FUNCTION public.activate_trial(user_auth_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
BEGIN
  -- Defensive: caller didn't pass an auth id.
  IF user_auth_id IS NULL THEN
    RETURN jsonb_build_object(
      'status',  'bad_input',
      'message', 'user_auth_id is required'
    );
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE auth_id = user_auth_id;

  -- No profile row exists for this auth user. The trigger should
  -- have created one — if it didn't, signup failed partway through
  -- and the user needs support intervention.
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status',  'no_profile',
      'message', 'No profile row found for this auth user. Sign up may have failed partway through.'
    );
  END IF;

  -- Already an active shop/admin — no-op. The new trigger always
  -- lands new signups here, so this is the normal happy-path
  -- response for any post-trigger call.
  IF v_profile.role IN ('shop', 'admin') THEN
    RETURN jsonb_build_object(
      'status',            'already_active',
      'role',              v_profile.role,
      'subscription_tier', v_profile.subscription_tier,
      'trial_ends_at',     v_profile.trial_ends_at
    );
  END IF;

  -- Broker/employee/manager — activate_trial doesn't apply. These
  -- accounts are pre-provisioned by the shop owner.
  IF v_profile.role IN ('broker', 'employee', 'manager') THEN
    RETURN jsonb_build_object(
      'status',  'wrong_role',
      'role',    v_profile.role,
      'message', format(
        'This account is a %s — activate_trial does not apply',
        v_profile.role
      )
    );
  END IF;

  -- Stuck role='user' (legacy or some transient pre-fix failure).
  -- Activate now. Preserve any subscription_tier / trial_ends_at
  -- that's already set so re-calls don't extend the trial.
  UPDATE public.profiles
  SET role                = 'shop',
      subscription_tier   = COALESCE(subscription_tier,   'trial'),
      subscription_status = COALESCE(subscription_status, 'trialing'),
      trial_ends_at       = COALESCE(trial_ends_at,       NOW() + INTERVAL '14 days')
  WHERE auth_id = user_auth_id;

  RETURN jsonb_build_object('status', 'activated', 'role', 'shop');
END;
$$;
