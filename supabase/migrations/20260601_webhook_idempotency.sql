-- Webhook idempotency. Stripe (and most webhook providers) explicitly
-- promise at-least-once delivery — they retry on 5xx, slow ack,
-- network timeout. Without a dedupe gate, every retry re-runs the
-- full event handler. For our stripeWebhook that means:
--
--   - 2× QB payments recorded for the same Stripe charge (real
--     reconciliation drift: QB AR balloons while Stripe cash is
--     correct)
--   - 2× customer payment-confirmation emails (trust damage)
--   - 2× shop notification emails (cosmetic, but noisy)
--
-- Fix: a tiny table keyed by (source, event_id). Webhook handlers
-- INSERT before processing; if the insert conflicts on the unique
-- key, this is a duplicate — return 200 OK immediately without
-- re-running side effects.
--
-- Service-role only — no RLS surface for anyone else to touch.

CREATE TABLE IF NOT EXISTS public.processed_webhook_events (
  source       TEXT        NOT NULL,            -- 'stripe' / 'qb' / 'billing'
  event_id     TEXT        NOT NULL,            -- provider's event identifier
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload      JSONB,                           -- raw event for forensics
  PRIMARY KEY (source, event_id)
);

-- Periodic cleanup: events older than 30 days are no longer needed
-- for dedup (Stripe retries within 3 days max). Index supports a
-- vacuum query if we want one later.
CREATE INDEX IF NOT EXISTS processed_webhook_events_processed_at_idx
  ON public.processed_webhook_events (processed_at);

ALTER TABLE public.processed_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.processed_webhook_events FROM anon, authenticated;
GRANT  ALL ON public.processed_webhook_events TO service_role;
