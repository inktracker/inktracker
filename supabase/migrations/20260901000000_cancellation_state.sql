-- Pending-cancellation display state.
--
-- When a shop cancels, Stripe keeps the subscription active until period end
-- and fires customer.subscription.updated with cancel_at_period_end=true. Until
-- now the webhook ignored that flag, so a canceling shop went silently dark at
-- period end with no "your plan ends on X" state anywhere. These two columns
-- persist the pending cancel so the app can show a banner and send lifecycle
-- email. Purely additive DISPLAY state — the write gate (has_active_subscription)
-- is unchanged: a pending cancel is still active until the period actually ends.
--
-- Read via the same profile row the app already SELECTs (AuthContext uses
-- select("*"); the team-member owner-sub select is widened alongside this).
-- No RLS change.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_ends_at timestamptz;  -- nullable: the date access actually ends when a cancel is pending

-- notification_log is the audit trail for every outbound email (see
-- 20260825000000). The two new lifecycle emails need their event_type values
-- whitelisted or the audit insert fails its CHECK (the send is best-effort so
-- it wouldn't 5xx the webhook, but the row would be silently dropped).
ALTER TABLE public.notification_log
  DROP CONSTRAINT IF EXISTS notification_log_event_type_check;
ALTER TABLE public.notification_log
  ADD CONSTRAINT notification_log_event_type_check CHECK (event_type IN (
    'quote_approval', 'artwork_approval', 'quote_payment',
    'quote_send', 'reply', 'payment_confirmation', 'trial_reminder',
    'cancellation_scheduled', 'winback'
  ));
