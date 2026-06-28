-- Supplier-order idempotency (audit INT-01 / INT-02).
--
-- ssPlaceOrder and acPlaceOrder POST real-money orders to S&S Activewear /
-- AS Colour. Today a double-click, a client retry after a network timeout
-- (where the order actually went through), or two tabs can place the SAME
-- order twice — there is no server-side guard. This table is the guard:
-- the edge function claims a (shop_owner, idempotency_key) row BEFORE calling
-- the supplier, and replays the stored result instead of re-ordering when the
-- same key comes back.
--
-- The idempotency_key is stable per logical order across retries: the
-- purchase_orders UUID for the AS Colour PO flow, and a per-submit UUID held
-- in component state for the S&S cart flow. shop_owner is derived server-side
-- from the authenticated user (never trusted from the client).
--
-- Only the edge functions (service role) touch this table; RLS is enabled
-- with NO policies so authenticated/anon clients get nothing.

CREATE TABLE IF NOT EXISTS public.supplier_order_idempotency (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_owner        TEXT NOT NULL,
  idempotency_key   TEXT NOT NULL,
  supplier          TEXT,
  status            TEXT NOT NULL DEFAULT 'in_flight'
                    CHECK (status IN ('in_flight', 'succeeded', 'failed')),
  supplier_order_id TEXT,
  response          JSONB,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (shop_owner, idempotency_key)
);

-- updated_at maintenance.
CREATE OR REPLACE FUNCTION public.touch_supplier_order_idempotency_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS supplier_order_idempotency_touch ON public.supplier_order_idempotency;
CREATE TRIGGER supplier_order_idempotency_touch
  BEFORE UPDATE ON public.supplier_order_idempotency
  FOR EACH ROW EXECUTE FUNCTION public.touch_supplier_order_idempotency_updated_at();

-- Service-role only. RLS on, no policies → deny all authenticated/anon.
ALTER TABLE public.supplier_order_idempotency ENABLE ROW LEVEL SECURITY;
