-- Add 'operator_alert' to notification_log's event_type allowlist.
--
-- The 9 operator alert/digest emails (systemHealthCheck daily digest + the 8
-- qbReconcile alert scans) used to POST api.resend.com directly: no retry and
-- NO notification_log row, so probeEmailFailures — which counts
-- notification_log.status='failed' — was structurally blind to the alerting
-- channel's own failures (the "silent monitor" trap). They now go through
-- sendResendEmail + logNotificationAttempt under this event type.
-- Keep in lockstep with the JSDoc union in _shared/approvalNotificationEmail.js.
ALTER TABLE public.notification_log DROP CONSTRAINT IF EXISTS notification_log_event_type_check;
ALTER TABLE public.notification_log ADD CONSTRAINT notification_log_event_type_check CHECK (event_type IN (
  'quote_approval', 'artwork_approval', 'quote_payment', 'quote_send', 'reply',
  'payment_confirmation', 'trial_reminder', 'signup_notify', 'welcome_email',
  'drip_day2', 'status_update', 'art_proof_sent', 'art_proof_reminder',
  'artwork_changes_requested', 'deposit_payment', 'winback',
  'cancellation_scheduled', 'operator_alert'
));
