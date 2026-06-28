-- Require a card at signup (audit BILL-01).
--
-- Before: handle_new_user granted every fresh self-signup a cardless 14-day
-- trial (tier='trial', trial_ends_at=now()+14d). So me+1@, me+2@, … each got
-- unlimited free full-feature product — no card, no identity, no device check.
--
-- After: a fresh self-signup lands in 'incomplete' — signed up, NO access yet.
-- They start their 14-day trial by completing Stripe Checkout (subscription
-- mode + trial_period_days=14), which collects a payment method up front; the
-- billing webhook then flips them to tier='shop'/status='trialing'. The
-- card requirement (and Stripe's own trial-abuse controls) close the leak.
--
-- Unchanged: the invited-account branch (broker/employee/manager pre-created
-- by a shop owner) still just links auth_id and keeps its role. Existing
-- mid-trial users (tier='trial' with a future trial_ends_at) are untouched —
-- this trigger only runs for NEW auth users.

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

  -- Fresh self-signup: a shop with NO subscription yet. 'incomplete' grants
  -- no app access (see getEffectiveTier / requireActiveSubscription) — the
  -- user must add a card via Stripe Checkout to start their 14-day trial.
  INSERT INTO public.profiles (
    auth_id, email, role, subscription_tier, subscription_status, trial_ends_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    'shop',
    'incomplete',
    NULL,
    NULL
  );
  RETURN NEW;
END;
$$;
