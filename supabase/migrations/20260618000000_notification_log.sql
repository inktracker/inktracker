-- Notification log — append-only record of every approval / payment
-- notification we attempted to send via Resend.
--
-- Background: the approval-notification path was silently failing
-- because the helper used an unverified sender (the 2026-05-31
-- "approval emails not arriving" report). The send failure was
-- swallowed by a best-effort try/catch — fine for the request path
-- (we don't want a Resend hiccup to roll back a quote approval),
-- but it meant operators had no way to see "we tried, it failed,
-- here's why."
--
-- This table turns those silent failures into queryable provenance.
-- One row per attempt — sent, failed, or skipped (e.g., no
-- recipient resolved). Status='failed' rows carry the underlying
-- failure_reason so an operator can read "resend_422" and act on
-- it instead of guessing.
--
-- Tenant scoping: shop_owner on every row. RLS lets authenticated
-- users read only their own rows (matches the pattern for the
-- existing notifications table), and the service role does the
-- writes from the edge functions.

CREATE TABLE IF NOT EXISTS public.notification_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_owner       TEXT NOT NULL,
  event_type       TEXT NOT NULL CHECK (event_type IN (
    'quote_approval', 'artwork_approval', 'quote_payment'
  )),
  recipient_email  TEXT NOT NULL,
  recipient_role   TEXT CHECK (recipient_role IN ('shop_owner', 'broker')),
  quote_id         UUID,                              -- nullable; artwork events use order_id
  order_id         UUID,                              -- nullable; quote_approval uses quote_id
  subject          TEXT,
  status           TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  failure_reason   TEXT,                              -- e.g. 'no_api_key', 'resend_422', 'no_recipient'
  resend_id        TEXT,                              -- Resend's message id when status='sent'
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hot path: "show me my shop's notifications, newest first."
CREATE INDEX IF NOT EXISTS notification_log_shop_owner_idx
  ON public.notification_log (shop_owner, created_at DESC);

-- Drill-down by quote so the QuoteDetailModal can render a per-quote
-- notification history alongside its qb_event_log timeline.
CREATE INDEX IF NOT EXISTS notification_log_quote_id_idx
  ON public.notification_log (quote_id, created_at DESC)
  WHERE quote_id IS NOT NULL;

-- Same for orders (artwork-approval events surface here).
CREATE INDEX IF NOT EXISTS notification_log_order_id_idx
  ON public.notification_log (order_id, created_at DESC)
  WHERE order_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────
-- Same shape as the `notifications` table: shop_owner-scoped SELECT
-- for authenticated users, service-role only for INSERT/UPDATE/DELETE
-- (edge functions do the writes, no caller-side mutation).

ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_log FROM anon;
REVOKE ALL ON public.notification_log FROM authenticated;
GRANT  SELECT ON public.notification_log TO authenticated;
GRANT  ALL    ON public.notification_log TO service_role;

DROP POLICY IF EXISTS "notification_log_owner_select" ON public.notification_log;
CREATE POLICY "notification_log_owner_select" ON public.notification_log
  FOR SELECT TO authenticated
  USING (shop_owner = auth.jwt()->>'email');

COMMENT ON TABLE public.notification_log IS
  'Append-only record of every approval/payment notification we attempted to send. Service-role writes from edge functions; authenticated users read only their own shop''s rows.';
