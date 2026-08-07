-- drip_day2 — new notification_log event type.
--
-- The lifecycleDrip cron (edge function, GitHub Actions daily) sends a
-- day-2 "create your first quote" activation nudge to trialing shops
-- with zero quotes, deduped one-per-shop-ever on this event type.
-- (Its other send, the trial-ending reminder, reuses the existing
-- 'trial_reminder' type ON PURPOSE — sharing the dedup key with
-- billingWebhook's trial_will_end handler means a shop gets exactly one
-- trial-ending email no matter which path reaches it first.)
--
-- The CHECK constraint is the DB-side mirror of the union in
-- _shared/approvalNotificationEmail.js — keep both lists in lockstep.

ALTER TABLE public.notification_log
  DROP CONSTRAINT IF EXISTS notification_log_event_type_check;
ALTER TABLE public.notification_log
  ADD CONSTRAINT notification_log_event_type_check CHECK (event_type IN (
    'quote_approval', 'artwork_approval', 'quote_payment',
    'quote_send', 'reply', 'payment_confirmation', 'trial_reminder',
    'signup_notify', 'welcome_email', 'drip_day2'
  ));
