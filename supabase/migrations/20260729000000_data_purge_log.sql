-- Audit trail for shop-data purges (audit PRIV-01).
--
-- The purgeShopData action (adminAction) deletes a shop's entire data footprint
-- on account deletion. This table records every purge — who ran it, when, and
-- the per-table row counts removed — so deletions are accountable and we can
-- evidence a GDPR/CCPA erasure. Immutable: service-role writes only (the edge
-- function), no authenticated access.

CREATE TABLE IF NOT EXISTS public.data_purge_log (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_owner         TEXT NOT NULL,           -- the purged shop's owner email
  performed_by       TEXT,                    -- caller email
  performed_by_role  TEXT,                    -- 'admin' | 'shop'
  counts             JSONB,                   -- { table: rows_deleted }
  buckets_cleared    JSONB,                   -- { bucket: objects_removed }
  stripe_customer_id TEXT,                    -- noted for out-of-band Stripe deletion
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS data_purge_log_shop_idx
  ON public.data_purge_log (shop_owner, created_at DESC);

-- Service-role only: RLS on, no policies → deny all authenticated/anon.
ALTER TABLE public.data_purge_log ENABLE ROW LEVEL SECURITY;
