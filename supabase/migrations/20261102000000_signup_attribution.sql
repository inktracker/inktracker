-- Signup attribution: profiles.signup_source (jsonb).
--
-- "How did this shop find us?" was unanswerable (agendaprintworks signup,
-- 2026-08-31 — no referrer, no utm, no self-report anywhere). Two layers now
-- land in one column:
--   1. Silent first-touch (referrer/utm/landing) captured client-side and
--      passed through auth.signUp metadata; written here at profile INSERT so
--      the signup-notify email fires with the source already on the row.
--   2. `self_reported` from the optional onboarding question, written later
--      by the client (own-row RLS; not a guarded governance column).
--
-- raw_user_meta_data is CALLER-CONTROLLED: only known keys are copied, each
-- length-capped, everything else discarded.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS signup_source jsonb;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  attrib jsonb;
  src jsonb := NULL;
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

  -- First-touch attribution from signUp metadata. Allowlisted keys only,
  -- length-capped — the metadata blob is client-controlled.
  attrib := NEW.raw_user_meta_data -> 'attribution';
  IF attrib IS NOT NULL AND jsonb_typeof(attrib) = 'object' THEN
    src := jsonb_strip_nulls(jsonb_build_object(
      'referrer',     left(attrib->>'referrer', 500),
      'utm_source',   left(attrib->>'utm_source', 200),
      'utm_medium',   left(attrib->>'utm_medium', 200),
      'utm_campaign', left(attrib->>'utm_campaign', 200),
      'utm_content',  left(attrib->>'utm_content', 200),
      'utm_term',     left(attrib->>'utm_term', 200),
      'landing',      left(attrib->>'landing', 500),
      'captured_at',  left(attrib->>'captured_at', 40)
    ));
    IF src = '{}'::jsonb THEN
      src := NULL;
    END IF;
  END IF;

  -- Fresh self-signup: start the 14-day trial immediately, no card.
  -- Expiry is enforced by getEffectiveTier (client) and
  -- has_active_subscription() (RLS write gate) off trial_ends_at.
  INSERT INTO public.profiles (
    auth_id, email, role, subscription_tier, subscription_status, trial_ends_at, signup_source
  )
  VALUES (
    NEW.id,
    NEW.email,
    'shop',
    'trial',
    'trialing',
    now() + interval '14 days',
    src
  );
  RETURN NEW;
END;
$$;
