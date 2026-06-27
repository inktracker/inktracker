-- Phase 3 of multi-state tax (docs/qb-multistate-tax-scope.md §10): the
-- immutable tax-audit record. One row per invoice capturing the tax AS
-- CHARGED — the authority that computed it, the taxable base, the per-
-- jurisdiction breakdown, the ship-to state, and exemption basis. Never
-- live-recomputed; written from QuickBooks' authoritative TxnTaxDetail at
-- create/resync. Powers the by-state report a shop files returns from, and
-- substantiates each sale in an audit.
--
-- Authority-agnostic by design: `authority` distinguishes quickbooks_ast from
-- a future flat_rate / tax_engine writer (Phase 4).

CREATE TABLE IF NOT EXISTS public.tax_records (
  id                            BIGSERIAL PRIMARY KEY,
  shop_owner                    TEXT        NOT NULL,
  qb_invoice_id                 TEXT,
  quote_id                      TEXT,
  customer_id                   TEXT,
  customer_name                 TEXT,
  txn_date                      DATE        NOT NULL,
  authority                     TEXT        NOT NULL DEFAULT 'quickbooks_ast',
  subtotal                      NUMERIC     NOT NULL DEFAULT 0,
  tax_total                     NUMERIC     NOT NULL DEFAULT 0,
  total                         NUMERIC     NOT NULL DEFAULT 0,
  taxable_amount                NUMERIC     NOT NULL DEFAULT 0,
  effective_rate                NUMERIC,                    -- % = tax_total / taxable_amount
  ship_to_state                 TEXT,
  ship_to_zip                   TEXT,
  exempt                        BOOLEAN     NOT NULL DEFAULT false,
  exemption_type                TEXT,
  exemption_certificate_number  TEXT,
  tax_lines                     JSONB       NOT NULL DEFAULT '[]'::jsonb,  -- [{ rate_percent, amount, taxable }]
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One authoritative record per invoice — upsert target for resync. Plain
-- (non-partial) so ON CONFLICT (shop_owner, qb_invoice_id) resolves; NULL
-- qb_invoice_id rows stay distinct (future non-QB writers).
CREATE UNIQUE INDEX IF NOT EXISTS tax_records_shop_invoice_uidx
  ON public.tax_records (shop_owner, qb_invoice_id);

-- Report hot paths: by date range, and by collecting state.
CREATE INDEX IF NOT EXISTS tax_records_shop_date_idx
  ON public.tax_records (shop_owner, txn_date DESC);
CREATE INDEX IF NOT EXISTS tax_records_shop_state_idx
  ON public.tax_records (shop_owner, ship_to_state);

-- RLS — same shape as notifications: shop owners read their own; only the
-- service role (edge functions) writes. The record is an audit artifact, so
-- there is deliberately NO authenticated INSERT/UPDATE/DELETE — a user can
-- never forge or alter what was charged.
ALTER TABLE public.tax_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tax_records_select_own ON public.tax_records;
CREATE POLICY tax_records_select_own ON public.tax_records
  FOR SELECT
  TO authenticated
  USING (shop_owner = (auth.jwt() ->> 'email'));
