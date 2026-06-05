-- QuickBooks audit log + idempotency primitives.
--
-- Two tables that every future QB operation will write to. They sit
-- alongside the existing qb_invoice_id / qb_payment_link columns on
-- quotes — those columns remain the fast-read source of truth, and
-- these tables become the provenance + crash-safety substrate.
--
-- ───────────────────── qb_event_log ──────────────────────────────────
--
-- Append-only record of every QB interaction (outbound write, outbound
-- read, inbound webhook). Indexed so a single quote's history loads in
-- one query — the "QB Events" tab in QuoteDetailModal renders from
-- this. Operators stop asking "what happened to my invoice?" — they
-- open the tab and see the timeline.
--
-- Includes the raw request_body / response_body so a failure can be
-- replayed without re-deriving the exact payload from current quote
-- state (which may have drifted in the meantime).
--
-- service-role only — leaks customer email + invoice IDs and we never
-- want it on an anon/authenticated surface.
--
-- ───────────────────── qb_idempotency ────────────────────────────────
--
-- Short-lived (5 min) cache keyed by a frontend-minted UUID. Two
-- back-to-back createInvoice calls with the same key — e.g. operator
-- double-clicks Send, or the browser retries on network flakiness —
-- collapse to one QB write. The second caller gets the cached result
-- of the first.
--
-- Pruned by a daily cron (defined further down via pg_cron if
-- available; safe to NOOP if pg_cron isn't installed — the table is
-- bounded by the short TTL and weekly manual cleanup is fine).

CREATE TABLE IF NOT EXISTS public.qb_event_log (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_owner       TEXT         NOT NULL,
  quote_id         UUID,                                        -- references quotes(id); NULL for events not tied to a quote
  invoice_id       UUID,                                        -- references invoices(id)
  qb_invoice_id    TEXT,                                        -- realm-scoped, not globally unique — always read with shop_owner
  qb_customer_id   TEXT,
  action           TEXT         NOT NULL,                       -- 'create_invoice' | 'update_invoice' | 'sync_customer' | 'mint_link' | 'webhook_received' | 'pull_invoice' | 'refresh_invoice' | 'reconcile' | etc.
  direction        TEXT         NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  status           TEXT         NOT NULL CHECK (status   IN ('success', 'error', 'skipped', 'duplicate', 'started')),
  request_body     JSONB,                                       -- payload we sent to QB (outbound) or QB sent us (inbound)
  response_body    JSONB,                                       -- payload QB returned
  error_message    TEXT,                                        -- present when status='error'
  idempotency_key  TEXT,                                        -- the key the caller passed, if any
  duration_ms      INTEGER,                                     -- end-to-end timing for the operation
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Hot path: render the QB timeline for one quote.
CREATE INDEX IF NOT EXISTS qb_event_log_quote_id_idx
  ON public.qb_event_log (quote_id, created_at DESC)
  WHERE quote_id IS NOT NULL;

-- Operator view: "everything that happened across my shop today".
CREATE INDEX IF NOT EXISTS qb_event_log_shop_owner_idx
  ON public.qb_event_log (shop_owner, created_at DESC);

-- Reverse lookup: "which quote does this QB invoice id belong to?"
-- Useful for the manual "link orphan QB invoice" flow.
CREATE INDEX IF NOT EXISTS qb_event_log_qb_invoice_id_idx
  ON public.qb_event_log (qb_invoice_id)
  WHERE qb_invoice_id IS NOT NULL;

ALTER TABLE public.qb_event_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qb_event_log FROM anon, authenticated;
GRANT  ALL ON public.qb_event_log TO service_role;

COMMENT ON TABLE  public.qb_event_log IS
  'Append-only audit log of every QuickBooks interaction. Source of truth for "what happened to this quote in QB?". Service-role only.';
COMMENT ON COLUMN public.qb_event_log.action IS
  'Logical operation name. New actions added freely; no enum constraint to avoid migration churn.';
COMMENT ON COLUMN public.qb_event_log.direction IS
  'outbound = InkTracker → QB. inbound = QB → InkTracker (webhook or pull response).';
COMMENT ON COLUMN public.qb_event_log.status IS
  'started rows are written before the QB call begins; updated to success/error/skipped/duplicate on completion. A lone "started" row in the log = the function crashed mid-flight.';

-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.qb_idempotency (
  key          TEXT         PRIMARY KEY,
  shop_owner   TEXT         NOT NULL,
  action       TEXT         NOT NULL,
  status       TEXT         NOT NULL CHECK (status IN ('in_flight', 'completed', 'failed')),
  result       JSONB,                                           -- populated on completion; null while in_flight
  error_message TEXT,
  expires_at   TIMESTAMPTZ  NOT NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS qb_idempotency_expires_idx
  ON public.qb_idempotency (expires_at);

ALTER TABLE public.qb_idempotency ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qb_idempotency FROM anon, authenticated;
GRANT  ALL ON public.qb_idempotency TO service_role;

COMMENT ON TABLE  public.qb_idempotency IS
  'Short-lived (5 min TTL) cache of QB operation results, keyed by frontend-minted UUID. First caller with key X wins; subsequent callers within the TTL get the cached result. Prevents duplicate QB writes from double-clicks, network retries, and at-least-once frontend semantics.';
COMMENT ON COLUMN public.qb_idempotency.status IS
  'in_flight = lock claimed but result not yet written (crashed mid-flight if it stays this way). completed/failed = terminal.';
