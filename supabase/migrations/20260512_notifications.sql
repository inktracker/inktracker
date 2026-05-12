-- Shop notifications — surfaces edge-function events to the shop UI.
--
-- Initial use case: QB invoice reconciliation drift. When a QB invoice
-- is created but its numbers don't match what InkTracker sent, the
-- qbSync edge function inserts a row here. The bell in the app nav
-- shows a count of unread rows; clicking opens the related invoice.
--
-- General-purpose: the same table is intended for future event types
-- (e.g. failed Stripe webhook, broker quote submission, payment
-- received). Schema is intentionally narrow — entity references are
-- stored as text + id rather than FKs because the linked row can be
-- in any of several tables (quotes, orders, invoices, expenses).

CREATE TABLE IF NOT EXISTS public.notifications (
  id                BIGSERIAL PRIMARY KEY,
  shop_owner        TEXT        NOT NULL,
  event_type        TEXT        NOT NULL,    -- e.g. 'qb_reconciliation_drift'
  severity          TEXT        NOT NULL     -- 'info' | 'warning' | 'alert'
                                CHECK (severity IN ('info', 'warning', 'alert')),
  title             TEXT        NOT NULL,
  body              TEXT        NOT NULL DEFAULT '',
  related_entity    TEXT,                    -- e.g. 'quote' / 'order' / 'invoice'
  related_id        TEXT,                    -- the row id in that entity table
  metadata          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  read_at           TIMESTAMPTZ,             -- null = unread
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hot path: the nav bell counts unread for the current shop.
CREATE INDEX IF NOT EXISTS notifications_shop_unread_idx
  ON public.notifications (shop_owner, read_at, created_at DESC)
  WHERE read_at IS NULL;

-- Secondary path: notifications detail page lists all (read + unread).
CREATE INDEX IF NOT EXISTS notifications_shop_created_idx
  ON public.notifications (shop_owner, created_at DESC);

-- RLS — same shape as the other shop-scoped tables. Shop owners can
-- read/update their own notifications; only the service role can
-- INSERT (edge functions write here on behalf of the shop, never the
-- authenticated user).

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_select_own ON public.notifications;
CREATE POLICY notifications_select_own ON public.notifications
  FOR SELECT
  TO authenticated
  USING (shop_owner = (auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS notifications_update_own ON public.notifications;
CREATE POLICY notifications_update_own ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (shop_owner = (auth.jwt() ->> 'email'))
  WITH CHECK (shop_owner = (auth.jwt() ->> 'email'));

-- Note: no INSERT policy for authenticated. Only service_role (which
-- bypasses RLS) can insert. This prevents a malicious or buggy user-
-- facing call from forging notifications.

-- Backfill nothing on this migration — table starts empty.
