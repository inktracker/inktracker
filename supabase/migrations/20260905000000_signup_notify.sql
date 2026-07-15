-- Signup notification pipeline: AFTER INSERT ON profiles → pg_net POST →
-- notifySignup edge function → Resend email to the platform admin.
--
-- Why a DB trigger instead of client-side: profiles rows are created by
-- handle_new_user (auth trigger) and by adminAction invites — the DB is
-- the only choke point that sees every signup regardless of client.
--
-- Safety: the trigger must NEVER break a signup. pg_net.http_post is
-- async (enqueues into net.http_request_queue; a worker sends it after
-- commit), and the whole body is wrapped in an exception handler so even
-- an unexpected pg_net error (extension dropped, queue full) degrades to
-- "no email" rather than a failed INSERT.
--
-- DEPLOY ORDER: deploy the notifySignup edge function BEFORE applying
-- this migration. (If the migration lands first, posts 404 harmlessly
-- until the function exists — signups are unaffected either way.)

-- ── 1. pg_net (async HTTP from Postgres; Supabase-hosted extension) ──
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ── 2. notification_log: allow the new event type ──
ALTER TABLE public.notification_log
  DROP CONSTRAINT IF EXISTS notification_log_event_type_check;
ALTER TABLE public.notification_log
  ADD CONSTRAINT notification_log_event_type_check CHECK (event_type IN (
    'quote_approval', 'artwork_approval', 'quote_payment',
    'quote_send', 'reply', 'payment_confirmation', 'trial_reminder',
    'signup_notify'
  ));

-- ── 3. trigger function ──
-- The URL is the prod project ref on purpose: this repo has exactly one
-- hosted environment. If a staging project ever exists, replays there
-- would post to prod's function, which self-validates against ITS OWN
-- profiles table and finds nothing → no email. Annoying, not dangerous;
-- parameterize via vault at that point.
CREATE OR REPLACE FUNCTION public.notify_signup_webhook()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM net.http_post(
    url     := 'https://skmltfbibaqcjddmeqvi.supabase.co/functions/v1/notifySignup',
    body    := jsonb_build_object('record', jsonb_build_object('id', NEW.id)),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Notification is best-effort; the signup INSERT must always win.
  RAISE WARNING 'notify_signup_webhook failed (non-fatal): %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_signup_on_profile_insert ON public.profiles;
CREATE TRIGGER notify_signup_on_profile_insert
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_signup_webhook();
