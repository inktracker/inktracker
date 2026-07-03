-- notification_log becomes the audit trail for EVERY outbound email, not
-- just the approval/payment subset (pre-scale audit, 2026-07-02: quote
-- sends, replies, MFA codes, Stripe payment confirmations, and trial
-- reminders were all unlogged — a lost email left no durable record).
--
-- New event types:
--   quote_send            sendQuoteEmail (quotes + invoices to customers)
--   reply                 sendReply (message-thread replies)
--   payment_confirmation  stripeWebhook owner + customer emails
--   trial_reminder        billingWebhook trial_will_end
-- And 'customer' joins recipient_role — customer-facing sends previously
-- had no valid role value.

ALTER TABLE public.notification_log
  DROP CONSTRAINT IF EXISTS notification_log_event_type_check;
ALTER TABLE public.notification_log
  ADD CONSTRAINT notification_log_event_type_check CHECK (event_type IN (
    'quote_approval', 'artwork_approval', 'quote_payment',
    'quote_send', 'reply', 'payment_confirmation', 'trial_reminder'
  ));

ALTER TABLE public.notification_log
  DROP CONSTRAINT IF EXISTS notification_log_recipient_role_check;
ALTER TABLE public.notification_log
  ADD CONSTRAINT notification_log_recipient_role_check CHECK (recipient_role IN (
    'shop_owner', 'broker', 'customer'
  ));
