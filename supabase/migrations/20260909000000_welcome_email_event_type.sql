-- welcome_email — new notification_log event type.
--
-- Self-serve shop signups now get a branded welcome email (sent by
-- notifySignup alongside the existing admin notification; deduped one
-- per email address, ever, on this event type). The CHECK constraint is
-- the DB-side mirror of the union in
-- _shared/approvalNotificationEmail.js — keep both lists in lockstep.

ALTER TABLE public.notification_log
  DROP CONSTRAINT IF EXISTS notification_log_event_type_check;
ALTER TABLE public.notification_log
  ADD CONSTRAINT notification_log_event_type_check CHECK (event_type IN (
    'quote_approval', 'artwork_approval', 'quote_payment',
    'quote_send', 'reply', 'payment_confirmation', 'trial_reminder',
    'signup_notify', 'welcome_email'
  ));
